import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BellRing,
  CheckCheck,
  ChevronDown,
  Clock3,
  DoorOpen,
  Megaphone,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SkipForward,
  Stethoscope,
  UserRound,
  Users,
  Volume2
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
import { speak, unlockSpeech } from '../lib/voice';
import { formatTime, relativeMinutes } from '../lib/format';

export default function DoctorQueuePage() {
  const { user } = useAuth();
  const { push } = useToast();
  const { language } = useLanguage();
  const [searchParams] = useSearchParams();
  const requestedDoctorId = searchParams.get('doctorId') || '';
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState(user?.role === 'doctor' ? user.doctorId : requestedDoctorId);
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [alertModal, setAlertModal] = useState(null);
  const [sendingAlert, setSendingAlert] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = user?.role === 'admin';
  const paused = queue?.state?.paused;
  const current = queue?.current;

  useEffect(() => {
    if (!isAdmin) return;
    api('/api/staff/doctors')
      .then((result) => {
        setDoctors(result.doctors);
        setDoctorId((currentId) => currentId || result.doctors[0]?.id || '');
      })
      .catch((error) => push(error.message, 'error'));
  }, [isAdmin, push]);

  const load = async (silent = false) => {
    if (!doctorId) return;
    if (!silent) setLoading(true);
    try {
      const result = await api(`/api/staff/queue?doctorId=${doctorId}`);
      setQueue(result);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const interval = window.setInterval(() => load(true), 18000);
    const onQueue = (payload) => {
      if (Number(payload.doctorId) === Number(doctorId)) load(true);
    };
    socket.on('queue:changed', onQueue);
    return () => {
      window.clearInterval(interval);
      socket.off('queue:changed', onQueue);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId]);

  const runAction = async (path, body, successMessage) => {
    setBusy(path);
    try {
      const result = await api(path, { method: 'POST', body });
      if (result.queue) setQueue(result.queue);
      if (successMessage) push(successMessage);
      if (result.message) push(result.message);
      if (result.paused !== undefined) push(result.paused ? 'Queue paused. Waiting patients have been alerted.' : 'Queue resumed with rebalanced wait times.');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const callNext = () => runAction(`/api/staff/doctors/${doctorId}/call-next`, {});
  const startConsult = () => current && runAction(`/api/staff/appointments/${current.id}/start`, {}, 'Consultation started');
  const completeConsult = () => current && runAction(`/api/staff/appointments/${current.id}/complete`, {}, 'Consultation completed');
  const skipCurrent = () => {
    if (!current) return;
    if (!window.confirm(`Skip ${current.tokenLabel}? They can be recalled later from the skipped list.`)) return;
    runAction(`/api/staff/appointments/${current.id}/skip`, {}, 'Patient skipped and queue rebalanced');
  };
  const recall = (appointment) => {
    if (!appointment) return;
    runAction(`/api/staff/appointments/${appointment.id}/recall`, {}, `${appointment.tokenLabel} recalled`);
  };
  const callPatient = (appointment) => {
    if (!appointment) return;
    runAction(`/api/staff/appointments/${appointment.id}/call`, {}, `${appointment.tokenLabel} called`);
  };
  const togglePause = () => runAction(`/api/staff/doctors/${doctorId}/pause`, { paused: !paused });

  const openAlert = (appointment, template = 'turn') => {
    const target = appointment || current || queue?.next || queue?.queue?.[0];
    if (!target) {
      push('There is no patient to alert right now', 'error');
      return;
    }
    setAlertModal({
      appointmentId: target.id,
      patientName: target.patientName,
      tokenLabel: target.tokenLabel,
      template,
      language: target.language || 'en',
      message: ''
    });
  };

  const sendAlert = async () => {
    if (!alertModal) return;
    setSendingAlert(true);
    try {
      await api('/api/staff/alerts', {
        method: 'POST',
        body: {
          appointmentId: alertModal.appointmentId,
          template: alertModal.template,
          language: alertModal.language,
          message: alertModal.message
        }
      });
      push('SMS, app and voice alert sent');
      setAlertModal(null);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSendingAlert(false);
    }
  };

  const announceCurrent = () => {
    const target = current || queue?.next;
    if (!target) return;
    unlockSpeech();
    speak(
      language === 'mr'
        ? `टोकन ${target.tokenLabel}. कृपया ${queue.doctor.room} मध्ये या.`
        : language === 'hi'
          ? `टोकन ${target.tokenLabel}। कृपया ${queue.doctor.room} में आएं।`
          : `Token ${target.tokenLabel}. Please proceed to ${queue.doctor.room}.`,
      language
    );
  };

  const waitLabel = (item) => {
    const value = relativeMinutes(item.checkinAt);
    return value === null ? '—' : `${value}m`;
  };

  const queueRows = queue?.queue || [];
  const doctorOptions = useMemo(() => {
    if (user?.role === 'doctor') return [];
    return doctors;
  }, [doctors, user?.role]);

  if (loading && !queue) {
    return <LoadingBlock label="Opening your queue…" />;
  }

  return (
    <div className="page-stack">
      <section className="queue-hero">
        <div className="queue-hero-profile">
          <Avatar name={queue?.doctor?.name || user?.name} size={54} color={queue?.doctor?.departmentColor} />
          <div>
            <div className="queue-title-line">
              <h2>{queue?.doctor?.name || user?.name}</h2>
              {queue?.doctor && <StatusBadge status={paused ? 'skipped' : 'waiting'} label={paused ? 'Queue paused' : 'Queue live'} />}
            </div>
            <p>{queue?.doctor?.qualification} · {queue?.doctor?.departmentName}</p>
            <div className="queue-meta">
              <span><DoorOpen size={14} /> {queue?.doctor?.room}</span>
              <span><Clock3 size={14} /> Avg. {queue?.state?.avgMinutes} min per patient</span>
              <span><Users size={14} /> {queue?.stats?.waiting || 0} waiting</span>
            </div>
          </div>
        </div>
        <div className="queue-hero-actions">
          {isAdmin && (
            <label className="compact-select">
              <span>Doctor</span>
              <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
                {doctorOptions.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>{doctor.name}</option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
          )}
          <button className="btn btn-ghost" onClick={() => { setRefreshing(true); load(true); }} title="Refresh">
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} /> Refresh
          </button>
          <button className="btn btn-ghost" onClick={announceCurrent} disabled={!queue?.next && !current}><Volume2 size={16} /> Announce</button>
          <button className="btn btn-ghost" onClick={() => openAlert(current || queue?.next)}><BellRing size={16} /> Send alert</button>
        </div>
      </section>

      {paused && (
        <AlertBanner tone="warning" title="Queue is paused">
          Predicted waiting times are increasing and patients have received delay alerts. Resume when you are ready to continue.
          <button className="btn btn-small btn-dark inline-action" onClick={togglePause} disabled={busy.includes('pause')}>
            {busy.includes('pause') ? <Spinner size={14} /> : <Play size={14} />} Resume queue
          </button>
        </AlertBanner>
      )}

      <div className="stats-grid four">
        <StatCard icon={Users} label="Waiting now" value={queue?.stats?.waiting ?? 0} hint="live" tone="teal" />
        <StatCard icon={Clock3} label="Next predicted wait" value={queue?.next?.etaMinutes ?? '—'} suffix={queue?.next ? 'min' : ''} tone="amber" />
        <StatCard icon={CheckCheck} label="Served today" value={queue?.stats?.served ?? 0} tone="green" />
        <StatCard icon={SkipForward} label="Skipped / recall" value={queue?.stats?.skipped ?? 0} tone="rose" />
      </div>

      <div className="queue-layout">
        <div className="queue-primary">
          <section className="current-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow-small">Consultation room</span>
                <h3>Now serving</h3>
              </div>
              {current ? <StatusBadge status={current.status} /> : <span className="clear-pill">Queue clear</span>}
            </div>

            {current ? (
              <>
                <div className="current-patient">
                  <div className="current-token">
                    <span>Token</span>
                    <strong>{current.tokenLabel}</strong>
                    <PriorityBadge priority={current.priority} />
                  </div>
                  <div className="current-patient-info">
                    <h2>{current.patientName}</h2>
                    <p>{current.age ? `${current.age} yrs` : 'Age not recorded'} · {current.gender || '—'} · {current.phoneMasked}</p>
                    <div className="current-meta">
                      <span><Clock3 size={14} /> Waiting {waitLabel(current)}</span>
                      <span><Stethoscope size={14} /> {current.kind === 'walkin' ? 'Walk-in' : 'Appointment'}</span>
                      {current.slotTime && <span>Slot {current.slotTime}</span>}
                    </div>
                    {current.notes && <div className="patient-note"><strong>Care note</strong>{current.notes}</div>}
                  </div>
                </div>
                <div className="current-actions">
                  {current.status === 'called' && (
                    <button className="btn btn-primary" onClick={startConsult} disabled={Boolean(busy)}>
                      {busy.includes('/start') ? <Spinner size={16} /> : <Play size={16} />} Start consultation
                    </button>
                  )}
                  {current.status === 'in_consultation' && (
                    <button className="btn btn-primary" onClick={completeConsult} disabled={Boolean(busy)}>
                      {busy.includes('/complete') ? <Spinner size={16} /> : <CheckCheck size={16} />} Complete consultation
                    </button>
                  )}
                  <button className="btn btn-ghost" onClick={() => openAlert(current, 'turn')}><Megaphone size={16} /> Re-announce</button>
                  <button className="btn btn-danger-ghost" onClick={skipCurrent} disabled={Boolean(busy)}><SkipForward size={16} /> Skip</button>
                  <button className="btn btn-ghost" onClick={togglePause} disabled={Boolean(busy)}><Pause size={16} /> Pause</button>
                </div>
              </>
            ) : (
              <div className="current-empty">
                <EmptyState
                  icon={UserRound}
                  title="No patient is active"
                  body={paused ? 'Resume the queue to call the next patient.' : 'Call the next priority patient whenever you are ready.'}
                  action={(
                    <button className="btn btn-primary" onClick={callNext} disabled={paused || !queue?.next || Boolean(busy)}>
                      {busy.includes('call-next') ? <Spinner size={16} /> : <Megaphone size={16} />} Call next patient
                    </button>
                  )}
                />
              </div>
            )}
          </section>

          <section className="table-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow-small">Priority-aware order</span>
                <h3>Waiting queue <span className="heading-count">{queueRows.length}</span></h3>
              </div>
              <button className="btn btn-primary btn-small" onClick={callNext} disabled={paused || Boolean(current) || !queue?.next || Boolean(busy)}>
                {busy.includes('call-next') ? <Spinner size={15} /> : <Megaphone size={15} />} Call next
              </button>
            </div>
            {queueRows.length ? (
              <div className="queue-list">
                {queueRows.map((item, index) => (
                  <div className={`queue-row ${index === 0 ? 'is-next' : ''}`} key={item.id}>
                    <span className="queue-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div className="queue-token-block">
                      <strong>{item.tokenLabel}</strong>
                      {index === 0 && <small>Next</small>}
                    </div>
                    <div className="queue-patient">
                      <strong>{item.patientName}</strong>
                      <small>{item.age ? `${item.age} yrs` : '—'} · Checked in {formatTime(item.checkinAt)}</small>
                    </div>
                    <PriorityBadge priority={item.priority} />
                    <div className="queue-wait">
                      <span>{waitLabel(item)} waited</span>
                      <strong>~{item.etaMinutes} min</strong>
                    </div>
                    <div className="queue-row-actions">
                      <button className="icon-btn" title="Send alert" onClick={() => openAlert(item)}><BellRing size={16} /></button>
                      <button className="btn btn-small btn-ghost" onClick={() => callPatient(item)} disabled={Boolean(current) || paused || Boolean(busy)}>Call</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Users} title="No one waiting" body="New check-ins and emergencies will appear here automatically." />
            )}
          </section>
        </div>

        <aside className="queue-side">
          <section className="side-section">
            <div className="panel-heading compact">
              <div><span className="eyebrow-small">Recovery</span><h3>Skipped patients</h3></div>
              <span className="heading-count">{queue?.skipped?.length || 0}</span>
            </div>
            {queue?.skipped?.length ? (
              <div className="skipped-list">
                {queue.skipped.map((item) => (
                  <div className="skipped-row" key={item.id}>
                    <div><strong>{item.tokenLabel}</strong><small>{item.patientName} · {formatTime(item.skippedAt)}</small></div>
                    <button className="btn btn-small btn-ghost" onClick={() => recall(item)} disabled={Boolean(current) || paused}>
                      <RotateCcw size={14} /> Recall
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-small section-empty">Skipped patients can be recalled from here.</p>
            )}
          </section>

          <section className="side-section">
            <div className="panel-heading compact">
              <div><span className="eyebrow-small">Today</span><h3>Booked appointments</h3></div>
              <span className="heading-count">{queue?.booked?.length || 0}</span>
            </div>
            {queue?.booked?.length ? (
              <div className="booked-list">
                {queue.booked.map((item) => (
                  <div className="booked-row" key={item.id}>
                    <span className="booked-time">{item.slotTime || '—'}</span>
                    <div><strong>{item.tokenLabel}</strong><small>{item.patientName}</small><span className="booked-status">Waiting for check-in</span></div>
                    <PriorityBadge priority={item.priority} showIcon={false} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-small section-empty">No un-checked appointments for today.</p>
            )}
          </section>

          <section className="side-section">
            <div className="panel-heading compact">
              <div><span className="eyebrow-small">Flow</span><h3>Completed today</h3></div>
              <span className="heading-count">{queue?.stats?.served || 0}</span>
            </div>
            {queue?.served?.length ? (
              <div className="served-list">
                {queue.served.slice(0, 5).map((item) => (
                  <div key={item.id}><CheckCheck size={14} /><span>{item.tokenLabel} · {item.patientName}</span><small>{formatTime(item.completedAt)}</small></div>
                ))}
              </div>
            ) : (
              <p className="muted-small section-empty">No consultations completed yet.</p>
            )}
            {queue?.served?.length > 5 && <div className="view-more-line">+{queue.served.length - 5} more completed</div>}
          </section>
        </aside>
      </div>

      <Modal
        open={Boolean(alertModal)}
        onClose={() => setAlertModal(null)}
        title="Send patient alert"
        subtitle={alertModal ? `${alertModal.tokenLabel} · ${alertModal.patientName}` : ''}
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setAlertModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={sendAlert} disabled={sendingAlert}>
              {sendingAlert ? <Spinner size={15} /> : <BellRing size={15} />} Send SMS, app & voice
            </button>
          </>
        )}
      >
        {alertModal && (
          <div className="modal-form">
            <div className="form-grid two">
              <label className="field">
                <span>Alert type</span>
                <select value={alertModal.template} onChange={(event) => setAlertModal({ ...alertModal, template: event.target.value })}>
                  <option value="turn">Your turn / please come in</option>
                  <option value="delay">Delay update</option>
                  <option value="custom">Custom message</option>
                </select>
              </label>
              <label className="field">
                <span>Language</span>
                <select value={alertModal.language} onChange={(event) => setAlertModal({ ...alertModal, language: event.target.value })}>
                  <option value="en">English</option>
                  <option value="mr">मराठी</option>
                  <option value="hi">हिंदी</option>
                </select>
              </label>
            </div>
            {alertModal.template === 'custom' && (
              <label className="field">
                <span>Message</span>
                <textarea rows="4" value={alertModal.message} onChange={(event) => setAlertModal({ ...alertModal, message: event.target.value })} placeholder="Type the message to send by SMS and read aloud…" />
              </label>
            )}
            <AlertBanner tone="info" icon={BellRing} title="Three channels">
              The patient receives an SMS, an in-app alert and a browser voice announcement in their selected language.
            </AlertBanner>
          </div>
        )}
      </Modal>
    </div>
  );
}
