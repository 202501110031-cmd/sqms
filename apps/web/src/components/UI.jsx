import React from 'react';
import {
  AlertTriangle,
  Baby,
  CheckCircle2,
  Clock3,
  Crown,
  Loader2,
  LockKeyhole,
  UserRound,
  X,
  Accessibility
} from 'lucide-react';
import { LANGUAGES, useLanguage } from '../context/LanguageContext';
import { initials, titleCase } from '../lib/format';

export function Logo({ compact = false, light = false }) {
  return (
    <span className={`brand ${light ? 'brand-light' : ''} ${compact ? 'brand-compact' : ''}`}>
      <span className="brand-mark">
        <span className="brand-pulse" />
        <span className="brand-cross">+</span>
      </span>
      {!compact && (
        <span className="brand-copy">
          <strong>SQMS</strong>
          <small>Smart Queue</small>
        </span>
      )}
    </span>
  );
}

export function Spinner({ size = 18, label = 'Loading' }) {
  return <Loader2 size={size} className="spin" aria-label={label} />;
}

export function LoadingBlock({ label = 'Loading…', compact = false }) {
  return (
    <div className={`loading-block ${compact ? 'loading-compact' : ''}`}>
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, body, icon: Icon = Clock3, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={24} /></span>
      <h4>{title}</h4>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function StatusBadge({ status, label }) {
  const value = status || 'waiting';
  return (
    <span className={`status-badge status-${value}`}>
      <span className="status-dot" />
      {label || titleCase(value)}
    </span>
  );
}

export function PriorityBadge({ priority, label, showIcon = true }) {
  const icons = {
    emergency: AlertTriangle,
    senior: Crown,
    pregnant: Baby,
    disabled: Accessibility,
    general: UserRound
  };
  const Icon = icons[priority] || UserRound;
  return (
    <span className={`priority-badge priority-${priority || 'general'}`}>
      {showIcon && <Icon size={13} />}
      {label || titleCase(priority || 'general')}
    </span>
  );
}

export function RoleBadge({ role }) {
  return <span className={`role-badge role-${role}`}>{titleCase(role || '')}</span>;
}

export function Avatar({ name, size = 40, color }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: color || undefined, fontSize: size * 0.34 }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function StatCard({ icon: Icon, label, value, suffix, tone = 'teal', hint }) {
  return (
    <div className={`stat-card stat-${tone}`}>
      <div className="stat-top">
        <span className="stat-icon">{Icon && <Icon size={18} />}</span>
        {hint && <span className="stat-hint">{hint}</span>}
      </div>
      <div className="stat-value">
        {value}
        {suffix && <small>{suffix}</small>}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, subtitle, children, size = 'md', footer }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function LanguagePicker({ dark = false }) {
  const { language, setLanguage, t } = useLanguage();
  return (
    <label className={`language-picker ${dark ? 'language-dark' : ''}`}>
      <span className="sr-only">{t('common.language')}</span>
      <select value={language} onChange={(event) => setLanguage(event.target.value)}>
        {LANGUAGES.map((item) => (
          <option key={item.code} value={item.code}>{item.native}</option>
        ))}
      </select>
    </label>
  );
}

export function VoiceToggle({ enabled, onChange, dark = false }) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      className={`voice-toggle ${enabled ? 'is-on' : ''} ${dark ? 'voice-dark' : ''}`}
      onClick={() => onChange(!enabled)}
    >
      <span className="voice-rings">
        <span />
        <span />
      </span>
      {enabled ? t('track.voiceOn') : t('track.voiceOff')}
    </button>
  );
}

export function SecureNote({ children }) {
  return (
    <div className="secure-note">
      <LockKeyhole size={14} />
      <span>{children}</span>
    </div>
  );
}

export function SuccessMark() {
  return (
    <span className="success-mark">
      <CheckCircle2 size={30} />
    </span>
  );
}

export function AlertBanner({ tone = 'warning', icon: Icon = AlertTriangle, title, children }) {
  return (
    <div className={`alert-banner alert-${tone}`}>
      <span className="alert-icon"><Icon size={18} /></span>
      <div>
        {title && <strong>{title}</strong>}
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}
