const { db, localDateTime } = require('./db');
const { normalizePhone, tokenLabel } = require('./utils');

let ioInstance = null;

function init(io) {
  ioInstance = io;
}

function buildMessages(template, data) {
  const token = data.ticketLabel || 'your token';
  const room = data.room || 'the consultation room';
  const doctor = data.doctorName || 'the doctor';
  const department = data.departmentName || '';
  const eta = Number.isFinite(data.etaMinutes) ? data.etaMinutes : 'a few';
  const position = data.position || 'next';
  const custom = data.customMessage || '';

  switch (template) {
    case 'turn':
      return {
        en: `Token ${token}. Please proceed to ${room}. ${doctor} is ready to see you.`,
        hi: `टोकन ${token}। कृपया ${room} में आएं। ${doctor} आपको देखने के लिए तैयार हैं।`,
        mr: `टोकन ${token}. कृपया ${room} मध्ये या. ${doctor} तुम्हाला पाहण्यासाठी तयार आहेत.`
      };
    case 'delay':
      return {
        en: `Queue update for ${department}. ${doctor}'s queue is temporarily paused. Your estimated wait is now ${eta} minutes.`,
        hi: `${department} के लिए क्यू अपडेट। ${doctor} की क्यू अस्थायी रूप से रोकी गई है। आपका अनुमानित इंतज़ार अब ${eta} मिनट है।`,
        mr: `${department} साठी रांग अपडेट. ${doctor} यांची रांग तात्पुरती थांबवली आहे. तुमची अंदाजे प्रतीक्षा आता ${eta} मिनिटे आहे.`
      };
    case 'resume':
      return {
        en: `Queue resumed for ${department}. Your estimated wait is now ${eta} minutes.`,
        hi: `${department} के लिए क्यू फिर शुरू हो गई है। आपका अनुमानित इंतज़ार अब ${eta} मिनट है।`,
        mr: `${department} साठी रांग पुन्हा सुरू झाली आहे. तुमची अंदाजे प्रतीक्षा आता ${eta} मिनिटे आहे.`
      };
    case 'skipped':
      return {
        en: `Token ${token} was skipped because you were not present. Please contact the reception desk to be recalled.`,
        hi: `टोकन ${token} छोड़ दिया गया क्योंकि आप उपस्थित नहीं थे। कृपया रिसेप्शन डेस्क से संपर्क करें।`,
        mr: `टोकन ${token} वगळले गेले कारण तुम्ही उपस्थित नव्हते. कृपया रिसेप्शन डेस्कशी संपर्क साधा.`
      };
    case 'booked':
      return {
        en: `Appointment confirmed. Token ${token} for ${department} on ${data.date} at ${data.slot || 'your selected time'}. Track your live queue at ${data.trackUrl}.`,
        hi: `अपॉइंटमेंट की पुष्टि हुई। ${data.date} को ${data.slot || 'चुने गए समय'} पर ${department} के लिए टोकन ${token}। लाइव क्यू यहाँ देखें: ${data.trackUrl}`,
        mr: `अपॉइंटमेंट निश्चित झाली. ${data.date} रोजी ${data.slot || 'निवडलेल्या वेळी'} ${department} साठी टोकन ${token}. लाइव्ह रांग येथे पहा: ${data.trackUrl}`
      };
    case 'checked_in':
      return {
        en: `Check-in successful. Token ${token}. You are number ${position} in the queue. Estimated wait: ${eta} minutes.`,
        hi: `चेक-इन सफल। टोकन ${token}। आप क्यू में ${position} नंबर पर हैं। अनुमानित इंतज़ार: ${eta} मिनट।`,
        mr: `चेक-इन यशस्वी. टोकन ${token}. तुम्ही रांगेत ${position} क्रमांकावर आहात. अंदाजे प्रतीक्षा: ${eta} मिनिटे.`
      };
    case 'cancelled':
      return {
        en: `Token ${token} has been cancelled. Please contact the hospital if this is unexpected.`,
        hi: `टोकन ${token} रद्द कर दिया गया है। अगर यह अनपेक्षित है तो अस्पताल से संपर्क करें।`,
        mr: `टोकन ${token} रद्द करण्यात आले आहे. हे अनपेक्षित असल्यास रुग्णालयाशी संपर्क साधा.`
      };
    case 'custom':
      return {
        en: custom || `Token ${token}: ${data.customMessage || 'Please contact the reception desk.'}`,
        hi: custom || `टोकन ${token}: कृपया रिसेप्शन डेस्क से संपर्क करें।`,
        mr: custom || `टोकन ${token}: कृपया रिसेप्शन डेस्कशी संपर्क साधा.`
      };
    default:
      return {
        en: custom || `Token ${token}: ${room}`,
        hi: custom || `टोकन ${token}: ${room}`,
        mr: custom || `टोकन ${token}: ${room}`
      };
  }
}

function appointmentContext(appointmentId) {
  return db.prepare(`
    SELECT a.*, d.name AS dept_name, d.name_mr AS dept_name_mr, d.name_hi AS dept_name_hi,
           d.code AS dept_code, doc.name AS doctor_name, doc.room
    FROM appointments a
    JOIN departments d ON d.id = a.department_id
    JOIN doctors doc ON doc.id = a.doctor_id
    WHERE a.id = ?
  `).get(appointmentId);
}

async function sendSms(phone, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    return { status: 'simulated', provider: 'demo-sms' };
  }

  try {
    let to = normalizePhone(phone);
    if (!to.startsWith('+')) {
      const countryCode = process.env.TWILIO_DEFAULT_COUNTRY_CODE || '+91';
      to = `${countryCode}${to.replace(/^0+/, '')}`;
    }
    const body = new URLSearchParams({ To: to, From: from, Body: message });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return { status: 'failed', provider: 'twilio', error: payload.message || `HTTP ${response.status}` };
    }
    return { status: 'sent', provider: 'twilio' };
  } catch (error) {
    return { status: 'failed', provider: 'twilio', error: error.message };
  }
}

async function dispatchAlert({
  appointmentId,
  template = 'turn',
  language,
  channels = ['sms', 'app', 'voice'],
  customMessage,
  etaMinutes,
  position,
  trackUrl
}) {
  const appointment = appointmentContext(appointmentId);
  if (!appointment) return [];

  const lang = ['en', 'hi', 'mr'].includes(language) ? language : appointment.language || 'en';
  const departmentName = lang === 'hi' ? appointment.dept_name_hi : lang === 'mr' ? appointment.dept_name_mr : appointment.dept_name;
  const ticketLabel = tokenLabel(appointment.dept_code, appointment.token_no);
  const messages = buildMessages(template, {
    ticketLabel,
    room: appointment.room,
    doctorName: appointment.doctor_name,
    departmentName,
    etaMinutes,
    position,
    customMessage,
    date: appointment.appointment_date,
    slot: appointment.slot_time,
    trackUrl: trackUrl || process.env.PUBLIC_APP_URL || 'http://localhost:5173/track'
  });

  const createdAt = localDateTime();
  const insert = db.prepare(`
    INSERT INTO notifications (
      appointment_id, doctor_id, ticket_code, channel, template, language, phone,
      message, status, provider, error, created_at, sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const records = [];
  for (const channel of channels) {
    let status = 'sent';
    let provider = channel === 'sms' ? 'demo-sms' : 'in-app';
    let error = null;
    if (channel === 'sms') {
      const result = await sendSms(appointment.phone, messages[lang]);
      status = result.status;
      provider = result.provider;
      error = result.error || null;
    }
    const result = insert.run(
      appointment.id,
      appointment.doctor_id,
      appointment.ticket_code,
      channel,
      template,
      lang,
      appointment.phone,
      messages[lang],
      status,
      provider,
      error,
      createdAt,
      status === 'failed' ? null : createdAt
    );
    records.push({
      id: Number(result.lastInsertRowid),
      appointmentId: appointment.id,
      ticketCode: appointment.ticket_code,
      channel,
      template,
      language: lang,
      phone: appointment.phone,
      message: messages[lang],
      messages,
      status,
      provider,
      error,
      createdAt
    });
  }

  if (ioInstance) {
    const payload = {
      id: records[0]?.id,
      appointmentId: appointment.id,
      ticketCode: appointment.ticket_code,
      tokenLabel,
      doctorId: appointment.doctor_id,
      departmentId: appointment.department_id,
      doctorName: appointment.doctor_name,
      room: appointment.room,
      departmentName,
      template,
      language: lang,
      messages,
      etaMinutes,
      position,
      createdAt
    };
    ioInstance.emit('alert:app', payload);
    if (channels.includes('voice')) ioInstance.emit('alert:voice', payload);
    ioInstance.emit('notifications:changed');
  }

  return records;
}

function recordAudit({ actor, action, appointmentId, doctorId, details }) {
  db.prepare(`
    INSERT INTO audit_log (actor_id, actor_role, action, appointment_id, doctor_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    actor?.id || null,
    actor?.role || 'system',
    action,
    appointmentId || null,
    doctorId || null,
    typeof details === 'string' ? details : JSON.stringify(details || {}),
    localDateTime()
  );
}

module.exports = {
  init,
  dispatchAlert,
  recordAudit,
  buildMessages,
  appointmentContext
};
