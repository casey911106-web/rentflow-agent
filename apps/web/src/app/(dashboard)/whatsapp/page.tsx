'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface ConversationRow {
  id: string;
  leadPhoneE164: string;
  mode: string;
  lastInboundAt: string | null;
  lead: { id: string; fullName: string | null; status: string; temperature: string } | null;
  _count: { messages: number };
}

export default function WhatsAppPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<ConversationRow[]>('/whatsapp/conversations'),
  });

  return (
    <div>
      <header className="mb-6">
        <h1>WhatsApp console</h1>
        <p className="mt-1 text-sm text-gray-medium">All inbound conversations. Click to take over manually.</p>
      </header>

      <div className="overflow-x-auto rounded-md border border-gray-light bg-white shadow-card">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-offwhite text-xs uppercase tracking-wide text-gray-medium">
            <tr>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Messages</th>
              <th className="px-4 py-3">Last inbound</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-medium">Loading…</td></tr>
            ) : !data?.length ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-medium">No conversations yet.</td></tr>
            ) : (
              data.map((c) => (
                <tr key={c.id} className="border-t border-gray-light hover:bg-offwhite">
                  <td className="px-4 py-3 font-semibold">
                    {c.lead ? (
                      <Link href={`/leads/${c.lead.id}`} className="text-navy hover:underline">
                        {c.lead.fullName ?? '(unnamed)'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{c.leadPhoneE164}</td>
                  <td className="px-4 py-3"><StatusPill status={c.mode} /></td>
                  <td className="px-4 py-3">{c.lead ? <StatusPill status={c.lead.status} /> : '—'}</td>
                  <td className="px-4 py-3 text-gray-dark">{c._count.messages}</td>
                  <td className="px-4 py-3 text-gray-dark">
                    {c.lastInboundAt ? new Date(c.lastInboundAt).toLocaleString() : '—'}
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
