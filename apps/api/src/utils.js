const { localDate, localDateTime } = require('./db');

const PRIORITY_RANK = {
  emergency: 0,
  senior: 1,
  pregnant: 1,
  disabled: 1,
  general: 2
};

const PRIORITY_LABEL = {
  emergency: 'Emergency',
  senior: 'Senior citizen',
  pregnant: 'Pregnant',
  disabled: 'Differently abled',
  general: 'General'
};

function parseLocal(value) {
  if (!value) return null;
  return new Date(value);
}

function minutesBetween(from, to = new Date()) {
  const start = parseLocal(from);
  if (!start || Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.round((to.getTime() - start.getTime()) / 60000));
}

function secondsBetween(from, to = new Date()) {
  const start = parseLocal(from);
  if (!start || Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.round((to.getTime() - start.getTime()) / 1000));
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function tokenLabel(code, tokenNo) {
  return `${code}-${String(tokenNo).padStart(3, '0')}`;
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function maskPhone(value) {
  const phone = String(value || '');
  if (phone.length < 4) return phone;
  return `${'•'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
}

function isValidPhone(value) {
  const phone = normalizePhone(value).replace(/^\+/, '');
  return phone.length >= 10 && phone.length <= 13;
}

function dateRangeForPeriod(period = 'daily', anchor = localDate()) {
  const today = new Date(`${anchor}T12:00:00`);
  if (period === 'weekly') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { from: localDate(start), to: anchor, days: 7, label: 'Last 7 days' };
  }
  if (period === 'monthly') {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { from: localDate(start), to: anchor, days: 30, label: 'Last 30 days' };
  }
  return { from: anchor, to: anchor, days: 1, label: 'Today' };
}

function eachDate(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cursor <= end) {
    dates.push(localDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function hourLabel(hour) {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${suffix}`;
}

function safeJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

module.exports = {
  PRIORITY_RANK,
  PRIORITY_LABEL,
  parseLocal,
  minutesBetween,
  secondsBetween,
  addMinutes,
  tokenLabel,
  normalizePhone,
  maskPhone,
  isValidPhone,
  dateRangeForPeriod,
  eachDate,
  hourLabel,
  safeJson,
  localDateTime
};
