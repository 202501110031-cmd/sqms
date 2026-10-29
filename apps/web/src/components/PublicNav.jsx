import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, Monitor, Ticket, X } from 'lucide-react';
import { Logo, LanguagePicker } from './UI';
import { useLanguage } from '../context/LanguageContext';

export default function PublicNav() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const links = [
    { to: '/', label: t('nav.home'), end: true },
    { to: '/book', label: t('nav.book') },
    { to: '/track', label: t('nav.track') },
    { to: '/display', label: t('nav.display') }
  ];

  return (
    <header className="public-nav">
      <div className="public-nav-inner">
        <Link to="/" className="brand-link" onClick={() => setOpen(false)}>
          <Logo />
        </Link>
        <nav className={`public-links ${open ? 'is-open' : ''}`}>
          {links.map((link) => (
            link.to.startsWith('/#') ? (
              <a key={link.to} href={link.to} onClick={() => setOpen(false)}>{link.label}</a>
            ) : (
              <NavLink key={link.to} to={link.to} end={link.end} onClick={() => setOpen(false)}>
                {link.label}
              </NavLink>
            )
          ))}
          <Link to="/staff/login" className="mobile-login" onClick={() => setOpen(false)}>{t('nav.login')}</Link>
        </nav>
        <div className="nav-actions">
          <LanguagePicker />
          <Link to="/track" className="nav-track-btn" title={t('nav.track')}>
            <Ticket size={16} />
            <span>{t('nav.track')}</span>
          </Link>
          <Link to="/staff/login" className="nav-login-btn">{t('nav.login')}</Link>
          <button className="mobile-menu-btn" onClick={() => setOpen(!open)} aria-label="Menu">
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  const { t } = useLanguage();
  return (
    <footer className="public-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Logo light />
          <p>{t('home.footerNote')}</p>
        </div>
        <div className="footer-links">
          <div>
            <strong>Patients</strong>
            <Link to="/book">{t('nav.book')}</Link>
            <Link to="/track">{t('nav.track')}</Link>
            <Link to="/display">{t('nav.display')}</Link>
          </div>
          <div>
            <strong>Hospital</strong>
            <Link to="/staff/login">{t('nav.staffPortal') || t('nav.login')}</Link>
            <span>Emergency · 108</span>
            <span>Reception · 020 4000 1200</span>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} SQMS Health · {t('home.demoNote')}</span>
        <span className="footer-monitor"><Monitor size={13} /> Live queue technology</span>
      </div>
    </footer>
  );
}
