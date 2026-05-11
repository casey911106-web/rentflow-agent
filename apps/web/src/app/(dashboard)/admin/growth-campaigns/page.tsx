'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface GrowthCampaign {
  id: string;
  title: string | null;
  shortCaption: string | null;
  growthTargetUrl: string | null;
  growthTargetLabel: string | null;
  growthTargetKind: string | null;
  status: string;
  createdAt: string;
  trackingLink: { shortUrl: string; postCode: string; clicks: number } | null;
  _count: { placements: number; assignments: number };
}

const TARGET_KINDS = [
  { value: 'telegram', label: 'Telegram channel' },
  { value: 'facebook_page', label: 'Facebook page' },
  { value: 'instagram', label: 'Instagram profile' },
  { value: 'whatsapp_community', label: 'WhatsApp community' },
  { value: 'other', label: 'Other' },
];

export default function GrowthCampaignsPage() {
  const [rows, setRows] = useState<GrowthCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api<GrowthCampaign[]>('/admin/growth-campaigns');
      setRows(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function archive(id: string) {
    if (!confirm('Pull this campaign out of the round-robin pool?')) return;
    try {
      await api(`/admin/growth-campaigns/${id}/archive`, { method: 'POST' });
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy-deep">Channel growth campaigns</h1>
          <p className="text-sm text-gray-medium">
            Promo posts that field agents publish in FB/WA groups to drive followers to our owned Telegram channel, FB page, IG profile, etc. Same round-robin pool as property listings.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal/90"
        >
          + New campaign
        </button>
      </header>

      {showForm ? <CreateForm onClose={() => setShowForm(false)} onCreated={load} /> : null}

      {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-danger">{error}</p> : null}
      {loading ? <p className="text-sm text-gray-medium">Loading…</p> : null}

      <div className="overflow-hidden rounded-md border border-gray-light bg-white">
        <table className="w-full text-sm">
          <thead className="bg-offwhite text-left text-xs uppercase tracking-wide text-gray-medium">
            <tr>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3 text-right">Placements</th>
              <th className="px-4 py-3 text-right">Clicks</th>
              <th className="px-4 py-3">Tracking link</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-light align-top">
                <td className="px-4 py-3">
                  <p className="font-semibold text-navy-deep">{r.title ?? '—'}</p>
                  <p className="mt-1 line-clamp-2 max-w-md text-xs text-gray-medium">{r.shortCaption}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-navy-deep">{r.growthTargetLabel ?? '—'}</p>
                  <p className="text-xs text-gray-medium">{r.growthTargetKind ?? '—'}</p>
                  {r.growthTargetUrl ? (
                    <a href={r.growthTargetUrl} target="_blank" rel="noreferrer" className="text-xs text-teal underline">
                      open
                    </a>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right font-semibold">{r._count.placements.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-semibold">{r.trackingLink?.clicks?.toLocaleString() ?? '0'}</td>
                <td className="px-4 py-3">
                  {r.trackingLink ? (
                    <code className="rounded bg-offwhite px-2 py-1 text-[11px]">{r.trackingLink.shortUrl}</code>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => archive(r.id)}
                    className="rounded-md border border-gray-light px-3 py-1 text-xs hover:bg-offwhite"
                  >
                    Archive
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-gray-medium" colSpan={6}>
                  No active growth campaigns. Click <span className="font-semibold">New campaign</span> to create one.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [targetLabel, setTargetLabel] = useState('');
  const [targetKind, setTargetKind] = useState<string>('telegram');
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateCaption(differentAngle?: string) {
    if (!targetLabel.trim()) {
      setError('Fill the channel name first so the AI knows what to promote.');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await api<{ caption: string; modelId: string }>(
        '/admin/growth-campaigns/draft-caption',
        {
          method: 'POST',
          body: JSON.stringify({ targetKind, targetLabel, ...(differentAngle ? { differentAngle } : {}) }),
        },
      );
      setCaption(res.caption);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api('/admin/growth-campaigns', {
        method: 'POST',
        body: JSON.stringify({ title, caption, targetUrl, targetLabel, targetKind }),
      });
      onCreated();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-gray-light bg-white p-4 shadow-card">
      <div className="flex items-start justify-between">
        <h2 className="font-semibold text-navy-deep">New channel-growth campaign</h2>
        <button type="button" onClick={onClose} className="text-xs text-gray-medium hover:underline">
          Cancel
        </button>
      </div>

      <Field label="Internal title" hint="Short — agents see this on their task list">
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Grow Telegram — May 2026"
          className="w-full rounded-md border border-gray-light px-3 py-2 text-sm"
        />
      </Field>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-medium">Caption to publish</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => generateCaption()}
              disabled={generating}
              className="rounded-md border border-teal/40 bg-teal/10 px-2 py-1 text-xs font-semibold text-teal hover:bg-teal/20 disabled:opacity-60"
            >
              {generating ? 'Generating…' : caption ? '🎲 Otro ángulo' : '✨ Generate with AI'}
            </button>
            {caption ? (
              <button
                type="button"
                onClick={() => {
                  const hint = window.prompt('¿Qué cambiar? ej: "más urgente", "menos pregunta", "tono insider"');
                  if (hint) generateCaption(hint);
                }}
                disabled={generating}
                className="rounded-md border border-gray-light bg-white px-2 py-1 text-xs font-semibold text-gray-dark hover:bg-offwhite disabled:opacity-60"
              >
                ✎ Con hint
              </button>
            ) : null}
          </div>
        </div>
        <textarea
          required
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={6}
          placeholder={'🏠 Find your next room in Dubai\nDaily new listings in our Telegram\n👉 Únete'}
          className="w-full rounded-md border border-gray-light px-3 py-2 text-sm font-mono"
        />
        <p className="mt-1 text-xs text-gray-medium">
          Exact text agents will paste in FB/WA groups. The unique tracking link gets appended automatically per placement — don&apos;t put a URL here.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Target kind">
          <select
            value={targetKind}
            onChange={(e) => setTargetKind(e.target.value)}
            className="w-full rounded-md border border-gray-light px-3 py-2 text-sm"
          >
            {TARGET_KINDS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Target label" hint="Shown in mobile + leaderboard">
          <input
            required
            value={targetLabel}
            onChange={(e) => setTargetLabel(e.target.value)}
            placeholder="Telegram — RentFlow Dubai"
            className="w-full rounded-md border border-gray-light px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <Field label="Target URL" hint="Where the tracking link redirects when someone clicks.">
        <input
          required
          type="url"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://t.me/rentflow_dubai"
          className="w-full rounded-md border border-gray-light px-3 py-2 text-sm"
        />
      </Field>

      {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-danger">{error}</p> : null}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-light px-4 py-2 text-sm"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal/90 disabled:opacity-60"
        >
          {submitting ? 'Creating…' : 'Create campaign'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-gray-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-gray-medium">{hint}</span> : null}
    </label>
  );
}
