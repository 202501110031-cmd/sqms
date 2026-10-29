import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock3,
  HeartPulse,
  Languages,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Ticket,
  Users,
  Volume2
} from 'lucide-react';
import PublicNav, { PublicFooter } from '../components/PublicNav';
import { LoadingBlock, PriorityBadge, SecureNote, Spinner, SuccessMark } from '../components/UI';
import { useLanguage, localDepartmentName } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { socket } from '../lib/socket';
import { addDaysISO, todayISO } from '../lib/format';

const PRIORITIES = [
  { value: 'general', icon: Users },
  { value: 'senior', icon: Sparkles },
  { value: 'pregnant', icon: HeartPulse },
  { value: 'disabled', icon: ShieldCheck },
  { value: 'emergency', icon: AlertTriangle }
];

const initialForm = {
  kind: 'walkin',
  patientName: '',
  phone: '',
  age: '',
  gender: 'female',
  departmentId: '',
  doctorId: '',
  date: todayISO(),
  slotTime: '',
  priority: 'general',
  language: 'en',
  notes: ''
};

export default function HomePage() {
  const { t, language, setLanguage } = useLanguage();
  const { push } = useToast();
  const [departments, setDepartments] = useState([]);
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...initialForm, language });
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  const selectedDepartment = departments.find((department) => String(department.id) === String(form.departmentId));
  const doctors = selectedDepartment?.doctors || [];
  const selectedDoctor = doctors.find((doctor) => String(doctor.id) === String(form.doctorId));

  const load = async () => {
    try {
      const [departmentData, boardData] = await Promise.all([
        api('/api/public/departments', { auth: false }),
        api('/api/public/board', { auth: false })
      ]);
      setDepartments(departmentData.departments);
      setBoard(boardData);
      if (!form.departmentId && departmentData.departments.length) {
        const first = departmentData.departments[0];
        setForm((current) => ({
          ...current,
          departmentId: first.id,
          doctorId: first.doctors?.[0]?.id || ''
        }));
      }
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onQueue = () => load();
    socket.on('board:changed', onQueue);
    socket.on('queue:changed', onQueue);
    const interval = window.setInterval(load, 25000);
    return () => {
      socket.off('board:changed', onQueue);
      socket.off('queue:changed', onQueue);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setForm((current) => ({ ...current, language }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    if (!form.departmentId) return;
    const department = departments.find((item) => String(item.id) === String(form.departmentId));
    if (!department) return;
    const doctorExists = department.doctors.some((doctor) => String(doctor.id) === String(form.doctorId));
    if (!doctorExists) {
      setForm((current) => ({ ...current, doctorId: department.doctors?.[0]?.id || '', slotTime: '' }));
    }
  }, [form.departmentId, departments]);

  useEffect(() => {
    let active = true;
    if (form.kind !== 'appointment' || !form.doctorId || !form.date) {
      setSlots([]);
      return () => { active = false; };
    }
    setSlotsLoading(true);
    api(`/api/public/slots?doctorId=${form.doctorId}&date=${form.date}`, { auth: false })
      .then((data) => {
        if (!active) return;
        setSlots(data.slots);
        setForm((current) => {
          const stillAvailable = data.slots.some((slot) => slot.time === current.slotTime && slot.available);
          return stillAvailable ? current : { ...current, slotTime: data.slots.find((slot) => slot.available)?.time || '' };
        });
      })
      .catch((error) => push(error.message, 'error'))
      .finally(() => {
        if (active) setSlotsLoading(false);
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.kind, form.doctorId, form.date]);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const chooseDepartment = (department) => {
    setForm((current) => ({
      ...current,
      departmentId: department.id,
      doctorId: department.doctors?.[0]?.id || '',
      slotTime: ''
    }));
    document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        age: form.age === '' ? null : Number(form.age),
        departmentId: Number(form.departmentId),
        doctorId: Number(form.doctorId),
        date: form.kind === 'walkin' ? todayISO() : form.date,
        slotTime: form.kind === 'walkin' ? null : form.slotTime || null,
        selfCheckIn: form.kind === 'walkin'
      };
      const result = await api('/api/public/bookings', { method: 'POST', auth: false, body: payload });
      setConfirmation(result);
      push(form.kind === 'walkin' ? 'Your token is ready' : 'Appointment confirmed');
      window.setTimeout(() => document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' }), 50);
      load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const resetBooking = () => {
    setConfirmation(null);
    setForm({ ...initialForm, language, departmentId: form.departmentId, doctorId: form.doctorId });
  };

  const liveEntries = useMemo(() => board?.entries || [], [board]);

  return (
    <div className="public-shell">
      <PublicNav />
      <main>
        <section className="hero-section">
          <div className="hero-mesh" aria-hidden="true">
            <span className="mesh-one" />
            <span className="mesh-two" />
            <span className="mesh-three" />
          </div>
          <div className="hero-inner">
            <div className="hero-copy">
              <span className="eyebrow"><span className="live-dot" /> {t('home.eyebrow')}</span>
              <h1>{t('home.title')} <span className="hero-highlight">SQMS</span></h1>
              <p className="hero-subtitle">{t('home.subtitle')}</p>
              <div className="hero-badges">
                <span><Ticket size={15} /> {t('home.bookBadge')}</span>
                <span><Activity size={15} /> {t('home.liveBadge')}</span>
                <span><Languages size={15} /> {t('home.voiceBadge')}</span>
              </div>
              <div className="hero-proof">
                <div className="proof-avatars">
                  <span>AD</span><span>RP</span><span>MJ</span><span>+</span>
                </div>
                <div>
                  <strong>Priority-aware queues</strong>
                  <small>Emergency · senior · pregnant · differently abled</small>
                </div>
              </div>
              <div className="hero-float-card">
                <div className="hero-float-icon"><BellRing size={18} /></div>
                <div>
                  <span>Token GEN-014 is now being called</span>
                  <small>Voice alert · मराठी</small>
                </div>
                <Volume2 size={17} className="pulse-icon" />
              </div>
            </div>

            <div className="booking-card" id="booking">
              {confirmation ? (
                <BookingSuccess confirmation={confirmation} onReset={resetBooking} t={t} />
              ) : (
                <>
                  <div className="booking-card-head">
                    <div>
                      <span className="eyebrow-small">{t('home.bookEyebrow')}</span>
                      <h2>{t('home.bookTitle')}</h2>
                      <p>{t('home.bookSubtitle')}</p>
                    </div>
                    <span className="no-login-chip"><ShieldCheck size={14} /> No login</span>
                  </div>
                  <div className="kind-switch">
                    <button type="button" className={form.kind === 'walkin' ? 'is-active' : ''} onClick={() => update('kind', 'walkin')}>
                      <Ticket size={16} /> {t('home.walkin')}
                    </button>
                    <button type="button" className={form.kind === 'appointment' ? 'is-active' : ''} onClick={() => update('kind', 'appointment')}>
                      <Clock3 size={16} /> {t('home.appointment')}
                    </button>
                  </div>
                  <form onSubmit={handleSubmit} className="booking-form">
                    <div className="form-grid two">
                      <label className="field">
                        <span>{t('home.patientName')}</span>
                        <input
                          required
                          value={form.patientName}
                          onChange={(event) => update('patientName', event.target.value)}
                          placeholder={t('home.patientNamePlaceholder')}
                        />
                      </label>
                      <label className="field">
                        <span>{t('home.phone')}</span>
                        <input
                          required
                          inputMode="tel"
                          value={form.phone}
                          onChange={(event) => update('phone', event.target.value)}
                          placeholder={t('home.phonePlaceholder')}
                        />
                      </label>
                    </div>
                    <div className="form-grid three">
                      <label className="field">
                        <span>{t('home.age')}</span>
                        <input type="number" min="0" max="120" value={form.age} onChange={(event) => update('age', event.target.value)} placeholder="34" />
                      </label>
                      <label className="field">
                        <span>{t('home.gender')}</span>
                        <select value={form.gender} onChange={(event) => update('gender', event.target.value)}>
                          <option value="female">{t('home.female')}</option>
                          <option value="male">{t('home.male')}</option>
                          <option value="other">{t('home.other')}</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>{t('common.language')}</span>
                        <select value={form.language} onChange={(event) => { update('language', event.target.value); setLanguage(event.target.value); }}>
                          <option value="en">English</option>
                          <option value="mr">मराठी</option>
                          <option value="hi">हिंदी</option>
                        </select>
                      </label>
                    </div>
                    <div className="form-grid two">
                      <label className="field">
                        <span>{t('home.department')}</span>
                        <select value={form.departmentId} onChange={(event) => update('departmentId', event.target.value)} required>
                          <option value="">{t('home.selectDepartment')}</option>
                          {departments.map((department) => (
                            <option key={department.id} value={department.id}>{localDepartmentName(department, language)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>{t('home.doctor')}</span>
                        <select value={form.doctorId} onChange={(event) => update('doctorId', event.target.value)} required>
                          <option value="">{t('home.selectDoctor')}</option>
                          {doctors.map((doctor) => (
                            <option key={doctor.id} value={doctor.id}>{doctor.name} · {doctor.room}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {form.kind === 'appointment' && (
                      <div className="form-grid two">
                        <label className="field">
                          <span>{t('home.date')}</span>
                          <input type="date" min={todayISO()} max={addDaysISO(30)} value={form.date} onChange={(event) => update('date', event.target.value)} />
                        </label>
                        <label className="field">
                          <span>{t('home.slot')}</span>
                          <select value={form.slotTime} onChange={(event) => update('slotTime', event.target.value)} disabled={slotsLoading || !form.doctorId}>
                            <option value="">{slotsLoading ? t('common.loading') : t('home.selectSlot')}</option>
                            {slots.filter((slot) => slot.available).map((slot) => (
                              <option key={slot.time} value={slot.time}>{slot.time}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                    <div className="priority-section">
                      <div className="field-label-row">
                        <span>{t('home.priority')}</span>
                        <small>{t('home.priorityHint')}</small>
                      </div>
                      <div className="priority-options">
                        {PRIORITIES.map((priority) => {
                          const Icon = priority.icon;
                          return (
                            <button
                              type="button"
                              key={priority.value}
                              className={`priority-option priority-${priority.value} ${form.priority === priority.value ? 'is-selected' : ''}`}
                              onClick={() => update('priority', priority.value)}
                            >
                              <Icon size={15} />
                              {t(`priority.${priority.value}`)}
                            </button>
                          );
                        })}
                      </div>
                      {form.priority === 'emergency' && (
                        <div className="inline-warning"><AlertTriangle size={14} /> {t('home.emergencyNote')}</div>
                      )}
                    </div>
                    <label className="field">
                      <span>{t('home.notes')} <em>{t('common.optional')}</em></span>
                      <textarea rows="2" value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder={t('home.notesPlaceholder')} />
                    </label>
                    <button className="btn btn-primary btn-wide booking-submit" type="submit" disabled={submitting}>
                      {submitting ? <><Spinner size={16} /> {t('home.submitting')}</> : (
                        <>
                          {form.kind === 'walkin' ? t('home.submitWalkin') : t('home.submitAppointment')}
                          <ArrowRight size={17} />
                        </>
                      )}
                    </button>
                    <SecureNote>{t('track.smsNote')}</SecureNote>
                  </form>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="trust-strip">
          <div><ShieldCheck /><span><strong>No patient login</strong><small>Book as a guest, track with your code</small></span></div>
          <div><Activity /><span><strong>Live predicted wait</strong><small>Rebalanced as the queue moves</small></span></div>
          <div><HeartPulse /><span><strong>Priority care</strong><small>Emergency and vulnerable patients first</small></span></div>
          <div><Volume2 /><span><strong>Multilingual alerts</strong><small>SMS, app and voice in 3 languages</small></span></div>
        </section>

        <section className="section departments-section">
          <div className="section-head">
            <div>
              <span className="eyebrow">{t('home.departmentsEyebrow')}</span>
              <h2>{t('home.departmentsTitle')}</h2>
              <p>{t('home.departmentsSubtitle')}</p>
            </div>
            <button className="btn btn-ghost" onClick={() => document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })}>
              {t('nav.book')} <ArrowRight size={16} />
            </button>
          </div>
          {loading ? <LoadingBlock /> : (
            <div className="department-grid">
              {departments.map((department, index) => (
                <article className="department-card" key={department.id} style={{ '--dept-color': department.color, '--delay': `${index * 60}ms` }}>
                  <div className="department-card-top">
                    <span className="department-icon"><Stethoscope size={20} /></span>
                    <span className="department-code">{department.code}</span>
                  </div>
                  <h3>{localDepartmentName(department, language)}</h3>
                  <p>{department.description}</p>
                  <div className="department-doctors">
                    {department.doctors.map((doctor) => (
                      <div className="mini-doctor" key={doctor.id}>
                        <span className="doctor-dot" />
                        <span className="mini-doctor-name">{doctor.name}</span>
                        <span className={doctor.paused ? 'mini-wait paused' : 'mini-wait'}>
                          {doctor.paused ? t('home.paused') : `${doctor.waiting} ${t('home.waitingNow')}`}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="department-foot">
                    <span><Clock3 size={14} /> {department.avgMinutes} {t('common.min')} {t('home.avgWait')}</span>
                    <button onClick={() => chooseDepartment(department)}>{t('home.bookDept')} <ArrowRight size={14} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="section live-section">
          <div className="live-panel">
            <div className="live-panel-head">
              <div>
                <span className="eyebrow"><span className="live-dot" /> {t('home.liveEyebrow')}</span>
                <h2>{t('home.liveTitle')}</h2>
                <p>{t('home.liveSubtitle')}</p>
              </div>
              <Link to="/display" className="btn btn-light">{t('nav.display')} <ArrowRight size={16} /></Link>
            </div>
            <div className="live-grid">
              {liveEntries.map((entry) => (
                <div className={`live-card ${entry.paused ? 'is-paused' : ''}`} key={entry.doctorId} style={{ '--dept-color': entry.color }}>
                  <div className="live-card-head">
                    <span className="live-dept">{entry.departmentCode}</span>
                    <span className={entry.paused ? 'live-state paused' : 'live-state'}><span className="live-dot" /> {entry.paused ? t('home.paused') : 'Live'}</span>
                  </div>
                  <h4>{entry.doctorName}</h4>
                  <p className="live-room"><MapPin size={13} /> {entry.room} · {entry.departmentName}</p>
                  <div className="serving-token">
                    <span>{t('home.nowServing')}</span>
                    <strong>{entry.current?.tokenLabel || '—'}</strong>
                    {entry.current?.priority && entry.current.priority !== 'general' && (
                      <PriorityBadge priority={entry.current.priority} label={t(`priority.${entry.current.priority}`)} showIcon={false} />
                    )}
                  </div>
                  <div className="next-row">
                    <span>{t('home.nextUp')}</span>
                    <div>
                      {entry.next?.length ? entry.next.map((item) => (
                        <span className="next-token" key={item.tokenLabel}>{item.tokenLabel}<small>{item.etaMinutes}m</small></span>
                      )) : <span className="muted-small">{t('home.nobodyWaiting')}</span>}
                    </div>
                  </div>
                  <div className="live-card-foot"><Users size={14} /> {entry.waiting} {t('home.waitingNow')}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section steps-section">
          <div className="section-head centered">
            <div>
              <span className="eyebrow">{t('home.howEyebrow')}</span>
              <h2>{t('home.howTitle')}</h2>
            </div>
          </div>
          <div className="steps-grid">
            <div className="step-card">
              <span className="step-number">01</span>
              <div className="step-icon"><Ticket size={21} /></div>
              <h3>{t('home.step1Title')}</h3>
              <p>{t('home.step1Body')}</p>
            </div>
            <div className="step-card">
              <span className="step-number">02</span>
              <div className="step-icon"><Activity size={21} /></div>
              <h3>{t('home.step2Title')}</h3>
              <p>{t('home.step2Body')}</p>
            </div>
            <div className="step-card">
              <span className="step-number">03</span>
              <div className="step-icon"><Volume2 size={21} /></div>
              <h3>{t('home.step3Title')}</h3>
              <p>{t('home.step3Body')}</p>
            </div>
          </div>
        </section>

        <section className="staff-cta">
          <div>
            <span className="eyebrow-small">For hospital teams</span>
            <h2>{t('home.staffPortal')}</h2>
            <p>Role-based controls for doctors, nurses, receptionists and administrators. One live picture of every queue.</p>
          </div>
          <Link to="/staff/login" className="btn btn-dark">Open staff portal <ArrowRight size={17} /></Link>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

function BookingSuccess({ confirmation, onReset, t }) {
  const ticket = confirmation.ticket?.ticket || confirmation.ticket;
  const status = ticket?.status;
  const isWaiting = status === 'waiting';
  const position = confirmation.ticket?.position;
  const eta = confirmation.ticket?.etaMinutes;

  return (
    <div className="booking-success">
      <SuccessMark />
      <span className="eyebrow-small">{isWaiting ? t('home.successTitle') : t('home.successAppointment')}</span>
      <h2>{ticket?.tokenLabel}</h2>
      <p>{t('home.successBody')}</p>
      <div className="success-token-meta">
        <div><span>{t('track.department')}</span><strong>{confirmation.ticket?.department?.name || '—'}</strong></div>
        <div><span>{t('track.doctor')}</span><strong>{confirmation.ticket?.doctor?.name || '—'}</strong></div>
        <div><span>{t('track.room')}</span><strong>{confirmation.ticket?.doctor?.room || '—'}</strong></div>
        <div><span>{t('track.date')}</span><strong>{ticket?.date} {ticket?.slotTime ? `· ${ticket.slotTime}` : ''}</strong></div>
      </div>
      {isWaiting ? (
        <div className="success-live">
          <div><span>{t('track.yourPosition')}</span><strong>{position ?? '—'}</strong></div>
          <div><span>{t('track.estimatedWait')}</span><strong>{eta ?? '—'} <small>{t('common.min')}</small></strong></div>
        </div>
      ) : (
        <div className="inline-success"><CheckCircle2 size={16} /> Check in from your tracker on the day of your visit.</div>
      )}
      <div className="success-code">
        <span>Tracking code</span>
        <code>{ticket?.ticketCode}</code>
      </div>
      <Link to={`/track/${ticket?.ticketCode}`} className="btn btn-primary btn-wide">{t('home.openTracker')} <ArrowRight size={17} /></Link>
      <button type="button" className="btn btn-ghost btn-wide" onClick={onReset}>{t('home.bookAnother')}</button>
      <span className="success-sms"><Phone size={13} /> SMS confirmation sent · {ticket?.phoneMasked}</span>
    </div>
  );
}
