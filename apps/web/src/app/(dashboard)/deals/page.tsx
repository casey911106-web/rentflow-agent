'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface DealRow {
  id: string;
  status: string;
  rentAmount: string | null;
  commissionAmount: string | null;
  closedAt: string | null;
  lead: { fullName: string | null; phoneE164: string };
  property: { code: string; name: string };
  commission: { status: string; collectedAmount: string } | null;
}

export default function DealsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['deals'],
    queryFn: () => api<DealRow[]>('/deals'),
  });

  return (
    <div>
      <header className="mb-6">
        <h1>Deals</h1>
        <p className="mt-1 text-sm text-gray-medium">Closed and in-progress deals with commission status.</p>
      </header>

      <div className="overflow-hidden rounded-md border border-gray-light bg-white shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-offwhite text-xs uppercase tracking-wide text-gray-medium">
            <tr>
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Rent</th>
              <th className="px-4 py-3">Commission</th>
              <th className="px-4 py-3">Collected</th>
              <th className="px-4 py-3">Closed</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-medium">Loading…</td></tr>
            ) : !data?.length ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-medium">No deals yet.</td></tr>
            ) : (
              data.map((d) => (
                <tr key={d.id} className="border-t border-gray-light hover:bg-offwhite">
                  <td className="px-4 py-3 font-semibold">
                    <Link href={`/deals/${d.id}`} className="text-navy hover:underline">
                      {d.property.code} — {d.property.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-dark">{d.lead.fullName ?? d.lead.phoneE164}</td>
                  <td className="px-4 py-3"><StatusPill status={d.status} /></td>
                  <td className="px-4 py-3 text-gray-dark">{d.rentAmount ? `AED ${Number(d.rentAmount).toLocaleString()}` : '—'}</td>
                  <td className="px-4 py-3 text-gray-dark">{d.commissionAmount ? `AED ${Number(d.commissionAmount).toLocaleString()}` : '—'}</td>
                  <td className="px-4 py-3 text-gray-dark">{d.commission ? `AED ${Number(d.commission.collectedAmount).toLocaleString()}` : '—'}</td>
                  <td className="px-4 py-3 text-gray-dark">{d.closedAt ? new Date(d.closedAt).toLocaleDateString() : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
