'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface LeadRow {
  id: string;
  fullName: string | null;
  phoneE164: string;
  status: string;
  temperature: string;
  qualificationScore: number;
  property: { code: string; name: string } | null;
  postPackage: { id: string; title: string | null } | null;
}

export default function LeadsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['leads'],
    queryFn: () => api<LeadRow[]>('/leads'),
  });

  return (
    <div>
      <header className="mb-6">
        <h1>Leads</h1>
        <p className="mt-1 text-sm text-gray-medium">Inbound WhatsApp leads with attribution + qualification.</p>
      </header>

      <div className="overflow-hidden rounded-md border border-gray-light bg-white shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-offwhite text-xs uppercase tracking-wide text-gray-medium">
            <tr>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Temp</th>
              <th className="px-4 py-3">Score</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-medium">Loading…</td></tr>
            ) : !data?.length ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-medium">No leads yet.</td></tr>
            ) : (
              data.map((l) => (
                <tr key={l.id} className="border-t border-gray-light hover:bg-offwhite">
                  <td className="px-4 py-3 font-semibold">
                    <Link href={`/leads/${l.id}`} className="text-navy hover:underline">
                      {l.fullName ?? '(unnamed)'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{l.phoneE164}</td>
                  <td className="px-4 py-3 text-gray-dark">
                    {l.property ? `${l.property.code} — ${l.property.name}` : '—'}
                  </td>
                  <td className="px-4 py-3"><StatusPill status={l.status} /></td>
                  <td className="px-4 py-3"><StatusPill status={l.temperature} /></td>
                  <td className="px-4 py-3 font-semibold text-gray-dark">{l.qualificationScore}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
