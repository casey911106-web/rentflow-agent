'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface ViewingRow {
  id: string;
  status: string;
  scheduledAt: string;
  durationMinutes: number;
  property: { code: string; name: string };
  lead: { fullName: string | null; phoneE164: string };
  fieldAgent: { user: { fullName: string } } | null;
}

export default function ViewingsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['viewings'],
    queryFn: () => api<ViewingRow[]>('/viewings'),
  });

  return (
    <div>
      <header className="mb-6">
        <h1>Viewings</h1>
        <p className="mt-1 text-sm text-gray-medium">Scheduled viewings across all field agents.</p>
      </header>

      <div className="overflow-x-auto rounded-md border border-gray-light bg-white shadow-card">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-offwhite text-xs uppercase tracking-wide text-gray-medium">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Agent</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-medium">Loading…</td></tr>
            ) : !data?.length ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-medium">No viewings scheduled.</td></tr>
            ) : (
              data.map((v) => (
                <tr key={v.id} className="border-t border-gray-light hover:bg-offwhite">
                  <td className="px-4 py-3 text-gray-dark">{new Date(v.scheduledAt).toLocaleString()}</td>
                  <td className="px-4 py-3 font-semibold">
                    <Link href={`/viewings/${v.id}`} className="text-navy hover:underline">
                      {v.property.code} — {v.property.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-dark">{v.lead.fullName ?? v.lead.phoneE164}</td>
                  <td className="px-4 py-3 text-gray-dark">{v.fieldAgent?.user?.fullName ?? '— unassigned —'}</td>
                  <td className="px-4 py-3"><StatusPill status={v.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
