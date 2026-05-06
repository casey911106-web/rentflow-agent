'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface PostPackageRow {
  id: string;
  status: string;
  title: string | null;
  publishedAt: string | null;
  channelName: string | null;
  property: { code: string; name: string };
  trackingLink: { sourceCode: string; postCode: string; whatsappUrl: string; clicks: number } | null;
  _count: { leads: number };
}

const TABS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: 'all',       label: 'All',       statuses: [] },
  { key: 'draft',     label: 'Draft',     statuses: ['draft', 'generated'] },
  { key: 'review',    label: 'Review',    statuses: ['pending_approval', 'approved'] },
  { key: 'published', label: 'Published', statuses: ['published'] },
  { key: 'paused',    label: 'Paused',    statuses: ['paused', 'archived', 'failed'] },
];

export default function PostingPage() {
  const [tab, setTab] = useState('all');
  const { data, isLoading } = useQuery({
    queryKey: ['post-packages'],
    queryFn: () => api<PostPackageRow[]>('/post-packages'),
  });

  const filtered = !data
    ? []
    : tab === 'all'
      ? data
      : data.filter((p) => TABS.find((t) => t.key === tab)?.statuses.includes(p.status));

  return (
    <div>
      <header className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1>Fast Posting Studio</h1>
          <p className="mt-1 text-sm text-gray-medium">
            Generate post packages with tracking links. Publish manually; mark as published when done.
          </p>
        </div>
        <Link
          href="/posting/new"
          className="inline-flex items-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#008C8A]"
        >
          + Generate package
        </Link>
      </header>

      <nav className="mb-6 flex gap-2 border-b border-gray-light">
        {TABS.map((t) => {
          const count =
            t.key === 'all'
              ? data?.length ?? 0
              : data?.filter((p) => t.statuses.includes(p.status)).length ?? 0;
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
              <span className="ml-2 rounded-full bg-offwhite px-2 py-0.5 text-xs">{count}</span>
            </button>
          );
        })}
      </nav>

      {isLoading ? (
        <p className="text-sm text-gray-medium">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-light bg-white p-12 text-center">
          <p className="text-sm text-gray-medium">No post packages in this view.</p>
          {tab === 'all' ? (
            <Link
              href="/posting/new"
              className="mt-3 inline-block text-sm font-semibold text-teal hover:underline"
            >
              Generate your first package →
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((pkg) => (
            <Link
              key={pkg.id}
              href={`/posting/${pkg.id}`}
              className="block rounded-md border border-gray-light bg-white p-5 shadow-card transition-all hover:border-teal hover:shadow-md"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-xs text-gray-medium">{pkg.property.code}</span>
                <StatusPill status={pkg.status} />
              </div>
              <h3 className="text-base font-semibold">{pkg.title ?? pkg.property.name}</h3>
              <p className="mt-1 text-xs text-gray-medium">
                {pkg.channelName ?? '— not yet published —'}
                {pkg.publishedAt ? ` · ${new Date(pkg.publishedAt).toLocaleDateString()}` : ''}
              </p>
              {pkg.trackingLink ? (
                <div className="mt-3 rounded-md bg-offwhite p-3 text-xs">
                  <p className="font-mono text-gray-dark">
                    <span className="text-gray-medium">Source:</span> {pkg.trackingLink.sourceCode}{' '}
                    <span className="text-gray-medium">Post:</span> {pkg.trackingLink.postCode}
                  </p>
                  <p className="mt-1 text-gray-medium">
                    Clicks: <span className="font-semibold text-near-black">{pkg.trackingLink.clicks}</span> ·
                    Leads: <span className="font-semibold text-near-black">{pkg._count.leads}</span>
                  </p>
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
