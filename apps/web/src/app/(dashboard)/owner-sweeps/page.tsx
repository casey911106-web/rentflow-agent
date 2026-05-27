'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface SweepRow {
  id: string;
  status: 'pending' | 'in_progress' | 'closed';
  assignedAt: string | null;
  createdAt: string;
  closedAt: string | null;
  owner: { fullName: string | null; phoneE164: string };
  assignee: { fullName: string | null } | null;
  _count: { items: number };
}

interface Coverage {
  openSweeps: number;
  openSweepsOver24h: number;
  closedLast7d: number;
  itemsResolvedRate: number;
}

const STATUSES: Array<'pending' | 'in_progress' | 'closed' | ''> = [
  '',
  'pending',
  'in_progress',
  'closed',
];

export default function OwnerSweepsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'pending' | 'in_progress' | 'closed' | ''>('');
  const [ownerId, setOwnerId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createOwnerId, setCreateOwnerId] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const queryString = new URLSearchParams();
  if (status) queryString.set('status', status);
  if (ownerId) queryString.set('ownerId', ownerId);
  const qs = queryString.toString();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['owner-sweeps', status, ownerId],
    queryFn: () => api<SweepRow[]>(`/owner-sweeps${qs ? `?${qs}` : ''}`),
  });

  const { data: coverage } = useQuery({
    queryKey: ['owner-sweeps-coverage'],
    queryFn: () => api<Coverage>('/owner-sweeps/coverage'),
  });

  async function createSweep() {
    setCreateError(null);
    try {
      await api('/owner-sweeps', {
        method: 'POST',
        body: JSON.stringify({ ownerId: createOwnerId }),
      });
      setShowCreate(false);
      setCreateOwnerId('');
      qc.invalidateQueries({ queryKey: ['owner-sweeps'] });
      qc.invalidateQueries({ queryKey: ['owner-sweeps-coverage'] });
    } catch (err) {
      setCreateError((err as Error).message);
    }
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Owner sweeps</h1>
          <p className="mt-1 text-sm text-gray-medium">
            One conversation per owner: availability + FAQ across all their properties.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-teal px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#008C8A]"
        >
          Manual create
        </button>
      </header>

      {coverage ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Open" value={coverage.openSweeps} />
          <Stat label="Open > 24h" value={coverage.openSweepsOver24h} warn />
          <Stat label="Closed (7d)" value={coverage.closedLast7d} />
          <Stat
            label="Resolved rate"
            value={`${Math.round(coverage.itemsResolvedRate * 100)}%`}
          />
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="text-gray-medium">Status:</label>
        {STATUSES.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              status === s ? 'bg-teal text-white' : 'bg-white text-gray-dark border border-gray-light'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
        <input
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          placeholder="Owner ID…"
          className="ml-auto rounded-md border border-gray-light px-3 py-1 text-xs"
        />
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-light bg-white shadow-card">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-offwhite text-xs uppercase tracking-wide text-gray-medium">
            <tr>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Assignee</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-medium">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-medium">
                  No sweeps match.
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={s.id} className="border-t border-gray-light hover:bg-offwhite">
                  <td className="px-4 py-3 font-semibold">
                    <Link href={`/owner-sweeps/${s.id}`} className="text-navy hover:underline">
                      {s.owner.fullName ?? s.owner.phoneE164}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-dark">{s._count.items}</td>
                  <td className="px-4 py-3 text-gray-dark">
                    {s.assignee?.fullName ?? '— unassigned —'}
                  </td>
                  <td className="px-4 py-3 text-gray-dark">
                    {new Date(s.createdAt).toLocaleString('en-GB', {
                      timeZone: 'Asia/Dubai',
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={s.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <div className="w-[420px] rounded-md bg-white p-5 shadow-xl">
            <h2 className="mb-3 text-base font-semibold text-navy">Create manual sweep</h2>
            <label className="block text-sm text-gray-medium">Owner ID</label>
            <input
              value={createOwnerId}
              onChange={(e) => setCreateOwnerId(e.target.value)}
              placeholder="owner-uuid…"
              className="mt-1 w-full rounded-md border border-gray-light px-3 py-2 text-sm"
            />
            {createError ? (
              <p className="mt-2 text-xs text-red-700">{createError}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowCreate(false);
                  setCreateError(null);
                }}
                className="rounded-md border border-gray-light bg-white px-3 py-1.5 text-sm text-gray-dark"
              >
                Cancel
              </button>
              <button
                onClick={createSweep}
                disabled={!createOwnerId}
                className="rounded-md bg-teal px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="rounded-md border border-gray-light bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-gray-medium">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${warn ? 'text-red-700' : 'text-navy'}`}>
        {value}
      </div>
    </div>
  );
}
