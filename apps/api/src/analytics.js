const { db, localDate } = require('./db');
const { dateRangeForPeriod, eachDate, minutesBetween, hourLabel, PRIORITY_LABEL } = require('./utils');

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function getAnalytics(period = 'daily', anchor = localDate(), departmentId = null) {
  const range = dateRangeForPeriod(period, anchor);
  const params = [range.from, range.to];
  let filter = 'a.appointment_date BETWEEN ? AND ?';
  if (departmentId) {
    filter += ' AND a.department_id = ?';
    params.push(departmentId);
  }

  const rows = db.prepare(`
    SELECT a.*, d.name AS dept_name, d.code AS dept_code, d.color AS dept_color,
           doc.name AS doctor_name, doc.room AS doctor_room
    FROM appointments a
    JOIN departments d ON d.id = a.department_id
    JOIN doctors doc ON doc.id = a.doctor_id
    WHERE ${filter}
    ORDER BY a.appointment_date ASC, a.created_at ASC
  `).all(...params);

  const departments = db.prepare('SELECT * FROM departments WHERE active = 1 ORDER BY id ASC').all();
  const doctors = db.prepare(`
    SELECT doc.*, d.name AS dept_name
    FROM doctors doc JOIN departments d ON d.id = doc.department_id
    WHERE doc.active = 1 ORDER BY doc.id ASC
  `).all();

  const served = rows.filter((row) => row.status === 'served');
  const active = rows.filter((row) => ['waiting', 'called', 'in_consultation'].includes(row.status));
  const booked = rows.filter((row) => row.status === 'booked');
  const skipped = rows.filter((row) => row.status === 'skipped');
  const cancelled = rows.filter((row) => row.status === 'cancelled');
  const noShow = rows.filter((row) => row.status === 'no_show');
  const emergency = rows.filter((row) => row.priority === 'emergency');

  const waitRows = served
    .filter((row) => row.checkin_at && (row.called_at || row.started_at))
    .map((row) => minutesBetween(row.checkin_at, new Date(row.called_at || row.started_at)));
  const consultRows = served
    .filter((row) => row.started_at && row.completed_at)
    .map((row) => minutesBetween(row.started_at, new Date(row.completed_at)));

  const checkinHours = rows
    .filter((row) => row.checkin_at)
    .map((row) => Number(row.checkin_at.slice(11, 13)));
  const hourCounts = {};
  for (const hour of checkinHours) hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  const peakHourValue = Object.entries(hourCounts).sort((left, right) => right[1] - left[1])[0];
  const peakHour = peakHourValue ? hourLabel(Number(peakHourValue[0])) : '—';

  const trendDates = eachDate(range.from, range.to);
  const trend = trendDates.map((date) => {
    const dayRows = rows.filter((row) => row.appointment_date === date);
    return {
      date,
      bookings: dayRows.length,
      served: dayRows.filter((row) => row.status === 'served').length,
      avgWait: average(dayRows
        .filter((row) => row.status === 'served' && row.checkin_at && (row.called_at || row.started_at))
        .map((row) => minutesBetween(row.checkin_at, new Date(row.called_at || row.started_at))))
    };
  });

  const byDepartment = departments
    .filter((department) => !departmentId || department.id === Number(departmentId))
    .map((department) => {
      const deptRows = rows.filter((row) => row.department_id === department.id);
      const deptServed = deptRows.filter((row) => row.status === 'served');
      return {
        id: department.id,
        code: department.code,
        name: department.name,
        color: department.color,
        bookings: deptRows.length,
        served: deptServed.length,
        active: deptRows.filter((row) => ['waiting', 'called', 'in_consultation'].includes(row.status)).length,
        avgWait: average(deptServed
          .filter((row) => row.checkin_at && (row.called_at || row.started_at))
          .map((row) => minutesBetween(row.checkin_at, new Date(row.called_at || row.started_at)))),
        avgConsult: average(deptServed
          .filter((row) => row.started_at && row.completed_at)
          .map((row) => minutesBetween(row.started_at, new Date(row.completed_at))))
      };
    });

  const priorityMix = ['emergency', 'senior', 'pregnant', 'disabled', 'general'].map((priority) => ({
    priority,
    label: PRIORITY_LABEL[priority],
    count: rows.filter((row) => row.priority === priority).length
  }));

  const doctorStats = doctors
    .filter((doctor) => !departmentId || doctor.department_id === Number(departmentId))
    .map((doctor) => {
      const doctorRows = rows.filter((row) => row.doctor_id === doctor.id);
      const doctorServed = doctorRows.filter((row) => row.status === 'served');
      return {
        id: doctor.id,
        name: doctor.name,
        department: doctor.dept_name,
        room: doctor.room,
        bookings: doctorRows.length,
        served: doctorServed.length,
        active: doctorRows.filter((row) => ['waiting', 'called', 'in_consultation'].includes(row.status)).length,
        avgWait: average(doctorServed
          .filter((row) => row.checkin_at && (row.called_at || row.started_at))
          .map((row) => minutesBetween(row.checkin_at, new Date(row.called_at || row.started_at)))),
        avgConsult: average(doctorServed
          .filter((row) => row.started_at && row.completed_at)
          .map((row) => minutesBetween(row.started_at, new Date(row.completed_at))))
      };
    })
    .filter((doctor) => doctor.bookings > 0)
    .sort((left, right) => right.served - left.served);

  const hourly = [];
  for (let hour = 7; hour <= 20; hour += 1) {
    hourly.push({
      hour,
      label: hourLabel(hour),
      checkins: hourCounts[hour] || 0
    });
  }

  const servedRate = rows.length ? Math.round((served.length / rows.length) * 100) : 0;

  return {
    period,
    range,
    generatedAt: localDate(),
    summary: {
      totalBookings: rows.length,
      served: served.length,
      active: active.length,
      waiting: active.filter((row) => row.status === 'waiting').length,
      booked: booked.length,
      skipped: skipped.length,
      cancelled: cancelled.length,
      noShow: noShow.length,
      emergency: emergency.length,
      avgWait: average(waitRows),
      avgConsult: average(consultRows),
      peakHour,
      servedRate,
      noShowRate: rows.length ? Math.round((noShow.length / rows.length) * 100) : 0
    },
    trend,
    hourly,
    byDepartment,
    priorityMix,
    doctorStats,
    recentActivity: db.prepare(`
      SELECT id, action, actor_role, details, created_at
      FROM audit_log
      ORDER BY id DESC
      LIMIT 8
    `).all()
  };
}

function getExportRows(period, anchor, departmentId = null) {
  const range = dateRangeForPeriod(period, anchor);
  const params = [range.from, range.to];
  let filter = 'a.appointment_date BETWEEN ? AND ?';
  if (departmentId) {
    filter += ' AND a.department_id = ?';
    params.push(departmentId);
  }
  return db.prepare(`
    SELECT a.ticket_code, a.token_no, a.patient_name, a.phone, a.age, a.gender,
           a.appointment_date, a.slot_time, a.kind, a.priority, a.status,
           d.name AS department, doc.name AS doctor, a.checkin_at, a.called_at,
           a.started_at, a.completed_at, a.created_at
    FROM appointments a
    JOIN departments d ON d.id = a.department_id
    JOIN doctors doc ON doc.id = a.doctor_id
    WHERE ${filter}
    ORDER BY a.appointment_date DESC, a.id DESC
  `).all(...params);
}

module.exports = {
  getAnalytics,
  getExportRows
};
