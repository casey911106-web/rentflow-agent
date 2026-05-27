'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface SweepItemDetail {
  id: string;
  availability: 'available' | 'rented' | 'price_changed' | 'no_answer' | null;
  sharedAt: string | null;
  resolvedAt: string | null;
  faqAllRequired: boolean;
  newPriceAed: string | null;
  notes: string | null;
  property: {
    id: string;
    code: string;
    name: string;
    area: string | null;
    priceAed: string | null;
  };
}

interface SweepDetail {
  id: string;
  status: 'pending' | 'in_progress' | 'closed';
  createdAt: string;
  assignedAt: string | null;
  startedAt: string | null;
  closedAt: string | null;
  owner: { id: string; fullName: string | null; phoneE164: string };
  assignee: { id: string; fullName: string | null } | null;
  items: SweepItemDetail[];
}

const OUTCOME_BADGE: Record<NonNullable<SweepItemDetail['availability']>, string> = {
  available: 'bg-teal/10 text-teal',
  rented: 'bg-red-100 text-red-700',
  price_changed: 'bg-amber-100 text-amber-700',
  no_answer: 'bg-gray-light text-gray-medium',
};

export default function OwnerSweepDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: sweep, isLoading } = useQuery({
    queryKey: ['owner-sweep', id],
    queryFn: () => api<SweepDetail>(`/owner-sweeps/${id}`),
    enabled: Boolean(id),
  });

  if (isLoading) return <p>Loading…</p>;
  if (!sweep) return <p>Sweep not found.</p>;

  return (
    <div>
      <header className="mb-6">
        <h1>{sweep.owner.fullName ?? sweep.owner.phoneE164}</h1>
        <p className="mt-1 text-sm text-gray-medium">
          {sweep.owner.phoneE164} · {sweep.items.length} properties · created{' '}
          {new Date(sweep.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' })}
        </p>
        <div className="mt-2 flex gap-2 text-sm">
          <StatusPill status={sweep.status} />
          <span className="text-gray-medium">
            Assignee: {sweep.assignee?.fullName ?? '— unassigned —'}
          </span>
        </div>
      </header>

      <div className="overflow-x-auto rounded-md border border-gray-light bg-white shadow-card">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-offwhite text-xs uppercase tracking-wide text-gray-medium">
            <tr>
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3">Area</th>
              <th className="px-4 py-3">Outcome</th>
              <th className="px-4 py-3">FAQ</th>
              <th className="px-4 py-3">Shared</th>
              <th className="px-4 py-3">Resolved</th>
              <th className="px-4 py-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sweep.items.map((it) => (
              <tr key={it.id} className="border-t border-gray-light">
                <td className="px-4 py-3 font-semibold text-navy">
                  {it.property.code} — {it.property.name}
                </td>
                <td className="px-4 py-3 text-gray-dark">{it.property.area ?? '—'}</td>
                <td className="px-4 py-3">
                  {it.availability ? (
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${OUTCOME_BADGE[it.availability]}`}
                    >
                      {it.availability.replace('_', ' ')}
                      {it.availability === 'price_changed' && it.newPriceAed
                        ? ` → ${it.newPriceAed}`
                        : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-medium">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  {it.faqAllRequired ? '✓ filled' : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-gray-medium">
                  {it.sharedAt
                    ? new Date(it.sharedAt).toLocaleString('en-GB', {
                        timeZone: 'Asia/Dubai',
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-gray-medium">
                  {it.resolvedAt
                    ? new Date(it.resolvedAt).toLocaleString('en-GB', {
                        timeZone: 'Asia/Dubai',
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-gray-dark">{it.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
