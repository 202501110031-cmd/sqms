const { db, localDate, localDateTime } = require('./db');
const {
  PRIORITY_RANK,
  PRIORITY_LABEL,
  minutesBetween,
  secondsBetween,
  addMinutes,
  tokenLabel,
  maskPhone
} = require('./utils');

const WAITING = 'waiting';
const ACTIVE = ['waiting', 'called', 'in_consultation'];
const STATUS_LABELS = {
  booked: 'Booked',
  waiting: 'Waiting',
  called: 'Now called',
  in_consultation: 'In consultation',
  served: 'Completed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
  no_show: 'No show'
};

function getDoctor(doctorId) {
  return db.prepare(`
    SELECT doc.*, d.name AS department_name, d.name_mr AS department_name_mr,
           d.name_hi AS department_name_hi, d.code AS department_code, d.color AS department_color
    FROM doctors doc
    JOIN departments d ON d.id = doc.department_id
    WHERE doc.id = ?
  `).get(doctorId);
}

function ensureState(doctor) {
  let state = db.prepare('SELECT * FROM doctor_state WHERE doctor_id = ?').get(doctor.id);
  if (!state) {
    db.prepare(`
      INSERT INTO doctor_state (doctor_id, paused, paused_accum_seconds, avg_minutes, updated_at)
      VALUES (?, 0, 0, ?, ?)
    `).run(doctor.id, doctor.avg_minutes, localDateTime());
    state = db.prepare('SELECT * FROM doctor_state WHERE doctor_id = ?').get(doctor.id);
  }
  return state;
}

function sortWaiting(rows) {
  return [...rows].sort((left, right) => {
    const rankDiff = (PRIORITY_RANK[left.priority] ?? 9) - (PRIORITY_RANK[right.priority] ?? 9);
    if (rankDiff !== 0) return rankDiff;
    const leftTime = new Date(left.checkin_at || left.created_at).getTime();
    const rightTime = new Date(right.checkin_at || right.created_at).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id - right.id;
  });
}

function decorate(row, doctor) {
  if (!row) return null;
  return {
    id: row.id,
    ticketCode: row.ticket_code,
    tokenNo: row.token_no,
    tokenLabel: tokenLabel(doctor.department_code, row.token_no),
    patientName: row.patient_name,
    phone: row.phone,
    phoneMasked: maskPhone(row.phone),
    age: row.age,
    gender: row.gender,
    departmentId: row.department_id,
    doctorId: row.doctor_id,
    date: row.appointment_date,
    slotTime: row.slot_time,
    kind: row.kind,
    priority: row.priority,
    priorityLabel: PRIORITY_LABEL[row.priority] || row.priority,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    language: row.language,
    notes: row.notes,
    source: row.source,
    checkinAt: row.checkin_at,
    calledAt: row.called_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    skippedAt: row.skipped_at,
    createdAt: row.created_at,
    waitMinutes: row.checkin_at ? minutesBetween(row.checkin_at, row.called_at || row.started_at ? new Date(row.called_at || row.started_at) : new Date()) : null,
    consultMinutes: row.started_at && row.completed_at ? minutesBetween(row.started_at, new Date(row.completed_at)) : null
  };
}

function getDoctorQueue(doctorId, date = localDate()) {
  const doctor = getDoctor(doctorId);
  if (!doctor) return null;
  const state = ensureState(doctor);
  const rows = db.prepare(`
    SELECT * FROM appointments
    WHERE doctor_id = ? AND appointment_date = ?
    ORDER BY id ASC
  `).all(doctorId, date);

  const waiting = sortWaiting(rows.filter((row) => row.status === WAITING));
  const current = rows.find((row) => ['called', 'in_consultation'].includes(row.status)) || null;
  const skipped = rows
    .filter((row) => row.status === 'skipped')
    .sort((left, right) => new Date(right.skipped_at || right.updated_at) - new Date(left.skipped_at || left.updated_at));
  const booked = rows
    .filter((row) => row.status === 'booked')
    .sort((left, right) => String(left.slot_time || '').localeCompare(String(right.slot_time || '')));
  const served = rows
    .filter((row) => row.status === 'served')
    .sort((left, right) => new Date(right.completed_at || right.updated_at) - new Date(left.completed_at || left.updated_at));

  const avgMinutes = Number(state.avg_minutes || doctor.avg_minutes || 12);
  const pausedSeconds = state.paused ? secondsBetween(state.paused_at) : 0;
  const pauseOffsetMinutes = pausedSeconds / 60;

  let currentRemaining = 0;
  if (current) {
    if (current.status === 'in_consultation') {
      currentRemaining = Math.max(1, avgMinutes - minutesBetween(current.started_at || current.called_at));
    } else {
      currentRemaining = Math.max(1, avgMinutes - minutesBetween(current.called_at));
    }
  }

  let rollingEta = currentRemaining + pauseOffsetMinutes;
  const queue = waiting.map((row, index) => {
    const etaMinutes = Math.max(0, Math.round(rollingEta));
    const item = {
      ...decorate(row, doctor),
      position: index + 1,
      peopleAhead: index + (current ? 1 : 0),
      etaMinutes,
      estimatedAt: localDateTime(addMinutes(new Date(), etaMinutes))
    };
    rollingEta += avgMinutes;
    return item;
  });

  const currentItem = current ? {
    ...decorate(current, doctor),
    position: 0,
    peopleAhead: 0,
    etaMinutes: 0,
    estimatedAt: localDateTime(),
    remainingMinutes: Math.round(currentRemaining)
  } : null;

  return {
    date,
    doctor: {
      id: doctor.id,
      name: doctor.name,
      qualification: doctor.qualification,
      room: doctor.room,
      departmentId: doctor.department_id,
      departmentName: doctor.department_name,
      departmentCode: doctor.department_code,
      departmentColor: doctor.department_color,
      avgMinutes: doctor.avg_minutes
    },
    state: {
      paused: Boolean(state.paused),
      pausedAt: state.paused_at,
      pausedForMinutes: Math.round(pauseOffsetMinutes),
      avgMinutes: Math.round(avgMinutes),
      updatedAt: state.updated_at
    },
    current: currentItem,
    next: queue[0] || null,
    queue,
    booked: booked.map((row) => decorate(row, doctor)),
    skipped: skipped.map((row) => decorate(row, doctor)),
    served: served.slice(0, 12).map((row) => decorate(row, doctor)),
    stats: {
      waiting: waiting.length,
      booked: booked.length,
      served: served.length,
      skipped: skipped.length,
      cancelled: rows.filter((row) => row.status === 'cancelled').length,
      noShow: rows.filter((row) => row.status === 'no_show').length,
      total: rows.length
    }
  };
}

function getTicketStatus(code) {
  const appointment = db.prepare(`
    SELECT a.*, d.name AS dept_name, d.name_mr AS dept_name_mr, d.name_hi AS dept_name_hi,
           d.code AS dept_code, d.color AS dept_color,
           doc.name AS doctor_name, doc.qualification, doc.room
    FROM appointments a
    JOIN departments d ON d.id = a.department_id
    JOIN doctors doc ON doc.id = a.doctor_id
    WHERE UPPER(a.ticket_code) = UPPER(?)
  `).get(code);

  if (!appointment) return null;

  const doctor = {
    department_code: appointment.dept_code
  };
  const base = decorate(appointment, doctor);
  let queueState = null;
  let position = null;
  let peopleAhead = null;
  let etaMinutes = null;
  let estimatedAt = null;

  if (['waiting', 'called', 'in_consultation'].includes(appointment.status)) {
    queueState = getDoctorQueue(appointment.doctor_id, appointment.appointment_date);
    if (appointment.status === 'waiting') {
      const found = queueState.queue.find((item) => item.id === appointment.id);
      if (found) {
        position = found.position;
        peopleAhead = found.peopleAhead;
        etaMinutes = found.etaMinutes;
        estimatedAt = found.estimatedAt;
      }
    } else {
      position = 0;
      peopleAhead = 0;
      etaMinutes = 0;
      estimatedAt = localDateTime();
    }
  }

  const notifications = db.prepare(`
    SELECT id, channel, template, language, message, status, created_at
    FROM notifications
    WHERE appointment_id = ?
    ORDER BY id DESC
    LIMIT 5
  `).all(appointment.id);

  const today = localDate();
  return {
    ticket: {
      ...base,
      patientName: appointment.patient_name,
      phoneMasked: maskPhone(appointment.phone),
      notes: appointment.notes
    },
    department: {
      id: appointment.department_id,
      name: appointment.dept_name,
      nameMr: appointment.dept_name_mr,
      nameHi: appointment.dept_name_hi,
      code: appointment.dept_code,
      color: appointment.dept_color
    },
    doctor: {
      id: appointment.doctor_id,
      name: appointment.doctor_name,
      qualification: appointment.qualification,
      room: appointment.room
    },
    position,
    peopleAhead,
    etaMinutes,
    estimatedAt,
    currentServing: queueState?.current ? {
      tokenLabel: queueState.current.tokenLabel,
      tokenNo: queueState.current.tokenNo,
      remainingMinutes: queueState.current.remainingMinutes
    } : null,
    paused: Boolean(queueState?.state?.paused),
    queueLength: queueState?.queue?.length ?? null,
    canCheckIn: appointment.appointment_date === today && appointment.status === 'booked',
    canCancel: appointment.appointment_date >= today && ['booked', 'waiting'].includes(appointment.status),
    notifications
  };
}

function getBoard(departmentId = null) {
  const departments = db.prepare(`
    SELECT * FROM departments WHERE active = 1 ORDER BY id ASC
  `).all();
  const doctors = db.prepare(`
    SELECT * FROM doctors WHERE active = 1 ${departmentId ? 'AND department_id = ?' : ''} ORDER BY id ASC
  `).all(...(departmentId ? [departmentId] : []));
  const today = localDate();

  const entries = doctors.map((doctor) => {
    const queue = getDoctorQueue(doctor.id, today);
    return {
      doctorId: doctor.id,
      doctorName: doctor.name,
      room: doctor.room,
      qualification: doctor.qualification,
      departmentId: doctor.department_id,
      departmentName: queue.doctor.departmentName,
      departmentCode: queue.doctor.departmentCode,
      color: queue.doctor.departmentColor,
      paused: queue.state.paused,
      avgMinutes: queue.state.avgMinutes,
      waiting: queue.queue.length,
      current: queue.current ? {
        tokenLabel: queue.current.tokenLabel,
        tokenNo: queue.current.tokenNo,
        priority: queue.current.priority,
        status: queue.current.status
      } : null,
      next: queue.queue.slice(0, 4).map((item) => ({
        tokenLabel: item.tokenLabel,
        tokenNo: item.tokenNo,
        priority: item.priority,
        etaMinutes: item.etaMinutes
      })),
      nextEtaMinutes: queue.next?.etaMinutes ?? null
    };
  });

  return {
    generatedAt: localDateTime(),
    departments: departments.map((department) => ({
      id: department.id,
      code: department.code,
      name: department.name,
      nameMr: department.name_mr,
      nameHi: department.name_hi,
      color: department.color,
      avgMinutes: department.avg_minutes
    })),
    entries
  };
}

function getOverview(departmentId = null) {
  const departments = db.prepare('SELECT * FROM departments WHERE active = 1 ORDER BY id ASC').all();
  const doctors = db.prepare(`
    SELECT * FROM doctors WHERE active = 1 ${departmentId ? 'AND department_id = ?' : ''} ORDER BY id ASC
  `).all(...(departmentId ? [departmentId] : []));
  const today = localDate();
  return doctors.map((doctor) => {
    const queue = getDoctorQueue(doctor.id, today);
    return {
      doctor: queue.doctor,
      paused: queue.state.paused,
      waiting: queue.stats.waiting,
      booked: queue.stats.booked,
      served: queue.stats.served,
      current: queue.current,
      next: queue.next,
      queue: queue.queue,
      stats: queue.stats
    };
  });
}

module.exports = {
  getDoctor,
  getDoctorQueue,
  getTicketStatus,
  getBoard,
  getOverview,
  ensureState,
  sortWaiting,
  decorate,
  STATUS_LABELS,
  ACTIVE
};
