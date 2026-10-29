import React, { useMemo, useState } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  CalendarClock,
  ClipboardList,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Stethoscope,
  Users,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Avatar, Logo, RoleBadge } from './UI';

const navigation = {
  admin: [
    { to: '/staff/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/staff/queues', label: 'Live queues', icon: Activity },
    { to: '/staff/frontdesk', label: 'Front desk', icon: ClipboardList },
    { to: '/staff/queue', label: 'Doctor console', icon: Stethoscope },
    { to: '/staff/team', label: 'Team & access', icon: Users }
  ],
  doctor: [
    { to: '/staff/queue', label: 'My queue', icon: Stethoscope },
    { to: '/display', label: 'Display board', icon: Monitor, external: true }
  ],
  nurse: [
    { to: '/staff/frontdesk', label: 'Front desk', icon: ClipboardList },
    { to: '/staff/queues', label: 'Live queues', icon: Activity },
    { to: '/display', label: 'Display board', icon: Monitor, external: true }
  ],
  receptionist: [
    { to: '/staff/frontdesk', label: 'Front desk', icon: CalendarClock },
    { to: '/staff/queues', label: 'Live queues', icon: Activity },
    { to: '/display', label: 'Display board', icon: Monitor, external: true }
  ]
};

const pageTitles = {
  '/staff/analytics': ['Command centre', 'Daily, weekly and monthly hospital performance'],
  '/staff/queues': ['Live operations', 'Every queue, doctor and waiting patient at a glance'],
  '/staff/frontdesk': ['Front desk', 'Registration, check-in and today’s appointments'],
  '/staff/queue': ['Doctor console', 'Call, recall, skip and manage consultation flow'],
  '/staff/team': ['Team & access', 'Role-based accounts for hospital staff']
};

export default function StaffLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [metaTitle, metaSubtitle] = useMemo(
    () => pageTitles[location.pathname] || [user?.role === 'doctor' ? 'Clinical workspace' : 'Staff workspace', 'Smart queue time management'],
    [location.pathname, user?.role]
  );
  const items = navigation[user?.role] || navigation.receptionist;

  const handleLogout = () => {
    logout();
    navigate('/staff/login');
  };

  return (
    <div className="staff-shell">
      <aside className={`staff-sidebar ${mobileOpen ? 'is-open' : ''}`}>
        <div className="sidebar-top">
          <Link to="/staff" className="brand-link" onClick={() => setMobileOpen(false)}><Logo light /></Link>
          <button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={19} /></button>
        </div>
        <div className="workspace-label">
          <span>Hospital workspace</span>
          <strong>Pune Central Hospital</strong>
        </div>
        <nav className="staff-nav">
          {items.map((item) => {
            const Icon = item.icon;
            if (item.external) {
              return (
                <Link key={item.to} to={item.to} className="staff-nav-link" onClick={() => setMobileOpen(false)}>
                  <Icon size={18} />
                  <span>{item.label}</span>
                  <ExternalLink size={13} className="nav-external" />
                </Link>
              );
            }
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `staff-nav-link ${isActive ? 'is-active' : ''}`}
                onClick={() => setMobileOpen(false)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-role-note">
          <div className="sidebar-role-icon"><LayoutDashboard size={17} /></div>
          <div>
            <span>Access level</span>
            <strong>{user?.role === 'receptionist' ? 'Receptionist' : user?.role}</strong>
          </div>
        </div>
        <div className="sidebar-user">
          <Avatar name={user?.name} size={38} />
          <div className="sidebar-user-copy">
            <strong>{user?.name}</strong>
            <span>{user?.doctorName || user?.departmentName || 'Administration'}</span>
          </div>
          <button title="Sign out" className="sidebar-logout" onClick={handleLogout}><LogOut size={17} /></button>
        </div>
      </aside>
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
      <div className="staff-main">
        <header className="staff-topbar">
          <div className="staff-topbar-left">
            <button className="mobile-menu-btn staff-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
            <div>
              <span className="eyebrow-small">SQMS · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
              <h1>{metaTitle}</h1>
              <p>{metaSubtitle}</p>
            </div>
          </div>
          <div className="staff-topbar-right">
            <RoleBadge role={user?.role} />
            <Link to="/" className="topbar-public-link" title="Patient portal"><ExternalLink size={15} /> Patient portal</Link>
          </div>
        </header>
        <main className="staff-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
