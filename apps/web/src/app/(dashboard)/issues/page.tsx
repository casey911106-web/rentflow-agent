'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';

interface Issue {
  id: string;
  type: string;
  description: string;
  resolvedAt: string | null;
  createdAt: string;
  property: { id: string; code: string; name: string; area: string | null };
}

const TABS = [
  { key: 'open',     label: 'Open',     resolvedFilter: 'false' as const },
  { key: 'resolved', label: 'Resolved', resolvedFilter: 'true' as const },
  { key: 'all',      label: 'All',      resolvedFilter: undefined  },
];

const TYPE_TONE: Record<string, string> = {
  unavailable_when_expected: 'bg-red-50 text-red-800',
  dirty:                     'bg-amber-50 text-amber-800',
  access_problem:            'bg-red-50 text-red-800',
  price_changed:             'bg-violet-50 text-violet-800',
  owner_not_responding:      'bg-amber-50 text-amber-800',
  wrong_media:               'bg-slate-100 text-slate-700',
  client_complaint:          'bg-red-50 text-red-800',
  maintenance_issue:         'bg-amber-50 text-amber-800',
  other:                     'bg-slate-100 text-slate-700',
};

export default function IssuesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<typeof TABS[number]['key']>('open');
  const tabSpec = TABS.find((t) => t.key === tab)!;

  const { data, isLoading } = useQuery({
    queryKey: ['property-issues', tabSpec.resolvedFilter],
    queryFn: () =>
      api<Issue[]>(
        `/properties/issues${tabSpec.resolvedFilter ? `?resolved=${tabSpec.resolvedFilter}` : ''}`,
      ),
  });

  const resolve = useMutation({
    mutationFn: (issueId: string) =>
      api(`/properties/issues/${issueId}/resolve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['property-issues'] }),
  });

  return (
    <div>
      <header className="mb-6">
        <h1>Property issues</h1>
        <p className="mt-1 text-sm text-gray-medium">
          Reports from field agents and operators across all inventory.
        </p>
      </header>

      <nav className="mb-6 flex gap-2 border-b border-gray-light">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                active
                  ? 'border-teal text-navy-deep'
                  : 'border-transparent text-gray-medium hover:text-gray-dark'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {isLoading ? (
        <p className="text-sm text-gray-medium">Loading…</p>
      ) : !data?.length ? (
        <div className="rounded-md border border-dashed border-gray-light bg-white p-12 text-center">
          <p className="text-sm text-gray-medium">
            {tab === 'open' ? '🎉 No open issues — inventory is clean.' : 'No issues in this view.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((i) => {
            const typeClass = TYPE_TONE[i.type] ?? 'bg-slate-100 text-slate-700';
            return (
              <article
                key={i.id}
                className="rounded-md border border-gray-light bg-white p-5 shadow-card"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${typeClass}`}
                      >
                        {i.type.replace(/_/g, ' ')}
                      </span>
                      {i.resolvedAt ? (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                          ✓ resolved
                        </span>
                      ) : (
                        <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                          open
                        </span>
                      )}
                      <span className="text-xs text-gray-medium">
                        {new Date(i.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <Link
                      href={`/properties/${i.property.id}`}
                      className="block text-base font-semibold text-navy-deep hover:underline"
                    >
                      {i.property.code} — {i.property.name}
                    </Link>
                    <p className="text-xs text-gray-medium">{i.property.area ?? '—'}</p>
                    <p className="mt-3 text-sm text-gray-dark">{i.description}</p>
                  </div>
                  {!i.resolvedAt ? (
                    <button
                      onClick={() => resolve.mutate(i.id)}
                      disabled={resolve.isPending}
                      className="rounded-md bg-success px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {resolve.isPending ? 'Saving…' : 'Mark resolved'}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
