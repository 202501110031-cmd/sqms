const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('node:fs');
const http = require('node:http');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const { db, localDate, localDateTime, makeTicketCode } = require('./db');
const { signToken, publicUser, authRequired, allow, canManageDoctor, canFrontDesk } = require('./auth');
const {
  getDoctor,
  getDoctorQueue,
  getTicketStatus,
  getBoard,
  getOverview,
  ensureState
} = require('./queueService');
const { init: initNotifications, dispatchAlert, recordAudit } = require('./notifications');
const { getAnalytics, getExportRows } = require('./analytics');
const {
  PRIORITY_LABEL,
  normalizePhone,
  isValidPhone,
  tokenLabel
} = require('./utils');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});
initNotifications(io);

const PORT = Number(process.env.PORT || 4000);
const WEB_DIST = path.join(__dirname, '..', '..', 'web', 'dist');
const ALLOWED_PRIORITIES = ['emergency', 'senior', 'pregnant', 'disabled', 'general'];
const ALLOWED_LANGUAGES = ['en', 'hi', 'mr'];

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: true }));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function fail(res, status, error) {
  return res.status(status).json({ error });
}

function cleanString(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function broadcastQueue(doctorId) {
  const doctor = getDoctor(doctorId);
  if (!doctor) return;
  io.emit('queue:changed', {
    doctorId: Number(doctorId),
    departmentId: doctor.department_id
  });
  io.emit('board:changed', { departmentId: doctor.department_id });
}

function calculateDoctorAverage(doctorId) {
  const rows = db.prepare(`
    SELECT started_at, called_at, completed_at
    FROM appointments
    WHERE doctor_id = ? AND status = 'served'
      AND completed_at IS NOT NULL
    ORDER BY completed_at DESC
    LIMIT 20
  `).all(doctorId);
  const durations = rows
    .map((row) => {
      const start = row.started_at || row.called_at;
      if (!start || !row.completed_at) return null;
      return Math.max(1, Math.round((new Date(row.completed_at) - new Date(start)) / 60000));
    })
    .filter((value) => Number.isFinite(value) && value > 0 && value < 120);
  if (!durations.length) return null;
  return Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10;
}

function updateDoctorAverage(doctorId) {
  const avg = calculateDoctorAverage(doctorId);
  if (!avg) return;
  db.prepare('UPDATE doctor_state SET avg_minutes = ?, updated_at = ? WHERE doctor_id = ?')
    .run(avg, localDateTime(), doctorId);
}

function nextTokenNo(departmentId, date) {
  const row = db.prepare(`
    SELECT COALESCE(MAX(token_no), 0) AS max_no
    FROM appointments WHERE department_id = ? AND appointment_date = ?
  `).get(departmentId, date);
  return Number(row.max_no) + 1;
}

function validateAppointmentInput(body) {
  const patientName = cleanString(body.patientName, 90);
  const phone = normalizePhone(body.phone);
  const age = body.age === '' || body.age === undefined ? null : Number(body.age);
  const gender = ['male', 'female', 'other'].includes(body.gender) ? body.gender : null;
  const departmentId = Number(body.departmentId);
  const doctorId = Number(body.doctorId);
  const kind = body.kind === 'appointment' ? 'appointment' : 'walkin';
  const date = body.date || localDate();
  const slotTime = cleanString(body.slotTime, 10) || null;
  const priority = ALLOWED_PRIORITIES.includes(body.priority) ? body.priority : 'general';
  const language = ALLOWED_LANGUAGES.includes(body.language) ? body.language : 'en';
  const notes = cleanString(body.notes, 400) || null;

  if (!patientName || patientName.length < 2) throw new Error('Please enter the patient name');
  if (!isValidPhone(phone)) throw new Error('Please enter a valid mobile number');
  if (age !== null && (!Number.isFinite(age) || age < 0 || age > 120)) throw new Error('Please enter a valid age');
  if (!departmentId || !doctorId) throw new Error('Please select a department and doctor');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Please choose a valid appointment date');
  if (date < localDate()) throw new Error('Appointment date cannot be in the past');
  if (date > localDate(new Date(Date.now() + 30 * 86400000))) throw new Error('Appointments can be booked up to 30 days ahead');

  const doctor = getDoctor(doctorId);
  if (!doctor || !doctor.active) throw new Error('Selected doctor is not available');
  if (doctor.department_id !== departmentId) throw new Error('Selected doctor does not belong to this department');
  if (kind === 'walkin' && date !== localDate()) throw new Error('Walk-in tokens are only available for today');

  return { patientName, phone, age, gender, departmentId, doctorId, kind, date, slotTime, priority, language, notes, doctor };
}

function createAppointment(body, { createdBy = null, source = 'web', selfCheckIn = false } = {}) {
  const input = validateAppointmentInput(body);
  const date = input.kind === 'walkin' ? localDate() : input.date;

  if (input.kind === 'appointment' && input.slotTime) {
    const existing = db.prepare(`
      SELECT id FROM appointments
      WHERE doctor_id = ? AND appointment_date = ? AND slot_time = ?
        AND status NOT IN ('cancelled','no_show','skipped')
    `).get(input.doctorId, date, input.slotTime);
    if (existing) {
      const error = new Error('That time slot has just been taken. Please choose another slot.');
      error.status = 409;
      throw error;
    }
  }

  const tokenNo = nextTokenNo(input.departmentId, date);
  const ticketCode = makeTicketCode(input.doctor.department_code, date, tokenNo);
  const now = localDateTime();
  const shouldCheckIn = input.kind === 'walkin' || (selfCheckIn && date === localDate());
  const status = shouldCheckIn ? 'waiting' : 'booked';
  const result = db.prepare(`
    INSERT INTO appointments (
      ticket_code, token_no, patient_name, phone, age, gender, department_id, doctor_id,
      appointment_date, slot_time, kind, priority, status, language, notes, source,
      checkin_at, created_by, created_at, updated_at, priority_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ticketCode, tokenNo, input.patientName, input.phone, input.age, input.gender,
    input.departmentId, input.doctorId, date, input.slotTime, input.kind, input.priority,
    status, input.language, input.notes, source, shouldCheckIn ? now : null,
    createdBy, now, now, now
  );

  const appointmentId = Number(result.lastInsertRowid);
  recordAudit({
    actor: createdBy ? { id: createdBy, role: source } : null,
    action: shouldCheckIn ? 'appointment.checked_in' : 'appointment.booked',
    appointmentId,
    doctorId: input.doctorId,
    details: { ticketCode, source, priority: input.priority }
  });
  return { appointmentId, ticketCode, status, tokenNo, date, doctorId: input.doctorId };
}

async function notifyBooking(result, { checkedIn = false } = {}) {
  const ticket = getTicketStatus(result.ticketCode);
  const template = checkedIn ? 'checked_in' : 'booked';
  await dispatchAlert({
    appointmentId: result.appointmentId,
    template,
    channels: checkedIn ? ['sms', 'app', 'voice'] : ['sms', 'app'],
    etaMinutes: ticket?.etaMinutes,
    position: ticket?.position,
    trackUrl: `${process.env.PUBLIC_APP_URL || 'http://localhost:5173'}/track/${result.ticketCode}`
  });
  broadcastQueue(ticket?.doctor?.id || result.doctorId);
}

async function checkInAppointment(appointment, actor, source = 'staff') {
  if (appointment.appointment_date !== localDate()) {
    const error = new Error('Only today’s appointments can be checked in');
    error.status = 409;
    throw error;
  }
  if (appointment.status !== 'booked') {
    const error = new Error('This appointment has already been checked in or closed');
    error.status = 409;
    throw error;
  }
  db.prepare('UPDATE appointments SET status = ?, checkin_at = ?, updated_at = ? WHERE id = ?')
    .run('waiting', localDateTime(), localDateTime(), appointment.id);
  recordAudit({
    actor,
    action: 'appointment.checked_in',
    appointmentId: appointment.id,
    doctorId: appointment.doctor_id,
    details: { source }
  });
  const ticket = getTicketStatus(appointment.ticket_code);
  await dispatchAlert({
    appointmentId: appointment.id,
    template: 'checked_in',
    channels: ['sms', 'app', 'voice'],
    etaMinutes: ticket?.etaMinutes,
    position: ticket?.position
  });
  broadcastQueue(appointment.doctor_id);
  return ticket;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'sqms-api', time: localDateTime() });
});

app.post('/api/auth/login', (req, res) => {
  const email = cleanString(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return fail(res, 400, 'Email and password are required');

  const user = db.prepare(`
    SELECT u.*, d.name AS department_name, doc.name AS doctor_name
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN doctors doc ON doc.id = u.doctor_id
    WHERE LOWER(u.email) = ?
  `).get(email);

  if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
    return fail(res, 401, 'Invalid email or password');
  }

  recordAudit({ actor: user, action: 'auth.login', details: { role: user.role } });
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/public/departments', (req, res) => {
  const departments = db.prepare('SELECT * FROM departments WHERE active = 1 ORDER BY id ASC').all();
  const doctors = db.prepare(`
    SELECT * FROM doctors WHERE active = 1 ORDER BY id ASC
  `).all();
  const board = getBoard();
  const boardMap = new Map(board.entries.map((entry) => [entry.doctorId, entry]));
  res.json({
    departments: departments.map((department) => ({
      id: department.id,
      code: department.code,
      name: department.name,
      nameMr: department.name_mr,
      nameHi: department.name_hi,
      description: department.description,
      color: department.color,
      avgMinutes: department.avg_minutes,
      doctors: doctors
        .filter((doctor) => doctor.department_id === department.id)
        .map((doctor) => {
          const live = boardMap.get(doctor.id);
          return {
            id: doctor.id,
            name: doctor.name,
            qualification: doctor.qualification,
            room: doctor.room,
            avgMinutes: doctor.avg_minutes,
            waiting: live?.waiting || 0,
            paused: live?.paused || false,
            nextEtaMinutes: live?.nextEtaMinutes ?? null,
            currentToken: live?.current?.tokenLabel || null
          };
        })
    }))
  });
});

app.get('/api/public/doctors', (req, res) => {
  const departmentId = Number(req.query.departmentId || 0);
  const doctors = db.prepare(`
    SELECT doc.*, d.name AS department_name, d.code AS department_code
    FROM doctors doc JOIN departments d ON d.id = doc.department_id
    WHERE doc.active = 1 ${departmentId ? 'AND doc.department_id = ?' : ''}
    ORDER BY doc.id ASC
  `).all(...(departmentId ? [departmentId] : []));
  res.json({ doctors });
});

app.get('/api/public/slots', (req, res) => {
  const doctorId = Number(req.query.doctorId);
  const date = req.query.date || localDate();
  if (!doctorId) return fail(res, 400, 'doctorId is required');
  const doctor = getDoctor(doctorId);
  if (!doctor) return fail(res, 404, 'Doctor not found');

  const blocked = new Set(db.prepare(`
    SELECT slot_time FROM appointments
    WHERE doctor_id = ? AND appointment_date = ?
      AND status NOT IN ('cancelled','no_show','skipped') AND slot_time IS NOT NULL
  `).all(doctorId, date).map((row) => row.slot_time));

  const slots = [];
  for (let hour = 9; hour <= 17; hour += 1) {
    if (hour === 13) continue;
    for (let minute = 0; minute < 60; minute += 15) {
      const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      const isPast = date === localDate() && time <= new Date().toTimeString().slice(0, 5);
      slots.push({ time, available: !blocked.has(time) && !isPast });
    }
  }
  res.json({ doctorId, date, slots });
});

app.post('/api/public/bookings', asyncRoute(async (req, res) => {
  try {
    const body = { ...req.body, source: 'web' };
    const selfCheckIn = Boolean(req.body.selfCheckIn) && (req.body.kind === 'walkin' || req.body.date === localDate());
    const result = createAppointment(body, { source: 'web', selfCheckIn });
    const ticket = getTicketStatus(result.ticketCode);
    await notifyBooking(result, { checkedIn: result.status === 'waiting' });
    const refreshed = getTicketStatus(result.ticketCode);
    res.status(201).json({
      ticket: refreshed,
      trackingUrl: `/track/${result.ticketCode}`,
      smsMode: process.env.TWILIO_ACCOUNT_SID ? 'twilio' : 'simulated'
    });
  } catch (error) {
    return fail(res, error.status || 400, error.message);
  }
}));

app.get('/api/public/tickets/:code', (req, res) => {
  const ticket = getTicketStatus(req.params.code);
  if (!ticket) return fail(res, 404, 'Ticket not found. Check the code and try again.');
  res.json(ticket);
});

app.post('/api/public/tickets/:code/check-in', asyncRoute(async (req, res) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE UPPER(ticket_code) = UPPER(?)').get(req.params.code);
  if (!appointment) return fail(res, 404, 'Ticket not found');
  try {
    await checkInAppointment(appointment, null, 'patient-self');
    res.json(getTicketStatus(appointment.ticket_code));
  } catch (error) {
    return fail(res, error.status || 400, error.message);
  }
}));

app.post('/api/public/tickets/:code/cancel', asyncRoute(async (req, res) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE UPPER(ticket_code) = UPPER(?)').get(req.params.code);
  if (!appointment) return fail(res, 404, 'Ticket not found');
  if (!['booked', 'waiting'].includes(appointment.status)) return fail(res, 409, 'This ticket can no longer be cancelled');
  const now = localDateTime();
  db.prepare('UPDATE appointments SET status = ?, cancelled_at = ?, updated_at = ? WHERE id = ?')
    .run('cancelled', now, now, appointment.id);
  recordAudit({ actor: null, action: 'appointment.cancelled', appointmentId: appointment.id, doctorId: appointment.doctor_id, details: { source: 'patient' } });
  await dispatchAlert({ appointmentId: appointment.id, template: 'cancelled', channels: ['sms', 'app'] });
  broadcastQueue(appointment.doctor_id);
  res.json(getTicketStatus(appointment.ticket_code));
}));

app.get('/api/public/board', (req, res) => {
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : null;
  res.json(getBoard(departmentId));
});

app.get('/api/staff/queue', authRequired, (req, res) => {
  let doctorId = Number(req.query.doctorId || 0);
  if (req.user.role === 'doctor') doctorId = Number(req.user.doctor_id);
  if (!doctorId) return fail(res, 400, 'doctorId is required');
  if (!canManageDoctor(req.user, doctorId) && req.user.role === 'doctor') return fail(res, 403, 'You can only view your own queue');
  const queue = getDoctorQueue(doctorId, req.query.date || localDate());
  if (!queue) return fail(res, 404, 'Doctor not found');
  res.json(queue);
});

app.get('/api/staff/overview', authRequired, allow('admin', 'nurse', 'receptionist'), (req, res) => {
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : null;
  res.json({ generatedAt: localDateTime(), doctors: getOverview(departmentId) });
});

app.get('/api/staff/doctors', authRequired, (req, res) => {
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : null;
  const doctors = db.prepare(`
    SELECT doc.*, d.name AS department_name, d.code AS department_code, d.color AS department_color
    FROM doctors doc JOIN departments d ON d.id = doc.department_id
    WHERE doc.active = 1 ${departmentId ? 'AND doc.department_id = ?' : ''}
    ORDER BY d.id, doc.id
  `).all(...(departmentId ? [departmentId] : []));
  res.json({ doctors });
});

app.get('/api/staff/departments', authRequired, (req, res) => {
  res.json({ departments: db.prepare('SELECT * FROM departments WHERE active = 1 ORDER BY id').all() });
});

app.get('/api/staff/search', authRequired, (req, res) => {
  const code = cleanString(req.query.code, 80);
  if (!code) return fail(res, 400, 'Search code is required');
  const ticket = getTicketStatus(code);
  if (!ticket) return fail(res, 404, 'Ticket not found');
  res.json(ticket);
});

app.post('/api/staff/appointments', authRequired, allow('admin', 'nurse', 'receptionist'), asyncRoute(async (req, res) => {
  try {
    const result = createAppointment(req.body, {
      createdBy: req.user.id,
      source: 'reception',
      selfCheckIn: Boolean(req.body.selfCheckIn)
    });
    await notifyBooking(result, { checkedIn: result.status === 'waiting' });
    res.status(201).json({
      ticket: getTicketStatus(result.ticketCode),
      trackingUrl: `/track/${result.ticketCode}`
    });
  } catch (error) {
    return fail(res, error.status || 400, error.message);
  }
}));

app.post('/api/staff/appointments/:id/check-in', authRequired, allow('admin', 'nurse', 'receptionist'), asyncRoute(async (req, res) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(Number(req.params.id));
  if (!appointment) return fail(res, 404, 'Appointment not found');
  try {
    const ticket = await checkInAppointment(appointment, req.user, 'staff');
    res.json(ticket);
  } catch (error) {
    return fail(res, error.status || 400, error.message);
  }
}));

app.post('/api/staff/appointments/:id/priority', authRequired, allow('admin', 'nurse', 'doctor'), asyncRoute(async (req, res) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(Number(req.params.id));
  if (!appointment) return fail(res, 404, 'Appointment not found');
  if (req.user.role === 'doctor' && !canManageDoctor(req.user, appointment.doctor_id)) {
    return fail(res, 403, 'You can only update your own patients');
  }
  if (!['waiting', 'called', 'booked'].includes(appointment.status)) return fail(res, 409, 'Priority cannot be changed at this stage');
  const priority = req.body.priority;
  if (!ALLOWED_PRIORITIES.includes(priority)) return fail(res, 400, 'Invalid priority');
  const now = localDateTime();
  db.prepare('UPDATE appointments SET priority = ?, priority_updated_at = ?, updated_at = ? WHERE id = ?')
    .run(priority, now, now, appointment.id);
  recordAudit({
    actor: req.user,
    action: 'appointment.priority_changed',
    appointmentId: appointment.id,
    doctorId: appointment.doctor_id,
    details: { from: appointment.priority, to: priority, label: PRIORITY_LABEL[priority] }
  });
  broadcastQueue(appointment.doctor_id);
  res.json({ queue: getDoctorQueue(appointment.doctor_id, appointment.appointment_date), ticket: getTicketStatus(appointment.ticket_code) });
}));

app.post('/api/staff/appointments/:id/cancel', authRequired, allow('admin', 'receptionist'), asyncRoute(async (req, res) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(Number(req.params.id));
  if (!appointment) return fail(res, 404, 'Appointment not found');
  if (!['booked', 'waiting'].includes(appointment.status)) return fail(res, 409, 'This appointment cannot be cancelled now');
  const now = localDateTime();
  db.prepare('UPDATE appointments SET status = ?, cancelled_at = ?, updated_at = ? WHERE id = ?')
    .run('cancelled', now, now, appointment.id);
  recordAudit({ actor: req.user, action: 'appointment.cancelled', appointmentId: appointment.id, doctorId: appointment.doctor_id, details: { source: 'staff' } });
  await dispatchAlert({ appointmentId: appointment.id, template: 'cancelled', channels: ['sms', 'app'] });
  broadcastQueue(appointment.doctor_id);
  res.json({ ok: true });
}));

function guardDoctorAction(req, res, doctorId) {
  if (!canManageDoctor(req.user, doctorId)) {
    fail(res, 403, 'Only the assigned doctor or an administrator can control this queue');
    return false;
  }
  return true;
}

app.post('/api/staff/doctors/:doctorId/call-next', authRequired, allow('doctor', 'admin'), asyncRoute(async (req, res) => {
  const doctorId = Number(req.params.doctorId);
  if (!guardDoctorAction(req, res, doctorId)) return;
  const doctor = getDoctor(doctorId);
  if (!doctor) return fail(res, 404, 'Doctor not found');
  const state = ensureState(doctor);
  if (state.paused) return fail(res, 409, 'Queue is paused. Resume it before calling the next patient.');

  const current = db.prepare(`
    SELECT id FROM appointments
    WHERE doctor_id = ? AND appointment_date = ? AND status IN ('called','in_consultation')
  `).get(doctorId, localDate());
  if (current) return fail(res, 409, 'Finish, skip or recall the current patient first.');

  const queue = getDoctorQueue(doctorId, localDate());
  if (!queue.next) return fail(res, 404, 'No patients are waiting in this queue.');
  const now = localDateTime();
  db.prepare('UPDATE appointments SET status = ?, called_at = ?, updated_at = ? WHERE id = ?')
    .run('called', now, now, queue.next.id);
  recordAudit({ actor: req.user, action: 'queue.call_next', appointmentId: queue.next.id, doctorId, details: { token: queue.next.tokenLabel } });
  await dispatchAlert({ appointmentId: queue.next.id, template: 'turn', channels: ['sms', 'app', 'voice'] });
  broadcastQueue(doctorId);
  res.json({ queue: getDoctorQueue(doctorId, localDate()), message: `${queue.next.tokenLabel} called` });
}));

app.post('/api/staff/appointments/:id/call', authRequired, allow('doctor', 'admin'), asyncRoute(async (req, res) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(Number(req.params.id));
  if (!appointment) return fail(res, 404, 'Appointment not found');
  if (!guardDoctorAction(req, res, appointment.doctor_id)) return;
  if (!['waiting', 'skipped'].includes(appointment.status)) return fail(res, 409, 'Only waiting or skipped patients can be called');
  const doctor = getDoctor(appointment.doctor_id);
  const state = ensureState(doctor);
  if (state.paused) return fail(res, 409, 'Resume the queue before calling a patient');
  const current = db.prepare(`
    SELECT id FROM appointments
    WHERE doctor_id = ? AND appointment_date = ? AND status IN ('called','in_consultation')
  `).get(appointment.doctor_id, localDate());
  if (current && current.id !== appointment.id) return fail(res, 409, 'Another patient is already active. Complete or skip them first.');

  const now = localDateTime();
  db.prepare('UPDATE appointments SET status = ?, called_at = ?, skipped_at = NULL, updated_at = ? WHERE id = ?')
    .run('called', now, now, appointment.id);
  recordAudit({ actor: req.user, action: appointment.status === 'skipped' ? 'queue.recall' : 'queue.call_patient', appointmentId: appointment.id, doctorId: appointment.doctor_id, details: { token: tokenLabel(doctor.department_code, appointment.token_no) } });
  await dispatchAlert({ appointmentId: appointment.id, template: 'turn', channels: ['sms', 'app', 'voice'] });
  broadcastQueue(appointment.doctor_id);
  res.json({ queue: getDoctorQueue(appointment.doctor_id, localDate()) });
}));

app.post('/api/staff/appointments/:id/recall', authRequired, allow('doctor', 'admin'), asyncRoute(async (req, res) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(Number(req.params.id));
  if (!appointment) return fail(res, 404, 'Appointment not found');
  if (!guardDoctorAction(req, res, appointment.doctor_id)) return;
  if (appointment.status !== 'skipped') return fail(res, 409, 'Only skipped patients can be recalled');
  const doctor = getDoctor(appointment.doctor_id);
  const state = ensureState(doctor);
  if (state.paused) return fail(res, 409, 'Resume the queue before recalling a patient');
  const current = db.prepare(`
    SELECT id FROM appointments
    WHERE doctor_id = ? AND appointment_date = ? AND status IN ('called','in_consultation')
  `).get(appointment.doctor_id, localDate());
  if (current) return fail(res, 409, 'Complete or skip the current patient before recalling another');

  const now = localDateTime();
  db.prepare('UPDATE appointments SET status = ?, called_at = ?, skipped_at = NULL, updated_at = ? WHERE id = ?')
    .run('called', now, now, appointment.id);
  recordAudit({ actor: req.user, action: 'queue.recall', appointmentId: appointment.id, doctorId: appointment.doctor_id, details: { token: tokenLabel(doctor.department_code, appointment.token_no) } });
  await dispatchAlert({ appointmentId: appointment.id, template: 'turn', channels: ['sms', 'app', 'voice'] });
  broadcastQueue(appointment.doctor_id);
  res.json({ queue: getDoctorQueue(appointment.doctor_id, localDate()) });
}));

app.post('/api/staff/appointments/:id/start', authRequired, allow('doctor', 'admin'), asyncRoute(async (req, res) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(Number(req.params.id));
  if (!appointment) return fail(res, 404, 'Appointment not found');
  if (!guardDoctorAction(req, res, appointment.doctor_id)) return;
  if (appointment.status !== 'called') return fail(res, 409, 'This patient has not been called yet');
  const now = localDateTime();
  db.prepare('UPDATE appointments SET status = ?, started_at = ?, updated_at = ? WHERE id = ?')
    .run('in_consultation', now, now, appointment.id);
  recordAudit({ actor: req.user, action: 'consultation.started', appointmentId: appointment.id, doctorId: appointment.doctor_id, details: {} });
  broadcastQueue(appointment.doctor_id);
  res.json({ queue: getDoctorQueue(appointment.doctor_id, localDate()) });
}));

app.post('/api/staff/appointments/:id/complete', authRequired, allow('doctor', 'admin'), asyncRoute(async (req, res) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(Number(req.params.id));
  if (!appointment) return fail(res, 404, 'Appointment not found');
  if (!guardDoctorAction(req, res, appointment.doctor_id)) return;
  if (!['called', 'in_consultation'].includes(appointment.status)) return fail(res, 409, 'This patient is not currently active');
  const now = localDateTime();
  db.prepare('UPDATE appointments SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
    .run('served', now, now, appointment.id);
  updateDoctorAverage(appointment.doctor_id);
  recordAudit({ actor: req.user, action: 'consultation.completed', appointmentId: appointment.id, doctorId: appointment.doctor_id, details: { token: tokenLabel(getDoctor(appointment.doctor_id).department_code, appointment.token_no) } });
  broadcastQueue(appointment.doctor_id);
  res.json({ queue: getDoctorQueue(appointment.doctor_id, localDate()) });
}));

app.post('/api/staff/appointments/:id/skip', authRequired, allow('doctor', 'admin'), asyncRoute(async (req, res) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(Number(req.params.id));
  if (!appointment) return fail(res, 404, 'Appointment not found');
  if (!guardDoctorAction(req, res, appointment.doctor_id)) return;
  if (!['called', 'in_consultation'].includes(appointment.status)) return fail(res, 409, 'Only the active patient can be skipped');
  const now = localDateTime();
  db.prepare('UPDATE appointments SET status = ?, skipped_at = ?, updated_at = ? WHERE id = ?')
    .run('skipped', now, now, appointment.id);
  recordAudit({ actor: req.user, action: 'queue.skipped', appointmentId: appointment.id, doctorId: appointment.doctor_id, details: {} });
  await dispatchAlert({ appointmentId: appointment.id, template: 'skipped', channels: ['sms', 'app'] });
  broadcastQueue(appointment.doctor_id);
  res.json({ queue: getDoctorQueue(appointment.doctor_id, localDate()) });
}));

app.post('/api/staff/doctors/:doctorId/pause', authRequired, allow('doctor', 'admin'), asyncRoute(async (req, res) => {
  const doctorId = Number(req.params.doctorId);
  if (!guardDoctorAction(req, res, doctorId)) return;
  const doctor = getDoctor(doctorId);
  if (!doctor) return fail(res, 404, 'Doctor not found');
  const state = ensureState(doctor);
  const shouldPause = req.body.paused === undefined ? !state.paused : Boolean(req.body.paused);
  const now = new Date();
  const nowString = localDateTime(now);

  if (shouldPause && !state.paused) {
    db.prepare('UPDATE doctor_state SET paused = 1, paused_at = ?, updated_at = ? WHERE doctor_id = ?')
      .run(nowString, nowString, doctorId);
    recordAudit({ actor: req.user, action: 'queue.paused', doctorId, details: {} });
  } else if (!shouldPause && state.paused) {
    const pausedSeconds = state.paused_at
      ? Math.max(0, Math.round((now.getTime() - new Date(state.paused_at).getTime()) / 1000))
      : 0;
    db.prepare(`
      UPDATE doctor_state
      SET paused = 0, paused_at = NULL, paused_accum_seconds = paused_accum_seconds + ?, updated_at = ?
      WHERE doctor_id = ?
    `).run(pausedSeconds, nowString, doctorId);
    recordAudit({ actor: req.user, action: 'queue.resumed', doctorId, details: { pausedSeconds } });
  }

  const queue = getDoctorQueue(doctorId, localDate());
  if (shouldPause && queue.queue.length) {
    for (const item of queue.queue) {
      await dispatchAlert({
        appointmentId: item.id,
        template: 'delay',
        channels: ['sms', 'app', 'voice'],
        etaMinutes: item.etaMinutes
      });
    }
  } else if (!shouldPause && queue.queue.length) {
    for (const item of queue.queue) {
      await dispatchAlert({
        appointmentId: item.id,
        template: 'resume',
        channels: ['app', 'voice'],
        etaMinutes: item.etaMinutes
      });
    }
  }

  broadcastQueue(doctorId);
  res.json({ queue: getDoctorQueue(doctorId, localDate()), paused: shouldPause });
}));

app.post('/api/staff/alerts', authRequired, asyncRoute(async (req, res) => {
  const appointmentId = Number(req.body.appointmentId);
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
  if (!appointment) return fail(res, 404, 'Appointment not found');
  if (req.user.role === 'doctor' && !canManageDoctor(req.user, appointment.doctor_id)) {
    return fail(res, 403, 'You can only alert your own patients');
  }
  const template = ['turn', 'delay', 'custom', 'resume'].includes(req.body.template) ? req.body.template : 'custom';
  const language = ALLOWED_LANGUAGES.includes(req.body.language) ? req.body.language : appointment.language;
  const ticket = getTicketStatus(appointment.ticket_code);
  try {
    const records = await dispatchAlert({
      appointmentId,
      template,
      language,
      customMessage: cleanString(req.body.message, 400),
      etaMinutes: ticket?.etaMinutes,
      position: ticket?.position,
      channels: ['sms', 'app', 'voice']
    });
    recordAudit({ actor: req.user, action: 'alert.sent', appointmentId, doctorId: appointment.doctor_id, details: { template, language } });
    res.json({ ok: true, notifications: records });
  } catch (error) {
    return fail(res, 500, error.message);
  }
}));

app.get('/api/admin/analytics', authRequired, allow('admin'), (req, res) => {
  const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily';
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : null;
  res.json(getAnalytics(period, req.query.anchor || localDate(), departmentId));
});

app.get('/api/admin/export', authRequired, allow('admin'), (req, res) => {
  const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily';
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : null;
  const rows = getExportRows(period, req.query.anchor || localDate(), departmentId);
  const headers = ['Ticket', 'Token', 'Patient', 'Phone', 'Age', 'Gender', 'Date', 'Slot', 'Type', 'Priority', 'Status', 'Department', 'Doctor', 'Check-in', 'Called', 'Started', 'Completed', 'Created'];
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push([
      row.ticket_code, row.token_no, row.patient_name, row.phone, row.age, row.gender,
      row.appointment_date, row.slot_time, row.kind, row.priority, row.status,
      row.department, row.doctor, row.checkin_at, row.called_at, row.started_at,
      row.completed_at, row.created_at
    ].map(escape).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sqms-${period}-${localDate()}.csv"`);
  res.send(`\uFEFF${lines.join('\r\n')}`);
});

app.get('/api/admin/staff', authRequired, allow('admin'), (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.phone, u.active, u.created_at,
           u.department_id, u.doctor_id, d.name AS department_name, doc.name AS doctor_name
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN doctors doc ON doc.id = u.doctor_id
    ORDER BY u.role, u.name
  `).all();
  res.json({ staff: users.map(publicUser) });
});

app.post('/api/admin/staff', authRequired, allow('admin'), (req, res) => {
  const name = cleanString(req.body.name, 80);
  const email = cleanString(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '');
  const role = req.body.role;
  const departmentId = req.body.departmentId ? Number(req.body.departmentId) : null;
  const doctorId = req.body.doctorId ? Number(req.body.doctorId) : null;
  const phone = normalizePhone(req.body.phone) || null;
  if (!name || !email || !password) return fail(res, 400, 'Name, email and password are required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 400, 'Enter a valid email address');
  if (password.length < 6) return fail(res, 400, 'Password must be at least 6 characters');
  if (!['admin', 'doctor', 'nurse', 'receptionist'].includes(role)) return fail(res, 400, 'Invalid role');
  if (role === 'doctor' && !doctorId) return fail(res, 400, 'Select a doctor profile for doctor accounts');
  const exists = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
  if (exists) return fail(res, 409, 'An account with this email already exists');

  const now = localDateTime();
  const result = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, department_id, doctor_id, phone, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, email, bcrypt.hashSync(password, 10), role, departmentId, doctorId, phone, now);
  recordAudit({ actor: req.user, action: 'staff.created', details: { role, email } });
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.patch('/api/admin/staff/:id', authRequired, allow('admin'), (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return fail(res, 404, 'Staff member not found');
  if (id === req.user.id && req.body.active === false) return fail(res, 400, 'You cannot deactivate your own account');
  const updates = [];
  const values = [];
  if (req.body.name !== undefined) {
    updates.push('name = ?');
    values.push(cleanString(req.body.name, 80));
  }
  if (req.body.phone !== undefined) {
    updates.push('phone = ?');
    values.push(normalizePhone(req.body.phone) || null);
  }
  if (req.body.active !== undefined) {
    updates.push('active = ?');
    values.push(req.body.active ? 1 : 0);
  }
  if (req.body.password) {
    if (String(req.body.password).length < 6) return fail(res, 400, 'Password must be at least 6 characters');
    updates.push('password_hash = ?');
    values.push(bcrypt.hashSync(String(req.body.password), 10));
  }
  if (!updates.length) return fail(res, 400, 'No changes supplied');
  values.push(id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  recordAudit({ actor: req.user, action: 'staff.updated', details: { staffId: id } });
  res.json({ ok: true });
});

app.get('/api/admin/departments', authRequired, allow('admin'), (req, res) => {
  const departments = db.prepare('SELECT * FROM departments ORDER BY id').all();
  const doctors = db.prepare('SELECT * FROM doctors ORDER BY department_id, id').all();
  res.json({
    departments: departments.map((department) => ({
      ...department,
      doctors: doctors.filter((doctor) => doctor.department_id === department.id)
    }))
  });
});

app.get('/api/admin/notifications', authRequired, allow('admin'), (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const notifications = db.prepare(`
    SELECT n.*, a.patient_name, a.token_no, d.code AS department_code
    FROM notifications n
    LEFT JOIN appointments a ON a.id = n.appointment_id
    LEFT JOIN departments d ON d.id = a.department_id
    ORDER BY n.id DESC LIMIT ?
  `).all(limit);
  res.json({ notifications });
});

app.get('/api/admin/audit', authRequired, allow('admin'), (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const logs = db.prepare(`
    SELECT l.*, u.name AS actor_name
    FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id
    ORDER BY l.id DESC LIMIT ?
  `).all(limit);
  res.json({ logs });
});

app.get('/api/admin/doctors', authRequired, allow('admin'), (req, res) => {
  const doctors = db.prepare(`
    SELECT doc.*, d.name AS department_name, d.code AS department_code
    FROM doctors doc JOIN departments d ON d.id = doc.department_id
    ORDER BY d.id, doc.id
  `).all();
  res.json({ doctors });
});

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.json({
      service: 'SQMS API',
      message: 'Web build not found. Run npm run dev for development or npm run build for production.',
      health: '/api/health'
    });
  });
}

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((error, req, res, next) => {
  console.error('[sqms]', error);
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({ error: error.message || 'Something went wrong' });
});

io.on('connection', (socket) => {
  socket.emit('connected', { at: localDateTime() });
});

server.listen(PORT, () => {
  console.log(`SQMS API running at http://localhost:${PORT}`);
});
