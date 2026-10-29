import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  HeartPulse,
  LockKeyhole,
  ShieldCheck,
  Stethoscope,
  UserRound,
  Users
} from 'lucide-react';
import { Avatar, Logo, RoleBadge, Spinner } from '../components/UI';
import { useAuth, roleHome } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const DEMO_ACCOUNTS = [
  { role: 'admin', label: 'Administrator', name: 'Hospital Administrator', email: 'admin@sqms.health', password: 'admin123', icon: ShieldCheck },
  { role: 'doctor', label: 'Doctor', name: 'Dr. Anjali Deshmukh', detail: 'Cardiology', email: 'cardio@sqms.health', password: 'doctor123', icon: Stethoscope },
  { role: 'nurse', label: 'Nurse', name: 'Sister Priya More', detail: 'General Medicine', email: 'nurse@sqms.health', password: 'nurse123', icon: HeartPulse },
  { role: 'receptionist', label: 'Receptionist', name: 'Reception Desk', detail: 'General Medicine', email: 'reception@sqms.health', password: 'reception123', icon: Users }
];

export default function LoginPage() {
  const { login, user, loading: authLoading } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: 'admin@sqms.health', password: 'admin123' });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && user) navigate(roleHome(user.role), { replace: true });
  }, [authLoading, user, navigate]);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const loggedIn = await login(form.email.trim(), form.password);
      push(`Welcome, ${loggedIn.name.split(' ')[0]}`);
      navigate(roleHome(loggedIn.role), { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const useDemo = (account) => {
    setForm({ email: account.email, password: account.password });
    setError('');
  };

  return (
    <div className="login-page">
      <section className="login-visual">
        <div className="login-visual-glow" />
        <Link to="/" className="login-brand"><Logo light /></Link>
        <div className="login-visual-copy">
          <span className="eyebrow light"><span className="live-dot" /> Staff workspace</span>
          <h1>One calm view of every waiting room.</h1>
          <p>Priority-aware queues, live predicted waits and multilingual patient alerts — built for the people coordinating care.</p>
          <div className="login-feature-list">
            <div><span><Activity size={18} /></span><div><strong>Live queue control</strong><small>Call, skip, recall and pause with automatic rebalancing</small></div></div>
            <div><span><HeartPulse size={18} /></span><div><strong>Priority care built in</strong><small>Emergency, senior, pregnant and differently abled patients</small></div></div>
            <div><span><ShieldCheck size={18} /></span><div><strong>Role-based access</strong><small>Different controls for doctors, nurses, reception and admin</small></div></div>
          </div>
        </div>
        <div className="login-preview-card">
          <div className="preview-head"><span>Live queue · Cardiology</span><span className="live-pill"><span className="live-dot" /> Live</span></div>
          <div className="preview-serving"><span>Now serving</span><strong>CAR-012</strong><small>Room 204 · Dr. Deshmukh</small></div>
          <div className="preview-next">
            <span>Next</span><b>CAR-013</b><b>CAR-014</b><b>CAR-015</b>
          </div>
        </div>
        <div className="login-visual-foot">SQMS · Smart Queue Time Management</div>
      </section>

      <section className="login-panel">
        <div className="login-panel-inner">
          <Link to="/" className="back-link"><ArrowLeft size={15} /> Back to patient portal</Link>
          <div className="login-heading">
            <span className="eyebrow-small">Secure hospital access</span>
            <h2>Welcome back</h2>
            <p>Sign in with your assigned staff account.</p>
          </div>
          <form onSubmit={submit} className="login-form">
            <label className="field">
              <span>Email address</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="name@hospital.org"
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <span className="password-field">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  placeholder="Enter your password"
                  required
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label="Toggle password">
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn-primary btn-wide login-submit" disabled={submitting}>
              {submitting ? <><Spinner size={16} /> Signing in…</> : <>Sign in <ArrowRight size={17} /></>}
            </button>
            <div className="login-secure"><LockKeyhole size={13} /> Role-based access · hospital staff only</div>
          </form>

          <div className="demo-login">
            <div className="demo-title"><span>Demo accounts</span><small>Tap to fill credentials</small></div>
            <div className="demo-grid">
              {DEMO_ACCOUNTS.map((account) => {
                const Icon = account.icon;
                return (
                  <button
                    key={account.role}
                    type="button"
                    className={`demo-account ${form.email === account.email ? 'is-selected' : ''}`}
                    onClick={() => useDemo(account)}
                  >
                    <span className={`demo-icon role-${account.role}`}><Icon size={17} /></span>
                    <span className="demo-copy">
                      <strong>{account.label}</strong>
                      <small>{account.email}</small>
                    </span>
                    <code>{account.password}</code>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
