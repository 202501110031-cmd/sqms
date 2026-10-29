import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BellRing,
  CalendarPlus,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldAlert,
  Stethoscope,
  Ticket,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import {
  AlertBanner,
  Avatar,
  EmptyState,
  LoadingBlock,
  Modal,
  PriorityBadge,
  Spinner,
  StatCard,
  StatusBadge
} from '../components/UI';
import { api } from '../lib/api';
import { socket } from '../lib/socket';
import { addDaysISO, formatDate, formatTime, relativeMinutes, todayISO } from '../lib/format';

const PRIORITY_OPTIONS = ['general', 'senior', 'pregnant', 'disabled', 'emergency'];

const emptyBooking = {
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
  notes: '',
  selfCheckIn: true
};

export default function FrontDeskPage() {
  const { user } = useAuth();
  const { push } = useToast();
  const { language } = useLanguage();
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState('');
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [searchCode, setSearchCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [booking, setBooking] = useState({ ...emptyBooking, departmentId: user?.departmentId || '', language });
  const [slots, setSlots] = useState([]);
  const [savingBooking, setSavingBooking] = useState(false);
  const [createdTicket, setCreatedTicket] = useState(null);
  const [priorityTarget, setPriorityTarget] = useState(null);
  const [priorityValue, setPriorityValue] = useState('general');
  const [alertTarget, setAlertTarget] = useState(null);
  const [alertLanguage, setAlertLanguage] = useState('en');
  const [alertTemplate, setAlertTemplate] = useState('turn');
  const [alertMessage, setAlertMessage] = useState('');
  const [sendingAlert, setSendingAlert] = useState(false);

  const canPriority = ['admin', 'nurse'].includes(user?.role);
  const canCancel = ['admin', 'receptionist'].includes(user?.role);
  const selectedDepartment = departments.find((department) => String(department.id) === String(booking.departmentId));
  const bookingDoctors = selectedDepartment?.doctors || [];

  const load = async () => {
    try {
      const [doctorResult, departmentResult] = await Promise.all([
        api('/api/staff/doctors'),
        api('/api/public/departments', { auth: false })
      ]);
      setDoctors(doctorResult.doctors);
      setDepartments(departmentResult.departments);
      setDoctorId((current) => current || doctorResult.doctors[0]?.id || '');
      setBooking((current) => ({
        ...current,
        departmentId: current.departmentId || user?.departmentId || departmentResult.departments[0]?.id,
        doctorId: current.doctorId || departmentResult.departments[0]?.doctors?.[0]?.id
      }));
    } catch (error) {
      push(error.message, 'error');
    }
  };

  const loadQueue = async (silent = false) => {
    if (!doctorId) return;
    if (!silent) setLoading(true);
    try {
      const result = await api(`/api/staff/queue?doctorId=${doctorId}`);
      setQueue(result);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadQueue();
    const interval = window.setInterval(() => loadQueue(true), 18000);
    const onQueue = (payload) => {
      if (Number(payload.doctorId) === Number(doctorId)) loadQueue(true);
    };
    socket.on('queue:changed', onQueue);
    return () => {
      window.clearInterval(interval);
      socket.off('queue:changed', onQueue);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId]);

  useEffect(() => {
    if (!bookingOpen || booking.kind !== 'appointment' || !booking.doctorId || !booking.date) {
      setSlots([]);
      return;
    }
    api(`/api/public/slots?doctorId=${booking.doctorId}&date=${booking.date}`, { auth: false })
      .then((result) => {
        setSlots(result.slots);
        setBooking((current) => {
          const available = result.slots.find((slot) => slot.available);
          return current.slotTime && result.slots.some((slot) => slot.time === current.slotTime && slot.available)
            ? current
            : { ...current, slotTime: available?.time || '' };
        });
      })
      .catch(() => setSlots([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingOpen, booking.kind, booking.doctorId, booking.date]);

  useEffect(() => {
    if (!booking.departmentId) return;
    const department = departments.find((item) => String(item.id) === String(booking.departmentId));
    if (!department) return;
    if (!department.doctors.some((doctor) => String(doctor.id) === String(booking.doctorId))) {
      setBooking((current) => ({ ...current, doctorId: department.doctors?.[0]?.id || '', slotTime: '' }));
    }
  }, [booking.departmentId, departments]);

  const doctor = doctors.find((item) => Number(item.id) === Number(doctorId));
  const waiting = queue?.queue || [];
  const booked = queue?.booked || [];
  const skipped = queue?.skipped || [];
  const served = queue?.served || [];

  const runAction = async (path, successMessage) => {
    setBusy(path);
    try {
      await api(path, { method: 'POST' });
      push(successMessage);
      await loadQueue(true);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const checkIn = (appointment) => runAction(`/api/staff/appointments/${appointment.id}/check-in`, `${appointment.tokenLabel} checked in and added to the queue`);

  const cancelAppointment = async (appointment) => {
    if (!window.confirm(`Cancel ${appointment.tokenLabel} for ${appointment.patientName}?`)) return;
    await runAction(`/api/staff/appointments/${appointment.id}/cancel`, `${appointment.tokenLabel} cancelled`);
  };

  const handleSearch = async (event) => {
    event.preventDefault();
    if (!searchCode.trim()) return;
    setSearching(true);
    try {
      const result = await api(`/api/staff/search?code=${encodeURIComponent(searchCode.trim().toUpperCase())}`);
      setSearchResult(result);
    } catch (error) {
      push(error.message, 'error');
      setSearchResult(null);
    } finally {
      setSearching(false);
    }
  };

  const openPriority = (appointment) => {
    setPriorityTarget(appointment);
    setPriorityValue(appointment.priority);
  };

  const savePriority = async () => {
    if (!priorityTarget) return;
    setBusy('priority');
    try {
      const result = await api(`/api/staff/appointments/${priorityTarget.id}/priority`, {
        method: 'POST',
        body: { priority: priorityValue }
      });
      if (result.queue) setQueue(result.queue);
      push(`Priority updated for ${priorityTarget.tokenLabel}`);
      setPriorityTarget(null);
      await loadQueue(true);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const openAlert = (appointment) => {
    setAlertTarget(appointment);
    setAlertLanguage(appointment.language || 'en');
    setAlertTemplate('turn');
    setAlertMessage('');
  };

  const sendAlert = async () => {
    if (!alertTarget) return;
    setSendingAlert(true);
    try {
      await api('/api/staff/alerts', {
        method: 'POST',
        body: {
          appointmentId: alertTarget.id,
          template: alertTemplate,
          language: alertLanguage,
          message: alertMessage
        }
      });
      push('SMS, app and voice alert sent');
      setAlertTarget(null);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSendingAlert(false);
    }
  };

  const openBooking = () => {
    const initialDept = departments.find((department) => String(department.id) === String(user?.departmentId)) || departments[0];
    setBooking({
      ...emptyBooking,
      departmentId: initialDept?.id || '',
      doctorId: initialDept?.doctors?.[0]?.id || '',
      language
    });
    setBookingOpen(true);
  };

  const submitBooking = async (event) => {
    event.preventDefault();
    setSavingBooking(true);
    try {
      const result = await api('/api/staff/appointments', {
        method: 'POST',
        body: {
          ...booking,
          age: booking.age === '' ? null : Number(booking.age),
          departmentId: Number(booking.departmentId),
          doctorId: Number(booking.doctorId),
          date: booking.kind === 'walkin' ? todayISO() : booking.date,
          slotTime: booking.kind === 'walkin' ? null : booking.slotTime || null
        }
      });
      setCreatedTicket(result);
      setBookingOpen(false);
      setDoctorId(result.ticket?.doctor?.id || doctorId);
      push(booking.kind === 'walkin' ? 'Walk-in token created' : 'Appointment booked');
      await loadQueue(true);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSavingBooking(false);
    }
  };

  const waitLabel = (item) => {
    const value = relativeMinutes(item.checkinAt);
    return value === null ? '—' : `${value}m`;
  };

  const boardSummary = useMemo(() => ({
    waiting: queue?.stats?.waiting || 0,
    booked: queue?.stats?.booked || 0,
    served: queue?.stats?.served || 0,
    skipped: queue?.stats?.skipped || 0
  }), [queue]);

  return (
    <div className="page-stack">
      <section className="desk-toolbar">
        <div className="desk-doctor-select">
          <Avatar name={doctor?.name || 'Reception'} size={48} color={doctor?.department_color} />
          <div>
            <span className="eyebrow-small">Viewing queue for</span>
            <label className="inline-select">
              <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
                {doctors.map((item) => (
                  <option key={item.id} value={item.id}>{item.name} · {item.department_name}</option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
            <p>{doctor?.room} · {doctor?.qualification}</p>
          </div>
        </div>
        <form className="desk-search" onSubmit={handleSearch}>
          <Search size={17} />
          <input value={searchCode} onChange={(event) => setSearchCode(event.target.value.toUpperCase())} placeholder="Search ticket code…" />
          <button className="btn btn-small btn-ghost" disabled={searching}>{searching ? <Spinner size={14} /> : 'Find'}</button>
        </form>
        <div className="desk-actions">
          <button className="btn btn-ghost" onClick={() => loadQueue()}><RefreshCw size={16} /> Refresh</button>
          <button className="btn btn-primary" onClick={openBooking}><UserPlus size={16} /> New patient</button>
        </div>
      </section>

      <div className="stats-grid four">
        <StatCard icon={Users} label="Waiting in queue" value={boardSummary.waiting} tone="teal" />
        <StatCard icon={CalendarPlus} label="Booked for today" value={boardSummary.booked} tone="blue" />
        <StatCard icon={Check} label="Checked in / served" value={boardSummary.served} tone="green" />
        <StatCard icon={ShieldAlert} label="Skipped • recall" value={boardSummary.skipped} tone="rose" />
      </div>

      {queue?.state?.paused && (
        <AlertBanner tone="warning" title="This doctor has paused the queue">
          Waiting patients have been alerted and their predicted times are being updated. A doctor or administrator must resume the queue.
        </AlertBanner>
      )}

      <div className="desk-layout">
        <section className="table-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow-small">Live order · priority aware</span>
              <h3>Waiting queue <span className="heading-count">{waiting.length}</span></h3>
            </div>
            {queue?.next && (
              <div className="next-hint">Next: <strong>{queue.next.tokenLabel}</strong> · ~{queue.next.etaMinutes} min</div>
            )}
          </div>
          {loading && !queue ? <LoadingBlock /> : waiting.length ? (
            <div className="queue-list frontdesk-queue">
              {waiting.map((item, index) => (
                <div className={`queue-row ${index === 0 ? 'is-next' : ''}`} key={item.id}>
                  <span className="queue-rank">{String(index + 1).padStart(2, '0')}</span>
                  <div className="queue-token-block"><strong>{item.tokenLabel}</strong>{index === 0 && <small>Next</small>}</div>
                  <div className="queue-patient">
                    <strong>{item.patientName}</strong>
                    <small>{item.age ? `${item.age} yrs` : '—'} · {item.phoneMasked} · {formatTime(item.checkinAt)}</small>
                    {item.notes && <span className="queue-note">{item.notes}</span>}
                  </div>
                  <PriorityBadge priority={item.priority} />
                  <div className="queue-wait"><span>{waitLabel(item)} waited</span><strong>~{item.etaMinutes} min</strong></div>
                  <div className="queue-row-actions">
                    {canPriority && <button className="btn btn-small btn-ghost" onClick={() => openPriority(item)}>Priority</button>}
                    <button className="icon-btn" title="Send alert" onClick={() => openAlert(item)}><BellRing size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Users} title="Queue is empty" body="Check in a booked appointment or register a new walk-in." />
          )}
          {queue?.current && (
            <div className="active-patient-strip">
              <span className="active-strip-label"><span className="live-dot" /> In room</span>
              <strong>{queue.current.tokenLabel}</strong>
              <span>{queue.current.patientName}</span>
              <StatusBadge status={queue.current.status} />
            </div>
          )}
        </section>

        <aside className="desk-side">
          <section className="side-section">
            <div className="panel-heading compact">
              <div><span className="eyebrow-small">Arrivals</span><h3>Booked today</h3></div>
              <span className="heading-count">{booked.length}</span>
            </div>
            {booked.length ? (
              <div className="booked-desk-list">
                {booked.map((item) => (
                  <div className="booked-desk-row" key={item.id}>
                    <div className="booked-desk-head">
                      <strong>{item.slotTime || '—'} · {item.tokenLabel}</strong>
                      <PriorityBadge priority={item.priority} showIcon={false} />
                    </div>
                    <span>{item.patientName} · {item.phoneMasked}</span>
                    <div className="booked-desk-actions">
                      <button className="btn btn-small btn-primary" onClick={() => checkIn(item)} disabled={Boolean(busy)}>
                        {busy.includes(item.id) ? <Spinner size={13} /> : <Check size={13} />} Check in
                      </button>
                      {canPriority && <button className="btn btn-small btn-ghost" onClick={() => openPriority(item)}>Priority</button>}
                      {canCancel && <button className="btn btn-small btn-danger-ghost" onClick={() => cancelAppointment(item)}><X size={13} /></button>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-small section-empty">No un-checked appointments.</p>
            )}
          </section>

          {skipped.length > 0 && (
            <section className="side-section">
              <div className="panel-heading compact">
                <div><span className="eyebrow-small">Follow-up</span><h3>Skipped</h3></div>
                <span className="heading-count">{skipped.length}</span>
              </div>
              <div className="skipped-desk-list">
                {skipped.map((item) => (
                  <div key={item.id}><span>{item.tokenLabel}</span><small>{item.patientName}</small><em>{formatTime(item.skippedAt)}</em></div>
                ))}
              </div>
              <p className="muted-small help-copy">Only a doctor can recall a skipped patient.</p>
            </section>
          )}

          <section className="side-section">
            <div className="panel-heading compact">
              <div><span className="eyebrow-small">Done</span><h3>Recently completed</h3></div>
              <span className="heading-count">{served.length}</span>
            </div>
            {served.length ? (
              <div className="served-list">
                {served.slice(0, 6).map((item) => (
                  <div key={item.id}><Check size={14} /><span>{item.tokenLabel} · {item.patientName}</span><small>{formatTime(item.completedAt)}</small></div>
                ))}
              </div>
            ) : <p className="muted-small section-empty">No completed visits yet.</p>}
          </section>
        </aside>
      </div>

      <Modal
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        title="Register a patient"
        subtitle="Create a walk-in token or book a future appointment"
        size="lg"
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setBookingOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitBooking} disabled={savingBooking}>
              {savingBooking ? <Spinner size={15} /> : <Ticket size={15} />} {booking.kind === 'walkin' ? 'Create token' : 'Book appointment'}
            </button>
          </>
        )}
      >
        <form className="modal-form" onSubmit={submitBooking}>
          <div className="kind-switch compact-switch">
            <button type="button" className={booking.kind === 'walkin' ? 'is-active' : ''} onClick={() => setBooking({ ...booking, kind: 'walkin' })}><Ticket size={15} /> Walk-in today</button>
            <button type="button" className={booking.kind === 'appointment' ? 'is-active' : ''} onClick={() => setBooking({ ...booking, kind: 'appointment' })}><CalendarPlus size={15} /> Appointment</button>
          </div>
          <div className="form-grid two">
            <label className="field"><span>Patient name</span><input required value={booking.patientName} onChange={(event) => setBooking({ ...booking, patientName: event.target.value })} placeholder="Full name" /></label>
            <label className="field"><span>Mobile number</span><input required inputMode="tel" value={booking.phone} onChange={(event) => setBooking({ ...booking, phone: event.target.value })} placeholder="10-digit number" /></label>
          </div>
          <div className="form-grid three">
            <label className="field"><span>Age</span><input type="number" min="0" max="120" value={booking.age} onChange={(event) => setBooking({ ...booking, age: event.target.value })} /></label>
            <label className="field"><span>Gender</span><select value={booking.gender} onChange={(event) => setBooking({ ...booking, gender: event.target.value })}><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
            <label className="field"><span>Alert language</span><select value={booking.language} onChange={(event) => setBooking({ ...booking, language: event.target.value })}><option value="en">English</option><option value="mr">मराठी</option><option value="hi">हिंदी</option></select></label>
          </div>
          <div className="form-grid two">
            <label className="field">
              <span>Department</span>
              <select value={booking.departmentId} onChange={(event) => setBooking({ ...booking, departmentId: event.target.value })} required>
                <option value="">Select department</option>
                {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Doctor</span>
              <select value={booking.doctorId} onChange={(event) => setBooking({ ...booking, doctorId: event.target.value })} required>
                <option value="">Select doctor</option>
                {bookingDoctors.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.room}</option>)}
              </select>
            </label>
          </div>
          {booking.kind === 'appointment' && (
            <div className="form-grid two">
              <label className="field"><span>Date</span><input type="date" min={todayISO()} max={addDaysISO(30)} value={booking.date} onChange={(event) => setBooking({ ...booking, date: event.target.value })} /></label>
              <label className="field">
                <span>Time slot</span>
                <select value={booking.slotTime} onChange={(event) => setBooking({ ...booking, slotTime: event.target.value })}>
                  <option value="">Select time</option>
                  {slots.filter((slot) => slot.available).map((slot) => <option key={slot.time} value={slot.time}>{slot.time}</option>)}
                </select>
              </label>
            </div>
          )}
          <label className="field">
            <span>Priority</span>
            <div className="priority-options compact-options">
              {PRIORITY_OPTIONS.map((priority) => (
                <button type="button" key={priority} className={`priority-option priority-${priority} ${booking.priority === priority ? 'is-selected' : ''}`} onClick={() => setBooking({ ...booking, priority })}>
                  {priority === 'general' ? 'General' : priority === 'senior' ? 'Senior' : priority === 'pregnant' ? 'Pregnant' : priority === 'disabled' ? 'Differently abled' : 'Emergency'}
                </button>
              ))}
            </div>
          </label>
          <label className="field"><span>Notes <em>optional</em></span><textarea rows="2" value={booking.notes} onChange={(event) => setBooking({ ...booking, notes: event.target.value })} placeholder="Triage notes or patient needs" /></label>
          {booking.kind === 'appointment' && booking.date === todayISO() && (
            <label className="check-field"><input type="checkbox" checked={booking.selfCheckIn} onChange={(event) => setBooking({ ...booking, selfCheckIn: event.target.checked })} /><span>Patient is present — check in immediately</span></label>
          )}
          <button type="submit" hidden />
        </form>
      </Modal>

      <Modal
        open={Boolean(createdTicket)}
        onClose={() => setCreatedTicket(null)}
        title={createdTicket?.ticket?.ticket?.status === 'waiting' ? 'Token created' : 'Appointment booked'}
        subtitle="Share the tracking code with the patient"
        footer={<button className="btn btn-primary" onClick={() => setCreatedTicket(null)}>Done</button>}
      >
        {createdTicket && (
          <div className="created-ticket">
            <span className="created-token">{createdTicket.ticket?.ticket?.tokenLabel}</span>
            <h4>{createdTicket.ticket?.ticket?.patientName}</h4>
            <p>{createdTicket.ticket?.doctor?.name} · {createdTicket.ticket?.doctor?.room} · {formatDate(createdTicket.ticket?.ticket?.date)}</p>
            <div className="created-code"><span>Tracking code</span><code>{createdTicket.ticket?.ticket?.ticketCode}</code></div>
            <div className="created-actions">
              <Link className="btn btn-ghost" to={`/track/${createdTicket.ticket?.ticket?.ticketCode}`} target="_blank">Open tracker <ExternalLink size={14} /></Link>
              <button className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(createdTicket.ticket?.ticket?.ticketCode || '')}><MessageSquareText size={14} /> Copy code</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(searchResult)}
        onClose={() => setSearchResult(null)}
        title="Ticket found"
        subtitle={searchResult ? `${searchResult.ticket?.tokenLabel} · ${searchResult.ticket?.patientName}` : ''}
        footer={<button className="btn btn-ghost" onClick={() => setSearchResult(null)}>Close</button>}
      >
        {searchResult && (
          <div className="search-ticket-result">
            <div className="search-result-grid">
              <div><span>Status</span><StatusBadge status={searchResult.ticket?.status} /></div>
              <div><span>Doctor</span><strong>{searchResult.doctor?.name}</strong></div>
              <div><span>Room</span><strong>{searchResult.doctor?.room}</strong></div>
              <div><span>Date</span><strong>{formatDate(searchResult.ticket?.date)}</strong></div>
              <div><span>Priority</span><PriorityBadge priority={searchResult.ticket?.priority} /></div>
              <div><span>Phone</span><strong>{searchResult.ticket?.phoneMasked}</strong></div>
            </div>
            {searchResult.canCheckIn && (
              <button
                className="btn btn-primary btn-wide"
                onClick={async () => {
                  await checkIn(searchResult.ticket);
                  setSearchResult(null);
                }}
              >
                <Check size={16} /> Check in this patient
              </button>
            )}
            <Link className="btn btn-ghost btn-wide" to={`/track/${searchResult.ticket?.ticketCode}`} target="_blank">Open patient tracker <ExternalLink size={15} /></Link>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(priorityTarget)}
        onClose={() => setPriorityTarget(null)}
        title="Update priority"
        subtitle={priorityTarget ? `${priorityTarget.tokenLabel} · ${priorityTarget.patientName}` : ''}
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setPriorityTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={savePriority} disabled={busy === 'priority'}>
              {busy === 'priority' ? <Spinner size={15} /> : <ShieldAlert size={15} />} Update & rebalance
            </button>
          </>
        )}
      >
        <div className="modal-form">
          <p className="modal-help">Changing priority reorders the live queue and recalculates every patient’s predicted wait.</p>
          <div className="priority-options">
            {PRIORITY_OPTIONS.map((priority) => (
              <button key={priority} type="button" className={`priority-option priority-${priority} ${priorityValue === priority ? 'is-selected' : ''}`} onClick={() => setPriorityValue(priority)}>
                {priority === 'general' ? 'General' : priority === 'senior' ? 'Senior citizen' : priority === 'pregnant' ? 'Pregnant' : priority === 'disabled' ? 'Differently abled' : 'Emergency'}
              </button>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(alertTarget)}
        onClose={() => setAlertTarget(null)}
        title="Send patient alert"
        subtitle={alertTarget ? `${alertTarget.tokenLabel} · ${alertTarget.patientName}` : ''}
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setAlertTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={sendAlert} disabled={sendingAlert}>
              {sendingAlert ? <Spinner size={15} /> : <BellRing size={15} />} Send alert
            </button>
          </>
        )}
      >
        <div className="modal-form">
          <div className="form-grid two">
            <label className="field"><span>Alert type</span><select value={alertTemplate} onChange={(event) => setAlertTemplate(event.target.value)}><option value="turn">Your turn</option><option value="delay">Delay update</option><option value="custom">Custom</option></select></label>
            <label className="field"><span>Language</span><select value={alertLanguage} onChange={(event) => setAlertLanguage(event.target.value)}><option value="en">English</option><option value="mr">मराठी</option><option value="hi">हिंदी</option></select></label>
          </div>
          {alertTemplate === 'custom' && <label className="field"><span>Message</span><textarea rows="3" value={alertMessage} onChange={(event) => setAlertMessage(event.target.value)} /></label>}
          <AlertBanner tone="info" icon={BellRing} title="SMS + app + voice">The patient gets the alert in the selected language.</AlertBanner>
        </div>
      </Modal>
    </div>
  );
}
