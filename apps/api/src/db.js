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

function atDate(dayOffset, hour, minute) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, 0);
}

function insertAppointment(values) {
  const now = localDateTime();
  const result = db.prepare(`
    INSERT INTO appointments (
      ticket_code, token_no, patient_name, phone, age, gender, department_id, doctor_id,
      appointment_date, slot_time, kind, priority, status, language, notes, source,
      checkin_at, called_at, started_at, completed_at, skipped_at, cancelled_at,
      created_by, created_at, updated_at, priority_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    values.ticketCode, values.tokenNo, values.patientName, values.phone, values.age ?? null,
    values.gender ?? null, values.departmentId, values.doctorId, values.appointmentDate,
    values.slotTime ?? null, values.kind ?? 'appointment', values.priority ?? 'general',
    values.status ?? 'booked', values.language ?? 'en', values.notes ?? null,
    values.source ?? 'web', values.checkinAt ?? null, values.calledAt ?? null,
    values.startedAt ?? null, values.completedAt ?? null, values.skippedAt ?? null,
    values.cancelledAt ?? null, values.createdBy ?? null, values.createdAt ?? now,
    values.updatedAt ?? now, values.priorityUpdatedAt ?? now
  );
  return Number(result.lastInsertRowid);
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
    { key: 'pawar', dept: 'OBG', name: 'Dr. Kavita Pawar', qualification: 'MS (OBG)', room: 'Room 205', avg: 16 }
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

  const tokenCounters = {};
  const nextToken = (deptId, date) => {
    const key = `${deptId}:${date}`;
    tokenCounters[key] = (tokenCounters[key] || 0) + 1;
    return tokenCounters[key];
  };

  const today = localDate();
  const addDemo = (config) => {
    const tokenNo = nextToken(config.dept, config.date || today);
    const dept = departments.find((item) => item.code === config.dept);
    return insertAppointment({
      ticketCode: makeTicketCode(config.dept, config.date || today, tokenNo),
      tokenNo,
      patientName: config.name,
      phone: config.phone,
      age: config.age,
      gender: config.gender,
      departmentId: deptIds[config.dept],
      doctorId: doctorIds[config.doctor],
      appointmentDate: config.date || today,
      slotTime: config.slot,
      kind: config.kind || 'appointment',
      priority: config.priority || 'general',
      status: config.status,
      language: config.language || 'en',
      notes: config.notes,
      source: config.source || 'web',
      checkinAt: config.checkinAt,
      calledAt: config.calledAt,
      startedAt: config.startedAt,
      completedAt: config.completedAt,
      createdAt: config.createdAt
    });
  };

  const minutesAgo = (minutes) => localDateTime(new Date(Date.now() - minutes * 60 * 1000));
  const hoursAgo = (hours) => localDateTime(new Date(Date.now() - hours * 60 * 60 * 1000));

  addDemo({
    dept: 'CAR', doctor: 'deshmukh', name: 'Nitin Sawant', phone: '9822014301', age: 58, gender: 'male',
    priority: 'senior', status: 'called', slot: '10:15', kind: 'appointment', language: 'mr',
    checkinAt: minutesAgo(34), calledAt: minutesAgo(3), createdAt: hoursAgo(2), notes: 'Chest discomfort follow-up'
  });
  addDemo({
    dept: 'CAR', doctor: 'deshmukh', name: 'Aarti Shinde', phone: '9822014302', age: 45, gender: 'female',
    priority: 'general', status: 'waiting', slot: '10:30', kind: 'appointment',
    checkinAt: minutesAgo(27), createdAt: hoursAgo(2), language: 'mr'
  });
  addDemo({
    dept: 'CAR', doctor: 'deshmukh', name: 'Vikram Rao', phone: '9822014303', age: 62, gender: 'male',
    priority: 'disabled', status: 'waiting', slot: '10:45', kind: 'walkin',
    checkinAt: minutesAgo(19), createdAt: minutesAgo(21), language: 'en'
  });

  addDemo({
    dept: 'GEN', doctor: 'patil', name: 'Ramesh Jadhav', phone: '9822014401', age: 67, gender: 'male',
    priority: 'senior', status: 'waiting', slot: '10:40', kind: 'walkin',
    checkinAt: minutesAgo(32), createdAt: minutesAgo(35), language: 'mr'
  });
  addDemo({
    dept: 'GEN', doctor: 'patil', name: 'Sana Shaikh', phone: '9822014402', age: 29, gender: 'female',
    priority: 'pregnant', status: 'waiting', slot: '10:50', kind: 'appointment',
    checkinAt: minutesAgo(21), createdAt: hoursAgo(1), language: 'hi'
  });
  addDemo({
    dept: 'GEN', doctor: 'patil', name: 'Arjun Kale', phone: '9822014403', age: 31, gender: 'male',
    priority: 'general', status: 'waiting', slot: '11:00', kind: 'appointment',
    checkinAt: minutesAgo(12), createdAt: hoursAgo(1), language: 'en'
  });
  addDemo({
    dept: 'GEN', doctor: 'patil', name: 'Neha Bhosale', phone: '9822014404', age: 39, gender: 'female',
    priority: 'emergency', status: 'waiting', slot: '11:05', kind: 'walkin',
    checkinAt: minutesAgo(5), createdAt: minutesAgo(6), language: 'en',
    notes: 'High fever and breathlessness — triage priority'
  });

  addDemo({
    dept: 'PED', doctor: 'joshi', name: 'Ira Kulkarni', phone: '9822014501', age: 4, gender: 'female',
    priority: 'general', status: 'waiting', slot: '10:30', kind: 'appointment',
    checkinAt: minutesAgo(16), createdAt: hoursAgo(2), language: 'mr'
  });
  addDemo({
    dept: 'PED', doctor: 'joshi', name: 'Kabir Joshi', phone: '9822014502', age: 7, gender: 'male',
    priority: 'general', status: 'waiting', slot: '10:45', kind: 'walkin',
    checkinAt: minutesAgo(9), createdAt: minutesAgo(11), language: 'en'
  });

  addDemo({
    dept: 'OBG', doctor: 'pawar', name: 'Pooja Pawar', phone: '9822014601', age: 27, gender: 'female',
    priority: 'pregnant', status: 'waiting', slot: '10:40', kind: 'appointment',
    checkinAt: minutesAgo(24), createdAt: hoursAgo(2), language: 'mr'
  });
  addDemo({
    dept: 'OBG', doctor: 'pawar', name: 'Sneha Kadam', phone: '9822014602', age: 32, gender: 'female',
    priority: 'general', status: 'waiting', slot: '11:00', kind: 'appointment',
    checkinAt: minutesAgo(8), createdAt: hoursAgo(1), language: 'hi'
  });

  addDemo({
    dept: 'ORT', doctor: 'kulkarni', name: 'Mohan Patil', phone: '9822014701', age: 71, gender: 'male',
    priority: 'senior', status: 'waiting', slot: '10:20', kind: 'walkin',
    checkinAt: minutesAgo(28), createdAt: minutesAgo(30), language: 'mr'
  });

  addDemo({
    dept: 'GEN', doctor: 'patil', name: 'Suresh Gaikwad', phone: '9822014801', age: 46, gender: 'male',
    priority: 'general', status: 'booked', slot: '11:30', kind: 'appointment',
    createdAt: hoursAgo(3), language: 'en'
  });
  addDemo({
    dept: 'CAR', doctor: 'deshmukh', name: 'Asha Mehta', phone: '9822014802', age: 54, gender: 'female',
    priority: 'general', status: 'booked', slot: '11:45', kind: 'appointment',
    createdAt: hoursAgo(5), language: 'en'
  });

  const tomorrow = localDate(atDate(1, 10, 0));
  addDemo({
    dept: 'GEN', doctor: 'patil', name: 'Rahul Chavan', phone: '9822014901', age: 35, gender: 'male',
    priority: 'general', status: 'booked', slot: '10:00', kind: 'appointment',
    date: tomorrow, createdAt: now, language: 'mr'
  });
  addDemo({
    dept: 'CAR', doctor: 'deshmukh', name: 'Leena Shah', phone: '9822014902', age: 60, gender: 'female',
    priority: 'senior', status: 'booked', slot: '10:15', kind: 'appointment',
    date: tomorrow, createdAt: now, language: 'en'
  });

  db.prepare(`
    INSERT INTO audit_log (actor_role, action, details, created_at)
    VALUES ('system', 'seed', 'Demo hospital data generated', ?)
  `).run(now);

  const demoPatients = [
    ['Rahul Chavan', '9822014901', 'male'], ['Leena Shah', '9822014902', 'female'],
    ['Amit More', '9822014903', 'male'], ['Priyanka Jagtap', '9822014904', 'female'],
    ['Ravi Salunkhe', '9822014905', 'male'], ['Manisha Kamble', '9822014906', 'female'],
    ['Sagar Pawar', '9822014907', 'male'], ['Anita Vaidya', '9822014908', 'female'],
    ['Nilesh Patil', '9822014909', 'male'], ['Komal Sutar', '9822014910', 'female']
  ];
  const priorities = ['general', 'general', 'senior', 'pregnant', 'disabled', 'emergency', 'general'];
  const deptCodes = ['GEN', 'CAR', 'PED', 'OBG', 'ORT'];

  for (let dayOffset = -1; dayOffset >= -45; dayOffset -= 1) {
    const date = localDate(atDate(dayOffset, 10, 0));
    const count = 4 + Math.abs((dayOffset * 7) % 5);
    for (let index = 0; index < count; index += 1) {
      const dept = deptCodes[(Math.abs(dayOffset) + index) % deptCodes.length];
      const doctorKey = dept === 'GEN' ? 'patil' : dept === 'CAR' ? 'deshmukh' : dept === 'PED' ? 'joshi' : dept === 'OBG' ? 'pawar' : 'kulkarni';
      const patient = demoPatients[(Math.abs(dayOffset) * 3 + index) % demoPatients.length];
      const tokenNo = nextToken(deptIds[dept], date);
      const base = atDate(dayOffset, 9 + ((index * 2 + Math.abs(dayOffset)) % 8), (index * 7) % 60);
      const checkin = localDateTime(base);
      const called = localDateTime(new Date(base.getTime() + (5 + (index * 3) % 24) * 60000));
      const started = localDateTime(new Date(base.getTime() + (8 + (index * 3) % 25) * 60000));
      const completed = localDateTime(new Date(base.getTime() + (18 + (index * 4) % 22) * 60000));
      const isServed = index % 7 !== 0;
      insertAppointment({
        ticketCode: makeTicketCode(dept, date, tokenNo),
        tokenNo,
        patientName: patient[0],
        phone: patient[1],
        age: 22 + ((Math.abs(dayOffset) * 5 + index * 11) % 58),
        gender: patient[2],
        departmentId: deptIds[dept],
        doctorId: doctorIds[doctorKey],
        appointmentDate: date,
        slotTime: `${String(9 + ((index * 2) % 8)).padStart(2, '0')}:${String((index * 10) % 60).padStart(2, '0')}`,
        kind: index % 3 === 0 ? 'walkin' : 'appointment',
        priority: priorities[(Math.abs(dayOffset) + index) % priorities.length],
        status: isServed ? 'served' : index % 7 === 1 ? 'skipped' : index % 7 === 2 ? 'cancelled' : 'no_show',
        language: index % 3 === 0 ? 'mr' : index % 3 === 1 ? 'hi' : 'en',
        source: index % 2 === 0 ? 'reception' : 'web',
        checkinAt: lenientIso(isServed || index % 7 > 0, checkin),
        calledAt: isServed ? called : null,
        startedAt: isServed ? started : null,
        completedAt: isServed ? completed : null,
        createdAt: localDateTime(new Date(base.getTime() - 50 * 60000))
      });
    }
  }
}

function lenientIso(condition, value) {
  return condition ? value : null;
}

seed();

module.exports = {
  db,
  dbPath,
  localDate,
  localDateTime,
  makeTicketCode
};
