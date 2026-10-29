import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  ExternalLink,
  Headphones,
  MapPin,
  MessageSquareText,
  Phone,
  Search,
  ShieldCheck,
  Stethoscope,
  Ticket,
  Volume2
} from 'lucide-react';
import PublicNav, { PublicFooter } from '../components/PublicNav';
import {
  AlertBanner,
  EmptyState,
  LanguagePicker,
  LoadingBlock,
  PriorityBadge,
  Spinner,
  StatusBadge,
  VoiceToggle
} from '../components/UI';
import { useLanguage, localDepartmentName } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { getSavedTokens, saveToken } from '../lib/savedTokens';
import { speak, unlockSpeech } from '../lib/voice';
import { socket } from '../lib/socket';
import { formatDate, formatTime, titleCase } from '../lib/format';

const TIMELINE = [
  { key: 'booked', labelKey: 'track.timelineBooked' },
  { key: 'waiting', labelKey: 'track.timelineChecked' },
  { key: 'called', labelKey: 'track.timelineCalled' },
  { key: 'in_consultation', labelKey: 'track.timelineConsult' },
  { key: 'served', labelKey: 'track.timelineDone' }
];

const STATUS_INDEX = {
  booked: 0,
  waiting: 1,
  called: 2,
  in_consultation: 3,
  served: 4
};

export default function TrackPage() {
  const { code: routeCode } = useParams();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { push } = useToast();
  const [code, setCode] = useState(routeCode || '');
  const [input, setInput] = useState(routeCode || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(routeCode));
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(() => localStorage.getItem('sqms_voice') !== 'off');
  const [savedTokens, setSavedTokens] = useState(() => getSavedTokens());
  const lastSpokenRef = useRef(0);

  const load = async (silent = false) => {
    if (!code) return;
    if (!silent) setLoading(true);
    try {
      const result = await api(`/api/public/tickets/${encodeURIComponent(code)}`, { auth: false });
      if (!silent) {
        saveToken(result);
        setSavedTokens(getSavedTokens());
      }
      setData(result);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
      if (!silent) setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (routeCode) {
      setCode(routeCode);
      setInput(routeCode);
    }
  }, [routeCode]);

  useEffect(() => {
    load();
    if (!code) return undefined;
    const interval = window.setInterval(() => load(true), 20000);
    const onQueue = () => load(true);
    const onVoice = (payload) => {
      if (!voiceEnabled || payload.ticketCode !== code) return;
      const now = Date.now();
      if (now - lastSpokenRef.current < 3500) return;
      lastSpokenRef.current = now;
      speak(payload.messages?.[language] || payload.message, language);
    };
    const onAppAlert = (payload) => {
      if (payload.ticketCode !== code) return;
      load(true);
      if (['turn', 'delay', 'resume'].includes(payload.template)) {
        push(payload.messages?.[language] || 'Your queue status has changed', 'info');
      }
    };

    socket.on('queue:changed', onQueue);
    socket.on('alert:voice', onVoice);
    socket.on('alert:app', onAppAlert);
    return () => {
      window.clearInterval(interval);
      socket.off('queue:changed', onQueue);
      socket.off('alert:voice', onVoice);
      socket.off('alert:app', onAppAlert);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, language, voiceEnabled]);

  const submitCode = (event) => {
    event.preventDefault();
    const cleaned = input.trim().toUpperCase();
    if (!cleaned) {
      setError(t('track.missingCode'));
      return;
    }
    navigate(`/track/${encodeURIComponent(cleaned)}`);
  };

  const handleCheckIn = async () => {
    setChecking(true);
    try {
      const result = await api(`/api/public/tickets/${encodeURIComponent(code)}/check-in`, { method: 'POST', auth: false });
      saveToken(result);
      setSavedTokens(getSavedTokens());
      setData(result);
      push('Check-in successful. You are in the live queue.');
      if (voiceEnabled) {
        speak(
          t('track.statusNow', { token: result.ticket?.tokenLabel, position: result.position, eta: result.etaMinutes }),
          language
        );
      }
    } catch (requestError) {
      push(requestError.message, 'error');
    } finally {
      setChecking(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel this token? This cannot be undone.')) return;
    try {
      const result = await api(`/api/public/tickets/${encodeURIComponent(code)}/cancel`, { method: 'POST', auth: false });
      saveToken(result);
      setSavedTokens(getSavedTokens());
      setData(result);
      push('Token cancelled', 'info');
    } catch (requestError) {
      push(requestError.message, 'error');
    }
  };

  const toggleVoice = (value) => {
    setVoiceEnabled(value);
    localStorage.setItem('sqms_voice', value ? 'on' : 'off');
    if (value) {
      unlockSpeech();
      speak(t('track.voiceOn'), language);
    }
  };

  const speakStatus = () => {
    if (!data) return;
    unlockSpeech();
    let message;
    if (data.ticket.status === 'called' || data.ticket.status === 'in_consultation') {
      message = t('track.statusCalled', { token: data.ticket.tokenLabel, room: data.doctor.room });
    } else if (data.ticket.status === 'served') {
      message = t('track.statusDone', { token: data.ticket.tokenLabel });
    } else if (data.paused) {
      message = t('track.statusPaused', { eta: data.etaMinutes ?? '—' });
    } else if (data.ticket.status === 'waiting') {
      message = t('track.statusNow', { token: data.ticket.tokenLabel, position: data.position, eta: data.etaMinutes });
    } else {
      message = `${data.ticket.tokenLabel}. ${t(`status.${data.ticket.status}`)}.`;
    }
    speak(message, language);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/track/${code}`);
      push('Tracking link copied');
    } catch {
      push('Could not copy the link', 'error');
    }
  };

  if (!code) {
    return (
      <div className="public-shell">
        <PublicNav />
        <main className="track-search-page">
          <div className="track-search-card">
            <span className="track-search-icon"><Search size={24} /></span>
            <span className="eyebrow">Live token tracking</span>
            <h1>{t('track.title')}</h1>
            <p>{t('track.subtitle')}</p>
            <form onSubmit={submitCode} className="track-search-form">
              <label className="field">
                <span>{t('track.code')}</span>
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value.toUpperCase())}
                  placeholder={t('track.codePlaceholder')}
                  autoFocus
                />
              </label>
              <button className="btn btn-primary btn-wide">{t('track.submit')} <ArrowRight size={17} /></button>
            </form>
            {error && <div className="field-error">{error}</div>}
            {savedTokens.length > 0 && (
              <div className="track-saved-tokens">
                <div className="track-saved-head">
                  <div>
                    <strong>{t('home.savedTitle')}</strong>
                    <small>{t('home.savedBody')}</small>
                  </div>
                  <Ticket size={17} />
                </div>
                {savedTokens.slice(0, 5).map((token) => (
                  <Link to={`/track/${token.code}`} className="track-saved-row" key={token.code}>
                    <span>
                      <strong>{token.tokenLabel}</strong>
                      <small>{token.patientName} · {token.departmentName}</small>
                    </span>
                    <span className="track-saved-side">
                      <StatusBadge status={token.status} label={t(`status.${token.status}`)} />
                      <ArrowRight size={15} />
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <div className="track-help-grid">
              <div><Ticket size={17} /><span>Find the code on your token or SMS confirmation.</span></div>
              <div><Phone size={17} /><span>Reception can help on 020 4000 1200.</span></div>
            </div>
          </div>
        </main>
        <PublicFooter />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="public-shell">
        <PublicNav />
        <main className="track-loading"><LoadingBlock label="Finding your place in the queue…" /></main>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="public-shell">
        <PublicNav />
        <main className="track-search-page">
          <div className="track-search-card">
            <EmptyState
              icon={Search}
              title="Token not found"
              body={error}
              action={<button className="btn btn-primary" onClick={() => navigate('/track')}>Try another code</button>}
            />
          </div>
        </main>
        <PublicFooter />
      </div>
    );
  }

  if (!data) return null;

  const ticket = data.ticket;
  const departmentName = localDepartmentName({
    name: data.department.name,
    nameMr: data.department.nameMr,
    nameHi: data.department.nameHi
  }, language);
  const activeIndex = STATUS_INDEX[ticket.status] ?? 1;
  const isClosed = ['served', 'cancelled', 'no_show', 'skipped'].includes(ticket.status);
  const isActiveCall = ['called', 'in_consultation'].includes(ticket.status);
  const isPaused = data.paused;
  const nextMessage = isPaused ? t('track.queuePaused') : null;

  return (
    <div className="public-shell track-shell">
      <PublicNav />
      <main className="track-page">
        <div className="track-topline">
          <button className="text-link" onClick={() => navigate('/track')}><Search size={15} /> Track another token</button>
          <div className="track-actions-top">
            <VoiceToggle enabled={voiceEnabled} onChange={toggleVoice} />
            <LanguagePicker />
          </div>
        </div>

        {nextMessage && <AlertBanner tone="warning" title={t('track.queuePaused')}>{nextMessage === t('track.queuePaused') ? 'Your predicted wait updates automatically until the doctor resumes.' : nextMessage}</AlertBanner>}

        <div className="track-grid">
          <section className={`token-hero token-${ticket.status} ${isPaused ? 'is-paused' : ''}`}>
            <div className="token-hero-top">
              <div>
                <span className="eyebrow"><span className={isClosed ? 'closed-dot' : 'live-dot'} /> {isClosed ? t(`status.${ticket.status}`) : t('track.live')}</span>
                <span className="token-department">{departmentName}</span>
              </div>
              <StatusBadge status={ticket.status} label={t(`status.${ticket.status}`)} />
            </div>

            <div className="token-main">
              <span className="token-label">Your token</span>
              <h1>{ticket.tokenLabel}</h1>
              <div className="token-meta-line">
                <PriorityBadge priority={ticket.priority} label={t(`priority.${ticket.priority}`)} />
                <span><Stethoscope size={14} /> {data.doctor.name}</span>
                <span><MapPin size={14} /> {data.doctor.room}</span>
              </div>
            </div>

            {isActiveCall ? (
              <div className="called-panel">
                <span className="called-pulse"><Volume2 size={26} /></span>
                <div>
                  <span>{ticket.status === 'in_consultation' ? t('status.in_consultation') : t('status.called')}</span>
                  <h2>Please proceed to {data.doctor.room}</h2>
                  <p>{data.doctor.name} is ready for you.</p>
                </div>
              </div>
            ) : ticket.status === 'waiting' ? (
              <div className="position-panel">
                <div className="position-block">
                  <span>{t('track.yourPosition')}</span>
                  <strong>{data.position ?? '—'}</strong>
                  <small>{data.peopleAhead ?? 0} {t('track.peopleAhead')}</small>
                </div>
                <div className="position-divider" />
                <div className="position-block">
                  <span>{t('track.estimatedWait')}</span>
                  <strong>{data.etaMinutes ?? '—'}<small className="unit">{t('common.min')}</small></strong>
                  <small>Estimated at {formatTime(data.estimatedAt)}</small>
                </div>
              </div>
            ) : ticket.status === 'served' ? (
              <div className="completed-panel">
                <CheckCircle2 size={28} />
                <div><strong>Visit completed</strong><p>Thank you. Your consultation with {data.doctor.name} is complete.</p></div>
              </div>
            ) : (
              <div className="completed-panel neutral">
                <Clock3 size={28} />
                <div><strong>This token is closed</strong><p>Please speak with the reception desk if you need help.</p></div>
              </div>
            )}

            {data.currentServing && ticket.status === 'waiting' && (
              <div className="currently-serving">
                <span className="serving-live"><span className="live-dot" /> {t('track.nowServing')}</span>
                <strong>{data.currentServing.tokenLabel}</strong>
                <span>{data.currentServing.remainingMinutes > 0 ? `~${data.currentServing.remainingMinutes} min remaining` : 'Completing now'}</span>
              </div>
            )}

            <div className="token-hero-actions">
              {data.canCheckIn && (
                <button className="btn btn-light" onClick={handleCheckIn} disabled={checking}>
                  {checking ? <Spinner size={16} /> : <Check size={16} />} {t('track.checkIn')}
                </button>
              )}
              <button className="btn btn-glass" onClick={speakStatus}><Headphones size={16} /> {t('track.speak')}</button>
              <button className="icon-btn glass-icon" onClick={copyLink} title={t('track.copyLink')}><Copy size={16} /></button>
            </div>

            {data.canCheckIn && (
              <div className="checkin-note"><ShieldCheck size={14} /> {t('track.checkInBody')}</div>
            )}
          </section>

          <aside className="track-side">
            <div className="side-card">
              <div className="side-card-head">
                <h3>{t('track.details')}</h3>
                <span className="track-code-chip"><Ticket size={13} /> {ticket.ticketCode}</span>
              </div>
              <dl className="detail-list">
                <div><dt>{t('track.department')}</dt><dd>{departmentName}</dd></div>
                <div><dt>{t('track.doctor')}</dt><dd>{data.doctor.name}<small>{data.doctor.qualification}</small></dd></div>
                <div><dt>{t('track.room')}</dt><dd>{data.doctor.room}</dd></div>
                <div><dt>{t('track.date')}</dt><dd>{formatDate(ticket.date)}</dd></div>
                <div><dt>{t('track.time')}</dt><dd>{ticket.slotTime || 'Walk-in queue'}</dd></div>
                <div><dt>{t('track.type')}</dt><dd>{ticket.kind === 'walkin' ? t('track.walkin') : t('track.appointment')}</dd></div>
                <div><dt>{t('track.priority')}</dt><dd><PriorityBadge priority={ticket.priority} label={t(`priority.${ticket.priority}`)} /></dd></div>
                <div><dt>Mobile</dt><dd>{ticket.phoneMasked}</dd></div>
              </dl>
              <div className="sms-note"><MessageSquareText size={15} /><span>{t('track.smsNote')}</span></div>
              {data.canCancel && (
                <button className="danger-link" onClick={handleCancel}>{t('track.cancelToken')}</button>
              )}
            </div>

            <div className="side-card">
              <div className="side-card-head"><h3>{t('track.timeline')}</h3></div>
              <div className="timeline">
                {TIMELINE.map((step, index) => {
                  const done = index < activeIndex || ticket.status === 'served';
                  const current = index === activeIndex && ticket.status !== 'served';
                  return (
                    <div className={`timeline-step ${done ? 'is-done' : ''} ${current ? 'is-current' : ''}`} key={step.key}>
                      <span className="timeline-dot">{done ? <Check size={12} /> : <Circle size={10} />}</span>
                      <div>
                        <strong>{t(step.labelKey)}</strong>
                        {step.key === 'booked' && <small>{formatDate(ticket.date)} · {formatTime(ticket.createdAt)}</small>}
                        {step.key === 'waiting' && ticket.checkinAt && <small>{formatTime(ticket.checkinAt)}</small>}
                        {step.key === 'called' && ticket.calledAt && <small>{formatTime(ticket.calledAt)}</small>}
                        {step.key === 'in_consultation' && ticket.startedAt && <small>{formatTime(ticket.startedAt)}</small>}
                        {step.key === 'served' && ticket.completedAt && <small>{formatTime(ticket.completedAt)}</small>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="side-card">
              <div className="side-card-head"><h3>{t('track.notifications')}</h3><BellRing size={17} /></div>
              {data.notifications?.length ? (
                <div className="notification-list">
                  {data.notifications.map((notification) => (
                    <div className="notification-item" key={notification.id}>
                      <span className={`notification-channel channel-${notification.channel}`}>
                        {notification.channel === 'sms' ? 'SMS' : notification.channel === 'voice' ? 'VOICE' : 'APP'}
                      </span>
                      <div>
                        <p>{notification.message}</p>
                        <small>{formatDate(notification.created_at, { year: undefined })} · {formatTime(notification.created_at)} · {notification.status}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted-small timeline-empty">{t('track.noNotifications')}</p>
              )}
            </div>
          </aside>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
