const jwt = require('jsonwebtoken');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'sqms-development-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      doctorId: user.doctor_id,
      departmentId: user.department_id
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    departmentId: user.department_id,
    doctorId: user.doctor_id,
    phone: user.phone,
    active: Boolean(user.active),
    departmentName: user.department_name || null,
    doctorName: user.doctor_name || null
  };
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare(`
      SELECT u.*, d.name AS department_name, doc.name AS doctor_name
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      LEFT JOIN doctors doc ON doc.id = u.doctor_id
      WHERE u.id = ? AND u.active = 1
    `).get(payload.sub);

    if (!user) return res.status(401).json({ error: 'Account is not active' });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
}

function allow(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission for this action' });
    }
    return next();
  };
}

function canManageDoctor(user, doctorId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.role === 'doctor' && Number(user.doctor_id) === Number(doctorId);
}

function canFrontDesk(user) {
  return Boolean(user && ['admin', 'nurse', 'receptionist'].includes(user.role));
}

module.exports = {
  signToken,
  publicUser,
  authRequired,
  allow,
  canManageDoctor,
  canFrontDesk,
  JWT_SECRET
};
