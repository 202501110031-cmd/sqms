import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BellRing,
  CalendarDays,
  CheckCheck,
  Clock3,
  Download,
  RefreshCw,
  TimerReset,
  TrendingUp,
  Users
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { LoadingBlock, Spinner, StatCard, StatusBadge } from '../components/UI';
import { api, downloadExport } from '../lib/api';
import { socket } from '../lib/socket';
import { formatDate, formatTime, titleCase } from '../lib/format';

const PERIODS = [
  { value: 'daily', label: 'Daily', sub: 'Today' },
  { value: 'weekly', label: 'Weekly', sub: '7 days' },
  { value: 'monthly', label: 'Monthly', sub: '30 days' }
];

const PRIORITY_COLORS = {
  emergency: '#dc2626',
  senior: '#d97706',
  pregnant: '#a21caf',
  disabled: '#2563eb',
  general: '#64748b'
};

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export default function AnalyticsPage() {
  const { push } = useToast();
  const [period, setPeriod] = useState('daily');
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [data, setData] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const query = `period=${period}${departmentId ? `&departmentId=${departmentId}` : ''}`;
      const [analytics, outbox] = await Promise.all([
        api(`/api/admin/analytics?${query}`),
        api('/api/admin/notifications?limit=14')
      ]);
      setData(analytics);
      setNotifications(outbox.notifications);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    api('/api/public/departments', { auth: false })
      .then((result) => setDepartments(result.departments))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => load(true), 30000);
    const onQueue = () => load(true);
    socket.on('queue:changed', onQueue);
    socket.on('notifications:changed', onQueue);
    return () => {
      window.clearInterval(interval);
      socket.off('queue:changed', onQueue);
      socket.off('notifications:changed', onQueue);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, departmentId]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadExport(period);
      push('CSV report downloaded');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const priorityGradient = useMemo(() => {
    if (!data) return 'conic-gradient(#e2e8f0 0deg 360deg)';
    const total = data.priorityMix.reduce((sum, item) => sum + item.count, 0) || 1;
    let cursor = 0;
    const segments = data.priorityMix
      .filter((item) => item.count > 0)
      .map((item) => {
        const start = (cursor / total) * 360;
        cursor += item.count;
        const end = (cursor / total) * 360;
        return `${PRIORITY_COLORS[item.priority]} ${start}deg ${end}deg`;
      });
    return segments.length ? `conic-gradient(${segments.join(', ')})` : 'conic-gradient(#e2e8f0 0deg 360deg)';
  }, [data]);

  const maxTrend = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.trend.map((item) => Math.max(item.bookings, item.served)), 1);
  }, [data]);

  const maxHourly = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.hourly.map((item) => item.checkins), 1);
  }, [data]);

  if (loading && !data) {
    return <LoadingBlock label="Preparing hospital analytics…" />;
  }

  const summary = data?.summary || {};

  return (
    <div className="page-stack analytics-page">
      <section className="analytics-toolbar">
        <div className="period-switch">
          {PERIODS.map((item) => (
            <button key={item.value} className={period === item.value ? 'is-active' : ''} onClick={() => setPeriod(item.value)}>
              <span>{item.label}</span><small>{item.sub}</small>
            </button>
          ))}
        </div>
        <div className="analytics-tools">
          <label className="compact-select light-select">
            <span>Department</span>
            <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
              <option value="">All departments</option>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </label>
          <button className="btn btn-ghost" onClick={() => { setRefreshing(true); load(true); }}>
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} /> Refresh
          </button>
          <button className="btn btn-dark" onClick={handleExport} disabled={exporting}>
            {exporting ? <Spinner size={15} /> : <Download size={16} />} Export CSV
          </button>
        </div>
      </section>

      <div className="analytics-context">
        <span><CalendarDays size={14} /> {data?.range?.label} · {formatDate(data?.range?.from)} – {formatDate(data?.range?.to)}</span>
        <span><span className="live-dot" /> Live figures · auto-refresh 30s</span>
      </div>

      <div className="stats-grid six">
        <StatCard icon={TicketIcon} label="Total visits" value={summary.totalBookings ?? 0} tone="teal" hint={data?.period} />
        <StatCard icon={CheckCheck} label="Served" value={summary.served ?? 0} tone="green" hint={`${summary.servedRate ?? 0}% completion`} />
        <StatCard icon={Clock3} label="Average wait" value={summary.avgWait ?? 0} suffix="min" tone="amber" hint="check-in → call" />
        <StatCard icon={TimerReset} label="Avg consultation" value={summary.avgConsult ?? 0} suffix="min" tone="blue" />
        <StatCard icon={Activity} label="In queue now" value={summary.active ?? 0} tone="violet" hint={`${summary.waiting ?? 0} waiting`} />
        <StatCard icon={AlertTriangle} label="Priority cases" value={summary.emergency ?? 0} tone="rose" hint="emergency" />
      </div>

      <div className="analytics-main-grid">
        <section className="chart-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow-small">Demand & throughput</span>
              <h3>Patient flow</h3>
            </div>
            <div className="chart-legend">
              <span><i className="legend-bookings" /> Visits</span>
              <span><i className="legend-served" /> Served</span>
            </div>
          </div>
          <div className={`trend-chart ${data?.period === 'monthly' ? 'trend-dense' : ''}`}>
            {data?.trend?.map((item) => (
              <div className="trend-column" key={item.date}>
                <div className="trend-bars">
                  <span className="trend-bar bookings" style={{ height: `${Math.max(4, (item.bookings / maxTrend) * 100)}%` }} title={`${item.bookings} visits`} />
                  <span className="trend-bar served" style={{ height: `${Math.max(2, (item.served / maxTrend) * 100)}%` }} title={`${item.served} served`} />
                </div>
                <span className="trend-label">{new Date(`${item.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              </div>
            ))}
          </div>
          <div className="chart-foot">
            <span><TrendingUp size={14} /> Peak check-in hour: <strong>{summary.peakHour}</strong></span>
            <span>No-show rate: <strong>{summary.noShowRate ?? 0}%</strong></span>
          </div>
        </section>

        <section className="chart-card priority-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow-small">Equity</span>
              <h3>Priority mix</h3>
            </div>
          </div>
          <div className="priority-donut-wrap">
            <div className="priority-donut" style={{ background: priorityGradient }}>
              <div className="donut-center">
                <strong>{summary.totalBookings ?? 0}</strong>
                <span>visits</span>
              </div>
            </div>
            <div className="priority-legend">
              {data?.priorityMix?.map((item) => (
                <div key={item.priority}>
                  <span className="priority-swatch" style={{ background: PRIORITY_COLORS[item.priority] }} />
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="priority-insight">
            <AlertTriangle size={15} />
            <span><strong>{summary.emergency ?? 0} emergency</strong> patients were prioritised across this period.</span>
          </div>
        </section>
      </div>

      <section className="chart-card hourly-card">
        <div className="panel-heading">
          <div>
            <span className="eyebrow-small">When patients arrive</span>
            <h3>Check-ins by hour</h3>
          </div>
          <span className="chart-note">7 AM – 8 PM</span>
        </div>
        <div className="hourly-chart">
          {data?.hourly?.map((item) => (
            <div className="hour-column" key={item.hour}>
              <span className="hour-value">{item.checkins || ''}</span>
              <span className="hour-bar" style={{ height: `${Math.max(3, (item.checkins / maxHourly) * 100)}%` }} />
              <span className="hour-label">{item.label.replace(':00', '')}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="analytics-tables">
        <section className="table-panel">
          <div className="panel-heading">
            <div><span className="eyebrow-small">By speciality</span><h3>Department performance</h3></div>
          </div>
          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead><tr><th>Department</th><th>Visits</th><th>Served</th><th>Avg wait</th><th>Avg consult</th><th>Active</th></tr></thead>
              <tbody>
                {data?.byDepartment?.map((item) => (
                  <tr key={item.id}>
                    <td><span className="dept-table-name"><i style={{ background: item.color }} />{item.name}</span></td>
                    <td>{item.bookings}</td>
                    <td>{item.served}</td>
                    <td>{item.avgWait}m</td>
                    <td>{item.avgConsult}m</td>
                    <td><span className={`active-count ${item.active ? 'has-active' : ''}`}>{item.active}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="table-panel">
          <div className="panel-heading">
            <div><span className="eyebrow-small">Care team</span><h3>Doctor performance</h3></div>
          </div>
          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead><tr><th>Doctor</th><th>Served</th><th>Avg wait</th><th>Avg consult</th><th>Active</th></tr></thead>
              <tbody>
                {data?.doctorStats?.length ? data.doctorStats.map((item) => (
                  <tr key={item.id}>
                    <td><span className="doctor-cell"><span className="table-avatar">{initials(item.name)}</span><span><strong>{item.name}</strong><small>{item.department}</small></span></span></td>
                    <td>{item.served}</td>
                    <td>{item.avgWait}m</td>
                    <td>{item.avgConsult}m</td>
                    <td>{item.active}</td>
                  </tr>
                )) : <tr><td colSpan="5" className="muted-cell">No doctor activity in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="analytics-bottom-grid">
        <section className="activity-card">
          <div className="panel-heading compact">
            <div><span className="eyebrow-small">Audit trail</span><h3>Recent activity</h3></div>
          </div>
          <div className="activity-list">
            {data?.recentActivity?.length ? data.recentActivity.map((item) => (
              <div className="activity-row" key={item.id}>
                <span className="activity-icon"><Activity size={14} /></span>
                <div><strong>{titleCase(item.action)}</strong><small>{item.actor_role} · {formatTime(item.created_at)}</small></div>
              </div>
            )) : <p className="muted-small section-empty">No activity recorded yet.</p>}
          </div>
        </section>

        <section className="activity-card notification-outbox">
          <div className="panel-heading compact">
            <div><span className="eyebrow-small">Alert delivery</span><h3>Notification outbox</h3></div>
            <span className="outbox-mode">{notifications.length ? 'SMS · APP · VOICE' : '—'}</span>
          </div>
          <div className="outbox-list">
            {notifications.length ? notifications.slice(0, 8).map((item) => (
              <div className="outbox-row" key={item.id}>
                <span className={`channel-badge channel-${item.channel}`}>{item.channel.toUpperCase()}</span>
                <div><p>{item.message}</p><small>{item.patient_name || 'Patient'} · {formatTime(item.created_at)} · {item.status}</small></div>
              </div>
            )) : <p className="muted-small section-empty">Alerts will appear here when calls or delays are sent.</p>}
          </div>
          <p className="outbox-note"><BellRing size={13} /> Without Twilio credentials, SMS delivery is simulated and logged for audit.</p>
        </section>
      </div>
    </div>
  );
}

function TicketIcon(props) {
  return <BarChart3 {...props} />;
}
