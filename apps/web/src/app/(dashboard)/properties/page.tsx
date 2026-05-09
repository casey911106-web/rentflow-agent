'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ScoreBadge, StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface PropertyRow {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  area: string | null;
  priceAed: string | null;
  qualityScore: number;
  readinessScore: number;
  owner: { fullName: string } | null;
  submittedBy: { id: string; fullName: string | null; email: string | null } | null;
  assignedFieldAgent: { id: string; fullName: string | null } | null;
  _count: { leads: number; postPackages: number; viewings: number };
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'available', label: 'Available' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_owner_confirmation', label: 'Pending owner' },
  { value: 'rented', label: 'Rented' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'archived', label: 'Archived' },
  { value: 'needs_media', label: 'Needs media' },
  { value: 'needs_price_confirmation', label: 'Needs price' },
  { value: 'not_ready_to_post', label: 'Not ready' },
];

export default function PropertiesPage() {
  const [statusFilter, setStatusFilter] = useState<string>('available');

  const { data, isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api<PropertyRow[]>('/properties'),
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    if (statusFilter === 'all') return data;
    return data.filter((p) => p.status === statusFilter);
  }, [data, statusFilter]);

  return (
    <div>
      <header className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1>Properties</h1>
          <p className="mt-1 text-sm text-gray-medium">Inventory + readiness gate for posting.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-gray-light bg-white px-3 py-2.5 text-sm font-medium text-gray-dark shadow-sm focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <Link
            href="/properties/new"
            className="inline-flex items-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#008C8A]"
          >
            + Add property
          </Link>
        </div>
      </header>

      <div className="overflow-x-auto rounded-md border border-gray-light bg-white shadow-card">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-offwhite text-xs uppercase tracking-wide text-gray-medium">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Area</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Readiness</th>
              <th className="px-4 py-3">Quality</th>
              <th className="px-4 py-3">Leads</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-medium">Loading…</td></tr>
            ) : !filtered.length ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-medium">
                {statusFilter === 'all' ? 'No properties yet.' : 'No properties match this filter.'}
              </td></tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="border-t border-gray-light hover:bg-offwhite">
                  <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                  <td className="px-4 py-3 font-semibold">
                    <Link href={`/properties/${p.id}`} className="text-navy hover:underline">{p.name}</Link>
                    {p.submittedBy ? (
                      <span
                        title={`Sourced by partner: ${p.submittedBy.fullName ?? p.submittedBy.email}`}
                        className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800"
                      >
                        Partner
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-gray-dark">{p.type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-gray-dark">{p.area ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-dark">{p.priceAed ? `AED ${Number(p.priceAed).toLocaleString()}` : '—'}</td>
                  <td className="px-4 py-3 text-gray-dark">
                    {p.owner?.fullName ?? '—'}
                    {p.assignedFieldAgent?.fullName ? (
                      <span className="block text-[11px] text-gray-medium">
                        Viewings: {p.assignedFieldAgent.fullName}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3"><StatusPill status={p.status} /></td>
                  <td className="px-4 py-3"><ScoreBadge score={p.readinessScore} /></td>
                  <td className="px-4 py-3"><ScoreBadge score={p.qualityScore} /></td>
                  <td className="px-4 py-3 text-gray-dark">{p._count.leads}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
