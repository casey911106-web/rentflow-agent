'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Role = 'super_admin' | 'ops_manager' | 'field_agent';
const ALL_ROLES: Role[] = ['super_admin', 'ops_manager', 'field_agent'];
const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super admin',
  ops_manager: 'Ops manager',
  field_agent: 'Field agent',
};

type User = {
  id: string;
  email: string;
  fullName: string;
  roles: Role[];
  status: string;
  phoneE164: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const list = await api<User[]>('/users');
      setUsers(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy-deep">Users</h1>
          <p className="text-sm text-gray-medium">Create users and assign one or more roles. Super admin only.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-[#008C8A]"
        >
          + New user
        </button>
      </header>

      {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-danger">{error}</p> : null}
      {loading ? <p className="text-sm text-gray-medium">Loading…</p> : null}

      <div className="overflow-hidden rounded-md border border-gray-light bg-white">
        <table className="w-full text-sm">
          <thead className="bg-offwhite text-left text-xs uppercase tracking-wide text-gray-medium">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last login</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-gray-light">
                <td className="px-4 py-3 font-medium text-navy-deep">{u.fullName}</td>
                <td className="px-4 py-3 text-gray-dark">{u.email}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <span key={r} className="rounded-full bg-teal/10 px-2 py-0.5 text-xs text-teal">
                        {ROLE_LABEL[r]}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-medium">{u.status}</td>
                <td className="px-4 py-3 text-gray-medium">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setEditingId(u.id)}
                    className="text-xs font-semibold text-teal hover:underline"
                  >
                    Edit roles
                  </button>
                </td>
              </tr>
            ))}
            {!loading && users.length === 0 ? (
              <tr><td className="px-4 py-6 text-center text-gray-medium" colSpan={6}>No users yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {showCreate ? (
        <CreateUserModal onClose={() => setShowCreate(false)} onCreated={reload} />
      ) : null}
      {editingId ? (
        <EditRolesModal
          user={users.find((u) => u.id === editingId)!}
          onClose={() => setEditingId(null)}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phoneE164, setPhoneE164] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<Role[]>(['ops_manager']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleRole(r: Role) {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({ email, fullName, password, roles, phoneE164: phoneE164 || undefined }),
      });
      onCreated();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Create user">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Full name">
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className={inputCls} />
        </Field>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputCls} />
        </Field>
        <Field label="Phone (E.164)">
          <input value={phoneE164} onChange={(e) => setPhoneE164(e.target.value)} placeholder="+9715..." className={inputCls} />
        </Field>
        <Field label="Temporary password">
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className={inputCls} />
        </Field>
        <Field label="Roles (one or more)">
          <div className="flex flex-wrap gap-2">
            {ALL_ROLES.map((r) => (
              <label key={r} className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium ${roles.includes(r) ? 'bg-teal text-white' : 'bg-gray-light text-gray-dark'}`}>
                <input type="checkbox" className="hidden" checked={roles.includes(r)} onChange={() => toggleRole(r)} />
                {ROLE_LABEL[r]}
              </label>
            ))}
          </div>
        </Field>
        {err ? <p className="text-sm text-danger">{err}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm">Cancel</button>
          <button type="submit" disabled={busy || roles.length === 0} className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditRolesModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const [roles, setRoles] = useState<Role[]>(user.roles);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleRole(r: Role) {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/users/${user.id}/roles`, { method: 'PATCH', body: JSON.stringify({ roles }) });
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title={`Edit roles — ${user.fullName}`}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {ALL_ROLES.map((r) => (
            <label key={r} className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium ${roles.includes(r) ? 'bg-teal text-white' : 'bg-gray-light text-gray-dark'}`}>
              <input type="checkbox" className="hidden" checked={roles.includes(r)} onChange={() => toggleRole(r)} />
              {ROLE_LABEL[r]}
            </label>
          ))}
        </div>
        {err ? <p className="text-sm text-danger">{err}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm">Cancel</button>
          <button onClick={save} disabled={busy || roles.length === 0} className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const inputCls = 'w-full rounded-md border border-gray-light px-3 py-2 text-sm focus:border-teal focus:outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-medium">{label}</label>
      {children}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-md bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold text-navy-deep">{title}</h2>
        {children}
      </div>
    </div>
  );
}
