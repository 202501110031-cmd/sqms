import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Clock3,
  DoorOpen,
  Pause,
  RefreshCw,
  Stethoscope,
  Users
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Avatar, EmptyState, LoadingBlock, PriorityBadge, StatCard } from '../components/UI';
import { api } from '../lib/api';
import { socket } from '../lib/socket';

export default function AllQueuesPage() {
  const { user } = useAuth();
  const { push } = useToast();
  const [doctors, setDoctors] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [departmentId, setDepartmentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const query = departmentId ? `?departmentId=${departmentId}` : '';
      const [overview, departmentResult] = await Promise.all([
        api(`/api/staff/overview${query}`),
        api('/api/staff/departments')
      ]);
      setDoctors(overview.doctors);
      setDepartments(departmentResult.departments);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const interval = window.setInterval(() => load(true), 20000);
    const onQueue = () => load(true);
    socket.on('queue:changed', onQueue);
    return () => {
      window.clearInterval(interval);
      socket.off('queue:changed', onQueue);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId]);

  const totals = useMemo(() => doctors.reduce((accumulator, item) => ({
    waiting: accumulator.waiting + item.waiting,
    booked: accumulator.booked + item.booked,
    served: accumulator.served + item.served,
    paused: accumulator.paused + (item.paused ? 1 : 0)
  }), { waiting: 0, booked: 0, served: 0, paused: 0 }), [doctors]);

  return (
    <div className="page-stack">
      <section className="overview-toolbar">
        <div className="department-filter-chips">
          <button className={!departmentId ? 'is-active' : ''} onClick={() => setDepartmentId('')}>All departments</button>
          {departments.map((department) => (
            <button
              key={department.id}
              className={String(departmentId) === String(department.id) ? 'is-active' : ''}
              onClick={() => setDepartmentId(department.id)}
            >
              <span style={{ background: department.color }} /> {department.name}
            </button>
          ))}
        </div>
        <div className="analytics-tools">
          <button className="btn btn-ghost" onClick={() => { setRefreshing(true); load(true); }}><RefreshCw size={16} className={refreshing ? 'spin' : ''} /> Refresh</button>
          <Link to="/display" target="_blank" className="btn btn-dark">Open display board <ArrowRight size={16} /></Link>
        </div>
      </section>

      <div className="stats-grid four">
        <StatCard icon={Users} label="Patients waiting" value={totals.waiting} tone="teal" hint={`${doctors.length} doctors`} />
        <StatCard icon={Clock3} label="Booked for today" value={totals.booked} tone="blue" />
        <StatCard icon={Activity} label="Served today" value={totals.served} tone="green" />
        <StatCard icon={Pause} label="Paused queues" value={totals.paused} tone={totals.paused ? 'rose' : 'violet'} />
      </div>

      {loading && !doctors.length ? <LoadingBlock /> : doctors.length ? (
        <div className="all-queue-grid">
          {doctors.map((item) => (
            <article className={`all-queue-card ${item.paused ? 'is-paused' : ''}`} key={item.doctor.id} style={{ '--dept-color': item.doctor.departmentColor }}>
              <div className="all-queue-head">
                <Avatar name={item.doctor.name} size={44} color={item.doctor.departmentColor} />
                <div>
                  <strong>{item.doctor.name}</strong>
                  <span>{item.doctor.departmentName} · {item.doctor.room}</span>
                </div>
                <span className={`queue-live-pill ${item.paused ? 'paused' : ''}`}>
                  {item.paused ? <><Pause size={12} /> Paused</> : <><span className="live-dot" /> Live</>}
                </span>
              </div>
              <div className="all-queue-current">
                <div>
                  <span>Now serving</span>
                  <strong>{item.current?.tokenLabel || '—'}</strong>
                  {item.current && <small>{item.current.patientName}</small>}
                </div>
                <div className="queue-mini-stats">
                  <span><b>{item.waiting}</b> waiting</span>
                  <span><b>{item.booked}</b> booked</span>
                  <span><b>{item.served}</b> served</span>
                </div>
              </div>
              <div className="all-queue-next">
                <span>Next</span>
                {item.queue.slice(0, 4).map((next) => (
                  <div key={next.id} className="mini-next-token">
                    <strong>{next.tokenLabel}</strong>
                    {next.priority !== 'general' ? <PriorityBadge priority={next.priority} showIcon={false} /> : <small>~{next.etaMinutes}m</small>}
                  </div>
                ))}
                {!item.queue.length && <small className="muted-small">No one waiting</small>}
              </div>
              <div className="all-queue-foot">
                <span><Stethoscope size={14} /> Avg {item.doctor.avgMinutes} min</span>
                <span><DoorOpen size={14} /> {item.doctor.room}</span>
                {user?.role === 'admin' ? (
                  <Link to={`/staff/queue?doctorId=${item.doctor.id}`}>Open console <ArrowRight size={14} /></Link>
                ) : (
                  <Link to="/staff/frontdesk">Front desk <ArrowRight size={14} /></Link>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={Activity} title="No active queues" body="Queues will appear when appointments are checked in." />
      )}
    </div>
  );
}
