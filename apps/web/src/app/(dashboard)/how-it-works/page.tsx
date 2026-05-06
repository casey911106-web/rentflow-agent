'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';

interface SystemDoc {
  id: string;
  category: 'automation' | 'feature' | 'integration' | 'data-model';
  name: string;
  shortDescription: string;
  longDescription: string;
  schedule?: string;
  triggers?: string[];
  effects?: string[];
  configurables?: Array<{ key: string; default?: string; description?: string }>;
  rationale?: string;
  observability?: string[];
  sourceFiles?: string[];
  link?: string;
}

interface BuildInfo {
  version: string;
  bootedAt: string;
  nodeVersion: string;
  aiProvider: string;
  whatsappAdapter: string;
}

const TABS: Array<{ key: SystemDoc['category'] | 'all'; label: string; description: string }> = [
  { key: 'all',          label: 'All',          description: 'Everything the system does' },
  { key: 'automation',   label: 'Automations',  description: 'Cron jobs, parsers, runners that work without operator input' },
  { key: 'feature',      label: 'Features',     description: 'Operator-facing workflows' },
  { key: 'integration',  label: 'Integrations', description: 'External services we depend on' },
];

export default function HowItWorksPage() {
  const [tab, setTab] = useState<typeof TABS[number]['key']>('all');
  const [query, setQuery] = useState('');

  const { data: docs, isLoading } = useQuery({
    queryKey: ['system-docs', tab],
    queryFn: () =>
      api<SystemDoc[]>(`/system/docs${tab !== 'all' ? `?category=${tab}` : ''}`),
  });
  const { data: build } = useQuery({
    queryKey: ['build-info'],
    queryFn: () => api<BuildInfo>('/system/build-info'),
  });

  const filtered = !docs
    ? []
    : query
      ? docs.filter(
          (d) =>
            d.name.toLowerCase().includes(query.toLowerCase()) ||
            d.shortDescription.toLowerCase().includes(query.toLowerCase()) ||
            d.id.toLowerCase().includes(query.toLowerCase()),
        )
      : docs;

  return (
    <div>
      <header className="mb-6">
        <h1>How RentFlow Agent works</h1>
        <p className="mt-1 text-sm text-gray-medium">
          Living, code-backed documentation. Every entry below is wired to the actual implementation —
          when behavior changes, the description here changes too. Use this as your reference when
          something automates surprises you, or when onboarding new team members.
        </p>
      </header>

      {build ? (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-md border border-gray-light bg-white p-4 text-xs text-gray-medium shadow-card">
          <div>
            <span className="font-semibold text-gray-dark">Version:</span> {build.version}
          </div>
          <div>
            <span className="font-semibold text-gray-dark">Booted:</span>{' '}
            {new Date(build.bootedAt).toLocaleString()}
          </div>
          <div>
            <span className="font-semibold text-gray-dark">AI:</span> {build.aiProvider}
          </div>
          <div>
            <span className="font-semibold text-gray-dark">WhatsApp:</span> {build.whatsappAdapter}
          </div>
        </div>
      ) : null}

      <nav className="mb-4 flex gap-2 border-b border-gray-light">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                active ? 'border-teal text-navy-deep' : 'border-transparent text-gray-medium hover:text-gray-dark'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="mb-6 flex items-center gap-3">
        <input
          type="search"
          placeholder="Search by name or description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded-md border border-gray-light px-3 py-2 text-sm focus:border-teal focus:outline-none"
        />
        <span className="text-xs text-gray-medium">{filtered.length} entries</span>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-medium">Loading…</p>
      ) : (
        <div className="space-y-4">
          {filtered.map((doc) => (
            <DocCard key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocCard({ doc }: { doc: SystemDoc }) {
  const [expanded, setExpanded] = useState(false);
  const categoryColors: Record<SystemDoc['category'], string> = {
    automation: 'bg-teal-light text-navy-deep',
    feature: 'bg-emerald-50 text-emerald-800',
    integration: 'bg-amber-50 text-amber-800',
    'data-model': 'bg-slate-100 text-slate-700',
  };
  return (
    <article id={doc.id} className="rounded-md border border-gray-light bg-white p-5 shadow-card scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${categoryColors[doc.category]}`}
            >
              {doc.category}
            </span>
            {doc.schedule ? (
              <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-800">
                ⏱ {doc.schedule}
              </span>
            ) : null}
            {doc.link ? (
              <Link href={doc.link} className="text-xs font-semibold text-teal hover:underline">
                Open →
              </Link>
            ) : null}
          </div>
          <h2 className="text-lg font-bold text-navy-deep">{doc.name}</h2>
          <p className="mt-1 text-sm text-gray-dark">{doc.shortDescription}</p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="rounded-md border border-gray-light px-3 py-1.5 text-xs font-semibold text-gray-dark hover:bg-offwhite"
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      </div>

      {expanded ? (
        <div className="mt-4 space-y-4 border-t border-gray-light pt-4 text-sm">
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-medium">How it works</h3>
            <p className="whitespace-pre-wrap text-gray-dark">{doc.longDescription}</p>
          </div>

          {doc.rationale ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-medium">Why it exists</h3>
              <p className="text-gray-dark">{doc.rationale}</p>
            </div>
          ) : null}

          {doc.triggers && doc.triggers.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-medium">Triggers</h3>
              <ul className="list-inside list-disc space-y-0.5 text-gray-dark">
                {doc.triggers.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          ) : null}

          {doc.effects && doc.effects.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-medium">Effects</h3>
              <ul className="list-inside list-disc space-y-0.5 text-gray-dark">
                {doc.effects.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          ) : null}

          {doc.configurables && doc.configurables.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-medium">Configurable</h3>
              <ul className="space-y-1">
                {doc.configurables.map((c, i) => (
                  <li key={i} className="rounded-md bg-offwhite p-2 text-xs">
                    <span className="font-mono font-semibold text-gray-dark">{c.key}</span>
                    {c.default ? <span className="text-gray-medium"> (default: <code>{c.default}</code>)</span> : null}
                    {c.description ? <span className="text-gray-medium"> — {c.description}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {doc.observability && doc.observability.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-medium">Observability</h3>
              <ul className="list-inside list-disc space-y-0.5 text-gray-dark">
                {doc.observability.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
          ) : null}

          {doc.sourceFiles && doc.sourceFiles.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-medium">Source files</h3>
              <ul className="space-y-0.5">
                {doc.sourceFiles.map((f, i) => (
                  <li key={i} className="font-mono text-xs text-gray-medium">{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
