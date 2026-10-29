import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Crown,
  HeartPulse,
  Plus,
  ShieldCheck,
  Stethoscope,
  UserCog,
  Users,
  X
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import {
  Avatar,
  LoadingBlock,
  Modal,
  RoleBadge,
  Spinner,
  StatCard
} from '../components/UI';
import { api } from '../lib/api';

const emptyStaff = {
  name: '',
  email: '',
  password: '',
  role: 'nurse',
  departmentId: '',
  doctorId: '',
  phone: ''
};

const PERMISSIONS = [
  { label: 'View live queues', doctor: true, nurse: true, receptionist: true, admin: true },
  { label: 'Book & check in patients', doctor: false, nurse: true, receptionist: true, admin: true },
  { label: 'Triage / change priority', doctor: true, nurse: true, receptionist: false, admin: true },
  { label: 'Call, skip, recall, pause', doctor: true, nurse: false, receptionist: false, admin: true },
  { label: 'Send SMS / voice alerts', doctor: true, nurse: true, receptionist: true, admin: true },
  { label: 'Analytics & reports', doctor: false, nurse: false, receptionist: false, admin: true },
  { label: 'Manage staff & access', doctor: false, nurse: false, receptionist: false, admin: true }
];

export default function TeamPage() {
  const { push } = useToast();
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyStaff);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const [staffResult, departmentResult, doctorResult] = await Promise.all([
        api('/api/admin/staff'),
        api('/api/admin/departments'),
        api('/api/admin/doctors')
      ]);
      setStaff(staffResult.staff);
      setDepartments(departmentResult.departments);
      setDoctors(doctorResult.doctors);
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

  const roleCounts = useMemo(() => staff.reduce((acc, item) => {
    acc[item.role] = (acc[item.role] || 0) + 1;
    return acc;
  }, {}), [staff]);

  const openAdd = () => {
    setForm({ ...emptyStaff, departmentId: departments[0]?.id || '' });
    setModalOpen(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api('/api/admin/staff', {
        method: 'POST',
        body: {
          ...form,
          departmentId: form.departmentId || null,
          doctorId: form.role === 'doctor' ? form.doctorId || null : null
        }
      });
      push('Staff account created');
      setModalOpen(false);
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (member) => {
    setBusyId(member.id);
    try {
      await api(`/api/admin/staff/${member.id}`, {
        method: 'PATCH',
        body: { active: !member.active }
      });
      push(`${member.name} ${member.active ? 'deactivated' : 'reactivated'}`);
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const doctorProfileFor = (doctorId) => doctors.find((doctor) => doctor.id === doctorId);

  if (loading) return <LoadingBlock label="Loading staff access…" />;

  return (
    <div className="page-stack">
      <div className="stats-grid four">
        <StatCard icon={ShieldCheck} label="Administrators" value={roleCounts.admin || 0} tone="violet" />
        <StatCard icon={Stethoscope} label="Doctor accounts" value={roleCounts.doctor || 0} tone="teal" />
        <StatCard icon={HeartPulse} label="Nurses" value={roleCounts.nurse || 0} tone="rose" />
        <StatCard icon={Users} label="Receptionists" value={roleCounts.receptionist || 0} tone="blue" />
      </div>

      <section className="table-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow-small">Role-based access</span>
            <h3>Hospital staff <span className="heading-count">{staff.length}</span></h3>
          </div>
          <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Add staff account</button>
        </div>
        <div className="analytics-table-wrap">
          <table className="analytics-table staff-table">
            <thead>
              <tr><th>Staff member</th><th>Role</th><th>Department</th><th>Linked doctor</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr key={member.id} className={!member.active ? 'row-inactive' : ''}>
                  <td>
                    <span className="doctor-cell">
                      <Avatar name={member.name} size={34} />
                      <span><strong>{member.name}</strong><small>{member.email}</small></span>
                    </span>
                  </td>
                  <td><RoleBadge role={member.role} /></td>
                  <td>{member.departmentName || '—'}</td>
                  <td>{member.doctorName || '—'}</td>
                  <td><span className={`active-pill ${member.active ? 'is-active' : ''}`}>{member.active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <button className={`btn btn-small ${member.active ? 'btn-danger-ghost' : 'btn-ghost'}`} onClick={() => toggleActive(member)} disabled={busyId === member.id}>
                      {busyId === member.id ? <Spinner size={13} /> : member.active ? <X size={13} /> : <Check size={13} />}
                      {member.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="team-lower-grid">
        <section className="permissions-card">
          <div className="panel-heading">
            <div><span className="eyebrow-small">Separation of duties</span><h3>What each role can do</h3></div>
            <UserCog size={20} />
          </div>
          <div className="permission-table">
            <div className="permission-head">
              <span>Permission</span><span>Doctor</span><span>Nurse</span><span>Reception</span><span>Admin</span>
            </div>
            {PERMISSIONS.map((permission) => (
              <div className="permission-row" key={permission.label}>
                <span>{permission.label}</span>
                {['doctor', 'nurse', 'receptionist', 'admin'].map((role) => (
                  <span key={role} className={permission[role] ? 'perm-yes' : 'perm-no'}>
                    {permission[role] ? <Check size={14} /> : <X size={13} />}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="roster-card">
          <div className="panel-heading">
            <div><span className="eyebrow-small">Consultation rooms</span><h3>Doctor roster</h3></div>
            <Crown size={19} />
          </div>
          <div className="roster-list">
            {doctors.map((doctor) => (
              <div className="roster-row" key={doctor.id}>
                <Avatar name={doctor.name} size={36} />
                <div><strong>{doctor.name}</strong><small>{doctor.department_name} · {doctor.room}</small></div>
                <span className={`active-pill ${doctor.active ? 'is-active' : ''}`}>{doctor.active ? 'Available' : 'Off duty'}</span>
                <span className="roster-avg">{doctor.avg_minutes}m</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add staff account"
        subtitle="Create role-based access for a hospital team member"
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>
              {saving ? <Spinner size={15} /> : <Plus size={15} />} Create account
            </button>
          </>
        )}
      >
        <form className="modal-form" onSubmit={submit}>
          <div className="form-grid two">
            <label className="field"><span>Full name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Staff member name" /></label>
            <label className="field"><span>Email</span><input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@sqms.health" /></label>
          </div>
          <div className="form-grid two">
            <label className="field"><span>Password</span><input type="password" required minLength="6" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="At least 6 characters" /></label>
            <label className="field"><span>Phone</span><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Optional contact number" /></label>
          </div>
          <div className="form-grid two">
            <label className="field">
              <span>Role</span>
              <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                <option value="doctor">Doctor</option>
                <option value="nurse">Nurse</option>
                <option value="receptionist">Receptionist</option>
                <option value="admin">Administrator</option>
              </select>
            </label>
            <label className="field">
              <span>Department</span>
              <select value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })}>
                <option value="">No department</option>
                {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </label>
          </div>
          {form.role === 'doctor' && (
            <label className="field">
              <span>Linked doctor profile</span>
              <select value={form.doctorId} onChange={(event) => setForm({ ...form, doctorId: event.target.value })} required>
                <option value="">Select doctor profile</option>
                {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} · {doctor.department_name}</option>)}
              </select>
            </label>
          )}
          <p className="modal-help">The new user can sign in immediately at <code>/staff/login</code> with this email and password.</p>
          <button type="submit" hidden />
        </form>
      </Modal>
    </div>
  );
}
