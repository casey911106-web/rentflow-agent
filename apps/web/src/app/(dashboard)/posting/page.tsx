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
  _count: { leads: number; placements: number };
  pendingAssignmentsCount: number;
}

// Statuses that the round-robin scheduler picks up. Matches
// ACTIVE_PACKAGE_STATUSES in apps/api/src/modules/placements/placements.scheduler.ts.
// Anything in this set is "in daily posting rotation" — publishers can be
// assigned the package and scheduled to post it on FB/WA groups.
const IN_ROTATION_STATUSES = new Set([
  'generated',
  'scheduled',
  'pending_approval',
  'approved',
  'published',
]);

function isInRotation(status: string): boolean {
  return IN_ROTATION_STATUSES.has(status);
}

const TABS: Array<{ key: string; label: string; statuses: string[]; help?: string }> = [
  {
    key: 'active',
    label: 'In rotation',
    statuses: ['generated', 'scheduled', 'pending_approval', 'approved', 'published'],
    help: 'Packages publishers can be assigned to right now (round-robin every 30 min)',
  },
  {
    key: 'draft',
    label: 'Drafts',
    statuses: ['draft'],
    help: 'Built but not yet entered the rotation pool',
  },
  {
    key: 'paused',
    label: 'Paused / archived',
    statuses: ['paused', 'archived', 'failed'],
    help: 'Out of rotation — no new tasks generated for these',
  },
  { key: 'all', label: 'All', statuses: [] },
];

export default function PostingPage() {
  const [tab, setTab] = useState('active');
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
            Generate post packages with tracking links. The round-robin scheduler picks ones in rotation every 30 min and assigns them to publishers (mobile app).
          </p>
        </div>
        <Link
          href="/posting/new"
          className="inline-flex items-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#008C8A]"
        >
          + Generate package
        </Link>
      </header>

      {/* Operational summary at the top — most important question is
          "what's actually being posted right now?". */}
      <RotationSummary data={data ?? []} />

      <nav className="mb-2 flex flex-wrap gap-2 border-b border-gray-light">
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
      {/* Tab help text — explains what each filter actually means. */}
      {(() => {
        const help = TABS.find((t) => t.key === tab)?.help;
        return help ? <p className="mb-4 text-xs text-gray-medium">{help}</p> : <div className="mb-4" />;
      })()}

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
          {filtered.map((pkg) => {
            const inRotation = isInRotation(pkg.status);
            return (
              <Link
                key={pkg.id}
                href={`/posting/${pkg.id}`}
                className={`block rounded-md border bg-white p-5 shadow-card transition-all hover:border-teal hover:shadow-md ${
                  inRotation ? 'border-l-4 border-l-teal border-gray-light' : 'border-gray-light opacity-90'
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-gray-medium">{pkg.property.code}</span>
                  <StatusPill status={pkg.status} />
                </div>

                {/* Big plain-language indicator: is this thing being posted right now or not. */}
                {inRotation ? (
                  <p className="mb-2 text-xs font-semibold text-teal">
                    🟢 In rotation
                    {pkg.pendingAssignmentsCount > 0
                      ? ` · ${pkg.pendingAssignmentsCount} publisher${pkg.pendingAssignmentsCount === 1 ? '' : 's'} working on it now`
                      : ' · waiting for next round-robin tick'}
                  </p>
                ) : (
                  <p className="mb-2 text-xs font-semibold text-gray-medium">
                    ⏸ Out of rotation
                    {pkg.status === 'draft' ? ' · still a draft' : null}
                    {pkg.status === 'paused' ? ' · paused' : null}
                    {pkg.status === 'archived' ? ' · archived' : null}
                    {pkg.status === 'failed' ? ' · failed' : null}
                  </p>
                )}

                <h3 className="text-base font-semibold">{pkg.title ?? pkg.property.name}</h3>
                <p className="mt-1 text-xs text-gray-medium">
                  {pkg.channelName ?? '— not yet published —'}
                  {pkg.publishedAt ? ` · ${new Date(pkg.publishedAt).toLocaleDateString()}` : ''}
                </p>
                {pkg.trackingLink ? (
                  <div className="mt-3 rounded-md bg-offwhite p-3 text-xs">
                    <p className="text-gray-medium">
                      Placements: <span className="font-semibold text-near-black">{pkg._count.placements}</span> ·
                      Clicks: <span className="font-semibold text-near-black">{pkg.trackingLink.clicks}</span> ·
                      Leads: <span className="font-semibold text-near-black">{pkg._count.leads}</span>
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-gray-medium">
                      {pkg.trackingLink.sourceCode} / {pkg.trackingLink.postCode}
                    </p>
                  </div>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RotationSummary({ data }: { data: PostPackageRow[] }) {
  if (data.length === 0) return null;
  const inRotation = data.filter((p) => isInRotation(p.status));
  const drafts = data.filter((p) => p.status === 'draft');
  const paused = data.filter((p) => ['paused', 'archived', 'failed'].includes(p.status));
  const activelyWorked = inRotation.filter((p) => p.pendingAssignmentsCount > 0).length;
  const totalPendingAssignments = inRotation.reduce((s, p) => s + p.pendingAssignmentsCount, 0);

  return (
    <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className="rounded-md border border-l-4 border-l-teal bg-white p-4 shadow-card">
        <p className="text-xs uppercase tracking-wide text-gray-medium">In rotation</p>
        <p className="mt-1 text-2xl font-bold text-navy-deep">{inRotation.length}</p>
        <p className="mt-1 text-xs text-gray-medium">
          {activelyWorked > 0
            ? `${activelyWorked} actively being worked on (${totalPendingAssignments} pending assignment${totalPendingAssignments === 1 ? '' : 's'})`
            : 'Waiting for next 30-min round-robin tick'}
        </p>
      </div>
      <div className="rounded-md border bg-white p-4 shadow-card">
        <p className="text-xs uppercase tracking-wide text-gray-medium">Drafts</p>
        <p className="mt-1 text-2xl font-bold text-navy-deep">{drafts.length}</p>
        <p className="mt-1 text-xs text-gray-medium">Generated but not yet entered the rotation pool</p>
      </div>
      <div className="rounded-md border bg-white p-4 shadow-card">
        <p className="text-xs uppercase tracking-wide text-gray-medium">Paused / archived</p>
        <p className="mt-1 text-2xl font-bold text-navy-deep">{paused.length}</p>
        <p className="mt-1 text-xs text-gray-medium">Out of rotation — no new tasks generated</p>
      </div>
    </div>
  );
}
