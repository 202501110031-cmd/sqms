const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'sqms.db');
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    name_mr TEXT NOT NULL,
    name_hi TEXT NOT NULL,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#0f766e',
    avg_minutes INTEGER NOT NULL DEFAULT 12,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL REFERENCES departments(id),
    name TEXT NOT NULL,
    qualification TEXT,
    room TEXT,
    avg_minutes INTEGER NOT NULL DEFAULT 12,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','doctor','nurse','receptionist')),
    department_id INTEGER REFERENCES departments(id),
    doctor_id INTEGER REFERENCES doctors(id),
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_code TEXT NOT NULL UNIQUE,
    token_no INTEGER NOT NULL,
    patient_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    age INTEGER,
    gender TEXT,
    department_id INTEGER NOT NULL REFERENCES departments(id),
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    appointment_date TEXT NOT NULL,
    slot_time TEXT,
    kind TEXT NOT NULL DEFAULT 'walkin' CHECK (kind IN ('walkin','appointment')),
    priority TEXT NOT NULL DEFAULT 'general' CHECK (priority IN ('emergency','senior','pregnant','disabled','general')),
    status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','waiting','called','in_consultation','served','skipped','cancelled','no_show')),
    language TEXT NOT NULL DEFAULT 'en',
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'web',
    checkin_at TEXT,
    called_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    skipped_at TEXT,
    cancelled_at TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    priority_updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS doctor_state (
    doctor_id INTEGER PRIMARY KEY REFERENCES doctors(id),
    paused INTEGER NOT NULL DEFAULT 0,
    paused_at TEXT,
    paused_accum_seconds INTEGER NOT NULL DEFAULT 0,
    avg_minutes REAL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER REFERENCES appointments(id),
    doctor_id INTEGER REFERENCES doctors(id),
    ticket_code TEXT,
    channel TEXT NOT NULL CHECK (channel IN ('sms','app','voice')),
    template TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en',
    phone TEXT,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'simulated',
    provider TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    actor_role TEXT,
    action TEXT NOT NULL,
    appointment_id INTEGER,
    doctor_id INTEGER,
    details TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON appointments(doctor_id, appointment_date);
  CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
  CREATE INDEX IF NOT EXISTS idx_appointments_ticket ON appointments(ticket_code);
  CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
`);

const pad = (value) => String(value).padStart(2, '0');

function localDateTime(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function makeTicketCode(deptCode, date, tokenNo) {
  const compact = date.replaceAll('-', '').slice(2);
  return `${deptCode}-${compact}-${String(tokenNo).padStart(3, '0')}`;
}

function seed() {
  const departmentCount = db.prepare('SELECT COUNT(*) AS count FROM departments').get().count;
  if (departmentCount > 0) return;

  const departments = [
    {
      code: 'GEN', name: 'General Medicine', nameMr: 'सामान्य औषधोपचार', nameHi: 'सामान्य चिकित्सा',
      description: 'Fever, infections, routine checks and common illnesses',
      color: '#0f766e', avg: 10
    },
    {
      code: 'CAR', name: 'Cardiology', nameMr: 'हृदयरोग विभाग', nameHi: 'हृदय रोग विभाग',
      description: 'Heart health, ECG, blood pressure and cardiac care',
      color: '#e11d48', avg: 15
    },
    {
      code: 'PED', name: 'Pediatrics', nameMr: 'बालरोग विभाग', nameHi: 'बाल रोग विभाग',
      description: 'Newborn, child health and vaccination services',
      color: '#2563eb', avg: 12
    },
    {
      code: 'OBG', name: 'Obstetrics & Gynaecology', nameMr: 'स्त्रीरोग व प्रसूती', nameHi: 'स्त्री रोग एवं प्रसूति',
      description: 'Women’s health, pregnancy and postnatal care',
      color: '#a21caf', avg: 16
    },
    {
      code: 'ORT', name: 'Orthopaedics', nameMr: 'अस्थिरोग विभाग', nameHi: 'हड्डी रोग विभाग',
      description: 'Bones, joints, fractures and mobility care',
      color: '#ea580c', avg: 14
    }
  ];

  const insertDepartment = db.prepare(`
    INSERT INTO departments (code, name, name_mr, name_hi, description, color, avg_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const dept of departments) {
    insertDepartment.run(dept.code, dept.name, dept.nameMr, dept.nameHi, dept.description, dept.color, dept.avg);
  }

  const deptIds = Object.fromEntries(
    db.prepare('SELECT id, code FROM departments').all().map((row) => [row.code, row.id])
  );

  const doctors = [
    { key: 'deshmukh', dept: 'CAR', name: 'Dr. Anjali Deshmukh', qualification: 'MD, DM (Cardiology)', room: 'Room 204', avg: 15 },
    { key: 'patil', dept: 'GEN', name: 'Dr. Rohan Patil', qualification: 'MBBS, MD (Medicine)', room: 'Room 101', avg: 10 },
    { key: 'joshi', dept: 'PED', name: 'Dr. Meera Joshi', qualification: 'MBBS, DCH', room: 'Room 108', avg: 12 },
    { key: 'kulkarni', dept: 'ORT', name: 'Dr. Sunil Kulkarni', qualification: 'MS (Orthopaedics)', room: 'Room 302', avg: 14 },
    { key: 'pawar', dept: 'OBG', name: 'Dr. Kavita Pawar', qualification: 'MS (OBG)', room: 'Room 205', avg: 16 },
    { key: 'sneha', dept: 'GEN', name: 'Dr. Sneha Kulkarni', qualification: 'MBBS, MD (Medicine)', room: 'Room 102', avg: 11 },
    { key: 'rao', dept: 'CAR', name: 'Dr. Arvind Rao', qualification: 'MD, DM (Cardiology)', room: 'Room 206', avg: 14 },
    { key: 'nikhil', dept: 'PED', name: 'Dr. Nikhil Deshpande', qualification: 'MBBS, DCH', room: 'Room 109', avg: 12 },
    { key: 'naik', dept: 'OBG', name: 'Dr. Shalini Naik', qualification: 'MS (OBG)', room: 'Room 207', avg: 15 },
    { key: 'ajay', dept: 'ORT', name: 'Dr. Ajay Chavan', qualification: 'MS (Orthopaedics)', room: 'Room 304', avg: 13 }
  ];

  const insertDoctor = db.prepare(`
    INSERT INTO doctors (department_id, name, qualification, room, avg_minutes, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const now = localDateTime();
  for (const doctor of doctors) {
    insertDoctor.run(deptIds[doctor.dept], doctor.name, doctor.qualification, doctor.room, doctor.avg, now);
  }
  const doctorIds = Object.fromEntries(
    db.prepare('SELECT id, name FROM doctors').all().map((row) => [
      doctors.find((doctor) => doctor.name === row.name).key,
      row.id
    ])
  );

  const insertState = db.prepare(`
    INSERT INTO doctor_state (doctor_id, paused, paused_accum_seconds, avg_minutes, updated_at)
    VALUES (?, 0, 0, ?, ?)
  `);
  for (const doctor of doctors) {
    insertState.run(doctorIds[doctor.key], doctor.avg, now);
  }

  const password = (value) => bcrypt.hashSync(value, 10);
  const users = [
    { name: 'Hospital Administrator', email: 'admin@sqms.health', password: 'admin123', role: 'admin', dept: null, doctor: null },
    { name: 'Dr. Anjali Deshmukh', email: 'cardio@sqms.health', password: 'doctor123', role: 'doctor', dept: 'CAR', doctor: 'deshmukh' },
    { name: 'Dr. Rohan Patil', email: 'medicine@sqms.health', password: 'doctor123', role: 'doctor', dept: 'GEN', doctor: 'patil' },
    { name: 'Sister Priya More', email: 'nurse@sqms.health', password: 'nurse123', role: 'nurse', dept: 'GEN', doctor: null },
    { name: 'Reception Desk', email: 'reception@sqms.health', password: 'reception123', role: 'receptionist', dept: 'GEN', doctor: null }
  ];
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, department_id, doctor_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const user of users) {
    insertUser.run(
      user.name, user.email, password(user.password), user.role,
      user.dept ? deptIds[user.dept] : null,
      user.doctor ? doctorIds[user.doctor] : null, now
    );
  }

}

seed();

module.exports = {
  db,
  dbPath,
  localDate,
  localDateTime,
  makeTicketCode
};
