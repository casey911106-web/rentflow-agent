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
  firstSeenAt: string;
  createdAt: string;
  property: { code: string; name: string } | null;
  postPackage: { id: string; title: string | null } | null;
}

function shortTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const ms = now - d.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `hace ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `hace ${days}d`;
  // For older leads, show absolute date (no time)
  return d.toLocaleDateString();
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

      {/* Mobile: card list */}
      <ul className="space-y-2 md:hidden">
        {isLoading ? (
          <li className="rounded-md border border-gray-light bg-white p-4 text-center text-sm text-gray-medium">Loading…</li>
        ) : !data?.length ? (
          <li className="rounded-md border border-gray-light bg-white p-4 text-center text-sm text-gray-medium">No leads yet.</li>
        ) : (
          data.map((l) => (
            <li key={l.id} className="rounded-md border border-gray-light bg-white shadow-card">
              <Link href={`/leads/${l.id}`} className="block p-3 hover:bg-offwhite">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-navy-deep">{l.fullName ?? '(unnamed)'}</span>
                  <span className="shrink-0 text-xs font-semibold text-gray-dark">{l.qualificationScore}</span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-gray-medium">{l.phoneE164}</p>
                {l.property ? (
                  <p className="mt-1 truncate text-xs text-gray-dark">
                    {l.property.code} — {l.property.name}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <StatusPill status={l.status} />
                  <StatusPill status={l.temperature} />
                  <span
                    className="ml-auto text-[11px] text-gray-medium"
                    title={new Date(l.firstSeenAt ?? l.createdAt).toLocaleString()}
                  >
                    {shortTimestamp(l.firstSeenAt ?? l.createdAt)}
                  </span>
                </div>
              </Link>
            </li>
          ))
        )}
      </ul>

      {/* Desktop / tablet: table */}
      <div className="hidden overflow-x-auto rounded-md border border-gray-light bg-white shadow-card md:block">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-offwhite text-xs uppercase tracking-wide text-gray-medium">
            <tr>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Temp</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">First contact</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-medium">Loading…</td></tr>
            ) : !data?.length ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-medium">No leads yet.</td></tr>
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
                  <td
                    className="px-4 py-3 text-xs text-gray-medium"
                    title={new Date(l.firstSeenAt ?? l.createdAt).toLocaleString()}
                  >
                    {shortTimestamp(l.firstSeenAt ?? l.createdAt)}
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
