import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bell, Expand, Maximize2, Pause, Volume2 } from 'lucide-react';
import { LanguagePicker, Logo, VoiceToggle } from '../components/UI';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../lib/api';
import { socket } from '../lib/socket';
import { speak, unlockSpeech } from '../lib/voice';
import { formatTime } from '../lib/format';

export default function DisplayPage() {
  const { t, language } = useLanguage();
  const [board, setBoard] = useState(null);
  const [departmentId, setDepartmentId] = useState('');
  const [now, setNow] = useState(new Date());
  const [voiceEnabled, setVoiceEnabled] = useState(() => localStorage.getItem('sqms_display_voice') !== 'off');
  const [lastAnnouncement, setLastAnnouncement] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const result = await api(`/api/public/board${departmentId ? `?departmentId=${departmentId}` : ''}`, { auth: false });
      setBoard(result);
    } catch {
      // Keep the last good board visible on a transient network error.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 15000);
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    const onBoard = () => load();
    const onVoice = (payload) => {
      if (!voiceEnabled) return;
      setLastAnnouncement(payload);
      speak(payload.messages?.[language] || payload.message, language);
    };
    socket.on('board:changed', onBoard);
    socket.on('queue:changed', onBoard);
    socket.on('alert:voice', onVoice);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(clock);
      socket.off('board:changed', onBoard);
      socket.off('queue:changed', onBoard);
      socket.off('alert:voice', onVoice);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, language, voiceEnabled]);

  const toggleVoice = (value) => {
    setVoiceEnabled(value);
    localStorage.setItem('sqms_display_voice', value ? 'on' : 'off');
    if (value) {
      unlockSpeech();
      speak(t('display.speak'), language);
    }
  };

  const fullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  const entries = board?.entries || [];
  const activeDepartments = useMemo(() => {
    return (board?.departments || []).filter((department) => entries.some((entry) => entry.departmentId === department.id));
  }, [board, entries]);

  return (
    <div className="display-page">
      <header className="display-header">
        <div className="display-brand">
          <Logo light />
          <div>
            <span>Pune Central Hospital</span>
            <small>{t('display.title')}</small>
          </div>
        </div>
        <div className="display-clock">
          <strong>{now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</strong>
          <span>{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
        <div className="display-controls">
          <LanguagePicker dark />
          <VoiceToggle enabled={voiceEnabled} onChange={toggleVoice} dark />
          <button className="display-icon-btn" onClick={fullscreen} title={t('display.fullscreen')}><Maximize2 size={18} /></button>
          <Link className="display-icon-btn" to="/" title="Patient portal"><ArrowLeft size={18} /></Link>
        </div>
      </header>

      <div className="display-filter-bar">
        <button className={!departmentId ? 'is-active' : ''} onClick={() => setDepartmentId('')}>{t('common.all')}</button>
        {activeDepartments.map((department) => (
          <button
            key={department.id}
            className={String(department.id) === String(departmentId) ? 'is-active' : ''}
            onClick={() => setDepartmentId(department.id)}
            style={{ '--dept-color': department.color }}
          >
            <span className="dept-dot" /> {department.code}
          </button>
        ))}
      </div>

      {loading && !board ? (
        <div className="display-loading">Loading live queues…</div>
      ) : (
        <div className={`display-grid ${entries.length <= 2 ? 'display-grid-wide' : ''}`}>
          {entries.map((entry) => (
            <article className={`display-card ${entry.paused ? 'is-paused' : ''}`} key={entry.doctorId} style={{ '--dept-color': entry.color }}>
              <div className="display-card-head">
                <div>
                  <span className="display-dept">{entry.departmentName}</span>
                  <h2>{entry.doctorName}</h2>
                  <span className="display-room">{entry.room}</span>
                </div>
                <span className={`display-status ${entry.paused ? 'paused' : ''}`}>
                  {entry.paused ? <Pause size={13} /> : <span className="live-dot" />}
                  {entry.paused ? t('display.paused') : 'Live'}
                </span>
              </div>
              <div className="display-serving">
                <span>{t('display.nowServing')}</span>
                <strong>{entry.current?.tokenLabel || '—'}</strong>
                {entry.current?.priority && entry.current.priority !== 'general' && (
                  <span className={`display-priority priority-${entry.current.priority}`}>{t(`priority.${entry.current.priority}`)}</span>
                )}
                {!entry.current && <small>{entry.waiting ? 'Next patient being prepared' : t('display.noQueue')}</small>}
              </div>
              <div className="display-next">
                <div className="display-next-head">
                  <span>{t('display.next')}</span>
                  <span>{entry.waiting} {t('display.waiting')}</span>
                </div>
                <div className="display-next-tokens">
                  {entry.next.length ? entry.next.map((item, index) => (
                    <div className="display-next-token" key={item.tokenLabel}>
                      <span className="next-rank">{index + 1}</span>
                      <strong>{item.tokenLabel}</strong>
                      <small>{item.etaMinutes} {t('common.min')}</small>
                      {item.priority !== 'general' && <span className={`token-priority-dot dot-${item.priority}`} title={t(`priority.${item.priority}`)} />}
                    </div>
                  )) : <span className="display-empty">{t('display.noQueue')}</span>}
                </div>
              </div>
              <div className="display-card-foot">
                <span>Avg. consult · {entry.avgMinutes} {t('common.min')}</span>
                {entry.nextEtaMinutes !== null && <span>Next wait · ~{entry.nextEtaMinutes} {t('common.min')}</span>}
              </div>
            </article>
          ))}
        </div>
      )}

      <footer className="display-footer">
        <div className="display-ticker">
          <Bell size={16} />
          {lastAnnouncement ? (
            <span>{lastAnnouncement.messages?.[language] || 'Queue update in progress'}</span>
          ) : (
            <span>Please keep your token ready. Patients with emergency, senior, pregnancy or disability priority may be called ahead of the displayed order.</span>
          )}
        </div>
        <div className="display-footer-note">
          <Volume2 size={15} /> {voiceEnabled ? 'Voice announcements active' : 'Voice announcements muted'}
        </div>
      </footer>
    </div>
  );
}
