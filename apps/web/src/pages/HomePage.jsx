import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BellRing,
  CalendarPlus,
  Languages,
  Monitor,
  Search,
  ShieldCheck,
  Stethoscope,
  Trash2
} from 'lucide-react';
import PublicNav, { PublicFooter } from '../components/PublicNav';
import { StatusBadge } from '../components/UI';
import { useLanguage } from '../context/LanguageContext';
import { formatDate } from '../lib/format';
import { getSavedTokens, removeSavedToken } from '../lib/savedTokens';

const ACCESS_LINKS = [
  {
    to: '/book',
    tone: 'primary',
    icon: CalendarPlus,
    titleKey: 'home.bookActionTitle',
    bodyKey: 'home.bookActionBody'
  },
  {
    to: '/track',
    tone: 'blue',
    icon: Search,
    titleKey: 'home.trackActionTitle',
    bodyKey: 'home.trackActionBody'
  },
  {
    to: '/display',
    tone: 'amber',
    icon: Monitor,
    titleKey: 'home.displayActionTitle',
    bodyKey: 'home.displayActionBody'
  },
  {
    to: '/staff/login',
    tone: 'dark',
    icon: Stethoscope,
    titleKey: 'home.staffActionTitle',
    bodyKey: 'home.staffActionBody'
  }
];

export default function HomePage() {
  const { t } = useLanguage();
  const [savedTokens, setSavedTokens] = useState(() => getSavedTokens());

  const removeToken = (code) => {
    setSavedTokens(removeSavedToken(code));
  };

  return (
    <div className="public-shell">
      <PublicNav />
      <main className="home-main">
        <section className="home-hub">
          <div className="home-intro">
            <span className="eyebrow"><span className="live-dot" /> {t('home.eyebrow')}</span>
            <h1>{t('home.title')}</h1>
            <p>{t('home.subtitle')}</p>
            <div className="home-facts">
              <span><ShieldCheck size={15} /> {t('home.bookBadge')}</span>
              <span><Languages size={15} /> English · मराठी · हिंदी</span>
              <span><BellRing size={15} /> {t('home.liveBadge')}</span>
            </div>
          </div>

          <div className="home-access-grid">
            {ACCESS_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.to} to={item.to} className={`home-access-card access-${item.tone}`}>
                  <span className="home-access-icon"><Icon size={21} /></span>
                  <span className="home-access-copy">
                    <strong>{t(item.titleKey)}</strong>
                    <small>{t(item.bodyKey)}</small>
                  </span>
                  <span className="home-access-arrow"><ArrowRight size={17} /></span>
                </Link>
              );
            })}
          </div>
        </section>

        {savedTokens.length > 0 && (
          <section className="home-saved">
            <div className="home-section-head">
              <div>
                <span className="eyebrow">{t('home.savedEyebrow')}</span>
                <h2>{t('home.savedTitle')}</h2>
                <p>{t('home.savedBody')}</p>
              </div>
              <Link to="/track" className="btn btn-ghost">
                {t('home.trackActionTitle')} <ArrowRight size={16} />
              </Link>
            </div>
            <div className="saved-token-grid">
              {savedTokens.map((token) => (
                <article className="saved-token-card" key={token.code}>
                  <div className="saved-token-top">
                    <span className="saved-token-label">{token.tokenLabel}</span>
                    <StatusBadge status={token.status} label={t(`status.${token.status}`)} />
                  </div>
                  <h3>{token.patientName || token.code}</h3>
                  <p>{token.departmentName}{token.doctorName ? ` · ${token.doctorName}` : ''}</p>
                  <div className="saved-token-meta">
                    <span>{formatDate(token.date)}</span>
                    {token.room && <span>{token.room}</span>}
                  </div>
                  <div className="saved-token-actions">
                    <Link to={`/track/${token.code}`}>
                      {t('home.openTracker')} <ArrowRight size={15} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => removeToken(token.code)}
                      title={t('home.removeToken')}
                      aria-label={t('home.removeToken')}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
