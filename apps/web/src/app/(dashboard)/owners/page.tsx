'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ScoreBadge } from '@rentflow/ui';
import { api } from '@/lib/api';

interface OwnerRow {
  id: string;
  fullName: string;
  phoneE164: string;
  trustScore: number;
  responseRate: number;
  lastContactedAt: string | null;
  _count: { properties: number };
}

export default function OwnersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['owners'],
    queryFn: () => api<OwnerRow[]>('/owners'),
  });

  return (
    <div>
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1>Owners</h1>
          <p className="mt-1 text-sm text-gray-medium">Daily availability checks; response rate drives trust.</p>
        </div>
        <Link
          href="/owners/new"
          className="inline-flex items-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#008C8A]"
        >
          + Add owner
        </Link>
      </header>

      <div className="overflow-hidden rounded-md border border-gray-light bg-white shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-offwhite text-xs uppercase tracking-wide text-gray-medium">
            <tr>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Properties</th>
              <th className="px-4 py-3">Response</th>
              <th className="px-4 py-3">Trust</th>
              <th className="px-4 py-3">Last contact</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-medium">Loading…</td></tr>
            ) : !data?.length ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-medium">No owners yet.</td></tr>
            ) : (
              data.map((o) => (
                <tr key={o.id} className="border-t border-gray-light hover:bg-offwhite">
                  <td className="px-4 py-3 font-semibold">
                    <Link href={`/owners/${o.id}`} className="text-navy hover:underline">
                      {o.fullName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{o.phoneE164}</td>
                  <td className="px-4 py-3 text-gray-dark">{o._count.properties}</td>
                  <td className="px-4 py-3 text-gray-dark">{(o.responseRate * 100).toFixed(0)}%</td>
                  <td className="px-4 py-3"><ScoreBadge score={o.trustScore} /></td>
                  <td className="px-4 py-3 text-gray-dark">
                    {o.lastContactedAt ? new Date(o.lastContactedAt).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
