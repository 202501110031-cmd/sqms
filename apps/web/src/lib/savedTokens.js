const STORAGE_KEY = 'sqms_saved_tokens';
const MAX_TOKENS = 20;

function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item?.code) : [];
  } catch {
    return [];
  }
}

function writeAll(tokens) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens.slice(0, MAX_TOKENS)));
}

export function getSavedTokens() {
  return readAll().sort((left, right) => String(right.savedAt).localeCompare(String(left.savedAt)));
}

export function saveToken(payload) {
  const ticket = payload?.ticket?.ticket || payload?.ticket || payload;
  const department = payload?.ticket?.department || payload?.department || {};
  const doctor = payload?.ticket?.doctor || payload?.doctor || {};
  const code = ticket?.ticketCode || ticket?.code;
  if (!code) return null;

  const saved = {
    code,
    tokenLabel: ticket.tokenLabel || code,
    patientName: ticket.patientName || '',
    departmentName: department.name || department.departmentName || '',
    doctorName: doctor.name || '',
    room: doctor.room || '',
    date: ticket.date || '',
    time: ticket.slotTime || '',
    kind: ticket.kind || '',
    priority: ticket.priority || 'general',
    status: ticket.status || 'booked',
    savedAt: new Date().toISOString()
  };

  const tokens = readAll().filter((item) => item.code !== code);
  tokens.unshift(saved);
  writeAll(tokens);
  return saved;
}

export function removeSavedToken(code) {
  const next = readAll().filter((item) => item.code !== code);
  writeAll(next);
  return next;
}
