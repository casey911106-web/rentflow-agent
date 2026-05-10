'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ScoreBadge, StatusPill } from '@rentflow/ui';
import { AuthedImage } from '@/components/AuthedImage';
import { api } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function downloadFile(fileId: string, filename: string) {
  const token = window.localStorage.getItem('rentflow_token');
  const res = await fetch(`${API_BASE}/files/${fileId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface PostPackageDetail {
  id: string;
  status: string;
  title: string | null;
  shortCaption: string | null;
  longCaption: string | null;
  whatsappCaption: string | null;
  facebookCaption: string | null;
  priceLine: string | null;
  availabilityLine: string | null;
  features: string[] | null;
  channelName: string | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  approvedAt: string | null;
  publishedBy: { fullName: string } | null;
  approvedBy: { fullName: string } | null;
  property: {
    id: string;
    code: string;
    name: string;
    area: string | null;
    priceAed: string | null;
    type: string;
    status: string;
    readinessScore: number;
    qualityScore: number;
    description: string | null;
    media: Array<{
      id: string;
      kind: string;
      caption: string | null;
      file: { id: string; mimeType: string; originalName: string | null };
    }>;
  };
  channel: { id: string; name: string; platform: string; kind: string } | null;
  trackingLink: {
    sourceCode: string;
    postCode: string;
    shortUrl: string;
    whatsappUrl: string;
    clicks: number;
  } | null;
}

type EditableField =
  | 'title'
  | 'shortCaption'
  | 'longCaption'
  | 'whatsappCaption'
  | 'facebookCaption';

interface EditableState {
  title: string;
  shortCaption: string;
  longCaption: string;
  whatsappCaption: string;
  facebookCaption: string;
}

function emptyEditable(): EditableState {
  return {
    title: '',
    shortCaption: '',
    longCaption: '',
    whatsappCaption: '',
    facebookCaption: '',
  };
}

function fromPackage(pkg: PostPackageDetail): EditableState {
  return {
    title: pkg.title ?? '',
    shortCaption: pkg.shortCaption ?? '',
    longCaption: pkg.longCaption ?? '',
    whatsappCaption: pkg.whatsappCaption ?? '',
    facebookCaption: pkg.facebookCaption ?? '',
  };
}

export default function PostPackageDetailPage({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const { data: pkg, isLoading, error } = useQuery({
    queryKey: ['post-packages', params.id],
    queryFn: () => api<PostPackageDetail>(`/post-packages/${params.id}`),
  });

  const [editable, setEditable] = useState<EditableState>(emptyEditable());
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [channelName, setChannelName] = useState('');
  const [publishedUrl, setPublishedUrl] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (pkg) {
      setEditable(fromPackage(pkg));
      setDirty(false);
    }
  }, [pkg]);

  const save = useMutation({
    mutationFn: (state: EditableState) =>
      api<PostPackageDetail>(`/post-packages/${params.id}`, {
        method: 'PATCH',
        body: JSON.stringify(state),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['post-packages'] }),
    onError: (err) => setActionError((err as Error).message),
  });

  const approve = useMutation({
    mutationFn: () =>
      api(`/post-packages/${params.id}/approve`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['post-packages'] });
      setActionError(null);
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const markPublished = useMutation({
    mutationFn: () =>
      api(`/post-packages/${params.id}/mark-published`, {
        method: 'POST',
        body: JSON.stringify({
          channelName: channelName || undefined,
          url: publishedUrl || undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['post-packages'] });
      setChannelName('');
      setPublishedUrl('');
      setActionError(null);
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const pause = useMutation({
    mutationFn: () => api(`/post-packages/${params.id}/pause`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['post-packages'] }),
    onError: (err) => setActionError((err as Error).message),
  });

  function setField(key: EditableField, value: string) {
    setEditable((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function copyToClipboard(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  if (isLoading) return <p className="text-sm text-gray-medium">Loading…</p>;
  if (error) return <p className="text-sm text-danger">Failed to load: {(error as Error).message}</p>;
  if (!pkg) return null;

  return (
    <div>
      <Link href="/posting" className="text-sm text-gray-medium hover:text-navy-deep">
        ← Back to Posting Studio
      </Link>

      <header className="mb-6 mt-3 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-gray-medium">{pkg.property.code}</span>
            <StatusPill status={pkg.status} />
          </div>
          <h1 className="mt-1">{editable.title || pkg.property.name}</h1>
        </div>
        {dirty ? (
          <button
            onClick={() => save.mutate(editable)}
            disabled={save.isPending}
            className="rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        ) : null}
      </header>

      {actionError ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* LEFT — property */}
        <aside className="xl:col-span-3">
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Property</h3>
            <p className="font-semibold">{pkg.property.name}</p>
            <p className="mt-0.5 text-xs text-gray-medium">
              {pkg.property.type.replace(/_/g, ' ')} · {pkg.property.area ?? '—'}
            </p>
            <p className="mt-3 text-2xl font-bold text-navy-deep">
              {pkg.property.priceAed ? `AED ${Number(pkg.property.priceAed).toLocaleString()}` : '—'}
              <span className="text-sm font-normal text-gray-medium"> / month</span>
            </p>

            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-medium">Status</span>
                <StatusPill status={pkg.property.status} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-medium">Readiness</span>
                <ScoreBadge score={pkg.property.readinessScore} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-medium">Quality</span>
                <ScoreBadge score={pkg.property.qualityScore} />
              </div>
            </div>

            {pkg.property.description ? (
              <p className="mt-4 border-t border-gray-light pt-3 text-xs text-gray-dark">
                {pkg.property.description}
              </p>
            ) : null}

            <Link
              href={`/properties/${pkg.property.id}`}
              className="mt-4 inline-block text-xs font-semibold text-teal hover:underline"
            >
              Open property →
            </Link>
          </div>

          {/* MEDIA — photos & videos for agents to download/post */}
          <div className="mt-4 rounded-md bg-white p-4 shadow-card">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-medium">
                Media ({pkg.property.media.length})
              </p>
              {pkg.property.media.length > 0 ? (
                <button
                  onClick={() => {
                    pkg.property.media.forEach((m, i) => {
                      const ext = m.file.mimeType.split('/')[1] || 'bin';
                      const filename = m.file.originalName || `${pkg.property.code}-${i + 1}.${ext}`;
                      setTimeout(() => downloadFile(m.file.id, filename), i * 200);
                    });
                  }}
                  className="text-xs font-semibold text-teal hover:underline"
                >
                  Download all
                </button>
              ) : null}
            </div>
            {pkg.property.media.length === 0 ? (
              <p className="text-xs text-gray-medium">
                No media uploaded yet.{' '}
                <Link
                  href={`/properties/${pkg.property.id}`}
                  className="font-semibold text-teal hover:underline"
                >
                  Upload from property page
                </Link>
                .
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {pkg.property.media.map((m, i) => {
                  const isVideo = m.file.mimeType.startsWith('video/');
                  const ext = m.file.mimeType.split('/')[1] || 'bin';
                  const filename = m.file.originalName || `${pkg.property.code}-${i + 1}.${ext}`;
                  return (
                    <div key={m.id} className="group relative">
                      {isVideo ? (
                        <div className="flex aspect-square items-center justify-center rounded-md bg-navy-deep text-white">
                          <span className="text-xs">▶ video</span>
                        </div>
                      ) : (
                        <AuthedImage
                          fileId={m.file.id}
                          alt={m.caption ?? ''}
                          className="aspect-square w-full rounded-md object-cover"
                        />
                      )}
                      <button
                        onClick={() => downloadFile(m.file.id, filename)}
                        className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        ↓ Download
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* CENTER — captions */}
        <section className="xl:col-span-6">
          <div className="space-y-4">
            <CaptionEditor
              label="Title"
              value={editable.title}
              onChange={(v) => setField('title', v)}
              onCopy={() => copyToClipboard(editable.title, 'Title')}
              copied={copied === 'Title'}
              rows={1}
            />
            <CaptionEditor
              label="Short caption"
              hint="Under ~80 chars. For tight feeds."
              value={editable.shortCaption}
              onChange={(v) => setField('shortCaption', v)}
              onCopy={() => copyToClipboard(editable.shortCaption, 'Short')}
              copied={copied === 'Short'}
              rows={2}
            />
            <CaptionEditor
              label="Long caption"
              hint="Hero copy with details and CTA."
              value={editable.longCaption}
              onChange={(v) => setField('longCaption', v)}
              onCopy={() => copyToClipboard(editable.longCaption, 'Long')}
              copied={copied === 'Long'}
              rows={5}
            />
            <CaptionEditor
              label="WhatsApp groups caption"
              hint="Optimized for WA groups — emojis, short lines."
              value={editable.whatsappCaption}
              onChange={(v) => setField('whatsappCaption', v)}
              onCopy={() => copyToClipboard(editable.whatsappCaption, 'WhatsApp')}
              copied={copied === 'WhatsApp'}
              rows={5}
            />
            <CaptionEditor
              label="Facebook groups caption"
              hint="Optimized for FB groups — includes click-to-chat URL."
              value={editable.facebookCaption}
              onChange={(v) => setField('facebookCaption', v)}
              onCopy={() => copyToClipboard(editable.facebookCaption, 'Facebook')}
              copied={copied === 'Facebook'}
              rows={5}
            />
          </div>
        </section>

        {/* RIGHT — tracking + actions */}
        <aside className="space-y-4 xl:col-span-3">
          {/* Tracking */}
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Tracking</h3>
            {pkg.trackingLink ? (
              <>
                <dl className="space-y-2 text-xs">
                  <div>
                    <dt className="text-gray-medium">Source code</dt>
                    <dd className="font-mono font-semibold">{pkg.trackingLink.sourceCode}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-medium">Post code</dt>
                    <dd className="font-mono font-semibold">{pkg.trackingLink.postCode}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-medium">Clicks</dt>
                    <dd className="font-semibold">{pkg.trackingLink.clicks}</dd>
                  </div>
                </dl>
                <div className="mt-4 space-y-2">
                  <button
                    onClick={() =>
                      copyToClipboard(pkg.trackingLink!.whatsappUrl, 'wa-link')
                    }
                    className="w-full rounded-md border border-gray-light bg-offwhite px-3 py-2 text-xs font-semibold text-navy-deep hover:bg-teal-light"
                  >
                    {copied === 'wa-link' ? '✓ Copied' : 'Copy WhatsApp link'}
                  </button>
                  <a
                    href={pkg.trackingLink.whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full rounded-md border border-gray-light px-3 py-2 text-center text-xs font-semibold text-teal hover:underline"
                  >
                    Open click-to-chat ↗
                  </a>
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-medium">No tracking link.</p>
            )}
          </div>

          {/* Workflow actions */}
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Workflow</h3>

            {(pkg.status === 'draft' || pkg.status === 'generated') && (
              <button
                onClick={() => approve.mutate()}
                disabled={approve.isPending}
                className="w-full rounded-md bg-secondary px-3 py-2.5 text-sm font-semibold text-white hover:bg-navy-deep disabled:opacity-50"
              >
                {approve.isPending ? 'Approving…' : 'Approve for publishing'}
              </button>
            )}

            {pkg.status === 'approved' && (
              <p className="mb-3 rounded-md bg-teal-light p-2.5 text-xs text-navy-deep">
                ✓ Approved by {pkg.approvedBy?.fullName ?? '—'}{' '}
                {pkg.approvedAt ? `· ${new Date(pkg.approvedAt).toLocaleDateString()}` : ''}
                <br />
                Now copy the captions and publish manually, then mark it below.
              </p>
            )}

            {(pkg.status === 'approved' || pkg.status === 'generated' || pkg.status === 'draft') && (
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-semibold text-gray-dark">Channel name</label>
                <input
                  type="text"
                  placeholder="e.g. Dubai Rooms FB Group"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  className="w-full rounded-md border border-gray-light px-3 py-2 text-xs focus:border-teal focus:outline-none"
                />
                <label className="block text-xs font-semibold text-gray-dark">Published URL (optional)</label>
                <input
                  type="url"
                  placeholder="https://facebook.com/groups/…"
                  value={publishedUrl}
                  onChange={(e) => setPublishedUrl(e.target.value)}
                  className="w-full rounded-md border border-gray-light px-3 py-2 text-xs focus:border-teal focus:outline-none"
                />
                <button
                  onClick={() => markPublished.mutate()}
                  disabled={markPublished.isPending || !channelName}
                  className="mt-2 w-full rounded-md bg-teal px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
                >
                  {markPublished.isPending ? 'Saving…' : 'Mark as published'}
                </button>
              </div>
            )}

            {pkg.status === 'published' && (
              <>
                <p className="mb-3 rounded-md bg-emerald-50 p-2.5 text-xs text-emerald-800">
                  ✓ Published in <strong>{pkg.channelName}</strong> by{' '}
                  {pkg.publishedBy?.fullName ?? '—'}{' '}
                  {pkg.publishedAt ? `· ${new Date(pkg.publishedAt).toLocaleDateString()}` : ''}
                </p>
                {pkg.publishedUrl ? (
                  <a
                    href={pkg.publishedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-3 block text-xs font-semibold text-teal hover:underline"
                  >
                    Open live post ↗
                  </a>
                ) : null}
                <button
                  onClick={() => pause.mutate()}
                  disabled={pause.isPending}
                  className="w-full rounded-md border border-gray-light bg-white px-3 py-2.5 text-sm font-semibold text-gray-dark hover:bg-offwhite disabled:opacity-50"
                >
                  {pause.isPending ? 'Pausing…' : 'Pause this post'}
                </button>
              </>
            )}

            {pkg.status === 'paused' && (
              <p className="rounded-md bg-amber-50 p-2.5 text-xs text-amber-800">
                Paused. Property availability may have changed — check before re-publishing.
              </p>
            )}
          </div>
        </aside>

        {/* AUTO-PUBLISH — full-width row below the 3-column grid */}
        <section className="xl:col-span-12">
          <AutoPublishPanel packageId={pkg.id} />
        </section>

        {/* PLACEMENTS LEDGER — every place this listing has been posted */}
        <section className="xl:col-span-12">
          <PlacementsPanel packageId={pkg.id} packageShortUrl={pkg.trackingLink?.shortUrl ?? null} />
        </section>
      </div>
    </div>
  );
}

function CaptionEditor({
  label,
  hint,
  value,
  onChange,
  onCopy,
  copied,
  rows = 3,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  onCopy: () => void;
  copied: boolean;
  rows?: number;
}) {
  return (
    <div className="rounded-md border border-gray-light bg-white p-4 shadow-card">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <label className="text-sm font-semibold text-navy-deep">{label}</label>
          {hint ? <p className="text-xs text-gray-medium">{hint}</p> : null}
        </div>
        <button
          onClick={onCopy}
          className="rounded-md border border-gray-light px-2.5 py-1 text-xs font-semibold text-gray-dark hover:bg-offwhite"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full resize-y rounded-md border border-gray-light bg-offwhite p-3 text-sm focus:border-teal focus:bg-white focus:outline-none"
      />
      <p className="mt-1 text-right text-xs text-gray-medium">{value.length} chars</p>
    </div>
  );
}

// =============================================================================
// AUTO-PUBLISH — owned channels (Telegram now, IG/FB later)
// =============================================================================

interface AutomatedChannel {
  id: string;
  name: string;
  platform: string;
  externalId: string | null;
}

function AutoPublishPanel({ packageId }: { packageId: string }) {
  const { data: channels, isLoading } = useQuery({
    queryKey: ['automated-channels'],
    queryFn: () => api<AutomatedChannel[]>('/post-packages/automated-channels/list'),
  });

  return (
    <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-navy-deep">Auto-publish to owned channels</h2>
        <p className="mt-1 text-xs text-gray-medium">
          Push this listing instantly to a channel we own. Each post gets a unique tracking link
          so you can see exactly which channel produces leads.
        </p>
      </div>

      {isLoading && <p className="text-xs text-gray-medium">Loading channels…</p>}
      {!isLoading && (!channels || channels.length === 0) && (
        <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
          No automated channels registered yet. Set <code>TELEGRAM_BOT_TOKEN</code> in the API env
          and seed the <code>PostChannel</code> rows from the VPS.
        </p>
      )}
      {channels && channels.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {channels.map((ch) => (
            <AutoPublishCard key={ch.id} packageId={packageId} channel={ch} />
          ))}
        </div>
      )}
    </div>
  );
}

interface PublishResult {
  id: string;
  externalUrl: string | null;
  trackingSlug: string | null;
  channelName: string;
  publishedAt: string;
}

interface ScheduledChannelPostRow {
  id: string;
  status: string; // pending | attempting | done | failed | cancelled
  scheduledFor: string;
  caption: string;
  attemptedAt: string | null;
  errorMessage: string | null;
  channel: { id: string; name: string; platform: string };
  createdBy: { fullName: string | null } | null;
}

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
/** Format the next "default" datetime-local value for the picker — 1 hour
 *  from now in Dubai time. The <input type="datetime-local"> expects a
 *  string in `YYYY-MM-DDTHH:MM` format with NO timezone suffix; the user
 *  reads it as local Dubai time. */
function defaultDubaiDateTime(): string {
  const t = new Date(Date.now() + 60 * 60 * 1000 + DUBAI_OFFSET_MS);
  // toISOString gives UTC; we already shifted by +4 so the resulting
  // YYYY-MM-DDTHH:MM digits ARE Dubai-local.
  return t.toISOString().slice(0, 16);
}
/** Convert the picker's Dubai-local input into a UTC ISO string the API
 *  stores. The picker has no timezone awareness, so we explicitly
 *  subtract the Dubai offset. */
function dubaiInputToUtcIso(localValue: string): string {
  const asIfUtc = new Date(`${localValue}:00.000Z`).getTime();
  return new Date(asIfUtc - DUBAI_OFFSET_MS).toISOString();
}
/** Format a UTC ISO timestamp back to a Dubai-local human label. */
function utcIsoToDubaiLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + DUBAI_OFFSET_MS);
  const datePart = d.toISOString().slice(0, 10);
  const timePart = d.toISOString().slice(11, 16);
  return `${datePart} ${timePart} Dubai`;
}

function AutoPublishCard({
  packageId,
  channel,
}: {
  packageId: string;
  channel: AutomatedChannel;
}) {
  const qc = useQueryClient();
  const [caption, setCaption] = useState('');
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduleAt, setScheduleAt] = useState<string>(defaultDubaiDateTime());

  const draft = useMutation({
    mutationFn: () =>
      api<{ caption: string; modelId: string }>(
        `/post-packages/${packageId}/draft-auto-caption`,
        { method: 'POST', body: JSON.stringify({ channelId: channel.id }) },
      ),
    onSuccess: (res) => setCaption(res.caption),
  });

  const publish = useMutation({
    mutationFn: () =>
      api<PublishResult>(`/post-packages/${packageId}/auto-publish`, {
        method: 'POST',
        body: JSON.stringify({ channelId: channel.id, caption }),
      }),
    onSuccess: (res) => {
      setPublished(res);
      qc.invalidateQueries({ queryKey: ['post-package', packageId] });
      qc.invalidateQueries({ queryKey: ['post-packages'] });
    },
  });

  const schedule = useMutation({
    mutationFn: () =>
      api<ScheduledChannelPostRow>(
        `/post-packages/${packageId}/schedule-auto-publish`,
        {
          method: 'POST',
          body: JSON.stringify({
            channelId: channel.id,
            caption,
            scheduledFor: dubaiInputToUtcIso(scheduleAt),
          }),
        },
      ),
    onSuccess: () => {
      setCaption('');
      setScheduleMode(false);
      setScheduleAt(defaultDubaiDateTime());
      qc.invalidateQueries({ queryKey: ['scheduled-posts', packageId] });
    },
  });

  const platformBadge = (() => {
    const map: Record<string, { label: string; cls: string }> = {
      telegram: { label: 'Telegram', cls: 'bg-sky-100 text-sky-800' },
      instagram: { label: 'Instagram', cls: 'bg-pink-100 text-pink-800' },
      facebook: { label: 'Facebook', cls: 'bg-blue-100 text-blue-800' },
    };
    return map[channel.platform] ?? { label: channel.platform, cls: 'bg-gray-100 text-gray-800' };
  })();

  return (
    <div className="rounded-md border border-gray-light bg-offwhite p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-navy-deep">{channel.name}</p>
          <span
            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${platformBadge.cls}`}
          >
            {platformBadge.label}
          </span>
        </div>
      </div>

      {published ? (
        <div className="rounded-md bg-emerald-50 p-3 text-xs">
          <p className="font-semibold text-emerald-800">✓ Published</p>
          {published.externalUrl ? (
            <a
              href={published.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block font-semibold text-teal hover:underline"
            >
              Open live post ↗
            </a>
          ) : null}
          {published.trackingSlug && (
            <p className="mt-2 text-emerald-800">
              Tracking slug: <code className="font-mono">{published.trackingSlug}</code>
            </p>
          )}
          <button
            onClick={() => {
              setPublished(null);
              setCaption('');
            }}
            className="mt-3 text-emerald-700 underline hover:text-emerald-900"
          >
            Post another
          </button>
        </div>
      ) : (
        <>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption — write here, or click 'Draft with AI' to generate"
            rows={6}
            className="w-full resize-y rounded-md border border-gray-light bg-white p-3 text-sm focus:border-teal focus:outline-none"
          />
          <p className="mt-1 text-right text-xs text-gray-medium">{caption.length} chars</p>

          {draft.isError && (
            <p className="mb-2 rounded-md bg-rose-50 p-2 text-xs text-rose-800">
              {(draft.error as Error)?.message ?? 'Draft failed.'}
            </p>
          )}
          {publish.isError && (
            <p className="mb-2 rounded-md bg-rose-50 p-2 text-xs text-rose-800">
              {(publish.error as Error)?.message ?? 'Publish failed.'}
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <button
              onClick={() => draft.mutate()}
              disabled={draft.isPending}
              className="flex-1 rounded-md border border-gray-light bg-white px-3 py-2 text-xs font-semibold text-gray-dark hover:bg-white disabled:opacity-50"
            >
              {draft.isPending ? 'Drafting…' : '✨ Draft with AI'}
            </button>
            {scheduleMode ? (
              <button
                onClick={() => schedule.mutate()}
                disabled={schedule.isPending || !caption.trim() || !scheduleAt}
                className="flex-1 rounded-md bg-teal px-3 py-2 text-xs font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
              >
                {schedule.isPending ? 'Scheduling…' : '📅 Schedule'}
              </button>
            ) : (
              <button
                onClick={() => publish.mutate()}
                disabled={publish.isPending || !caption.trim()}
                className="flex-1 rounded-md bg-teal px-3 py-2 text-xs font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
              >
                {publish.isPending ? 'Publishing…' : 'Publish now'}
              </button>
            )}
          </div>

          <div className="mt-3 rounded-md border border-gray-light bg-white p-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-dark">
              <input
                type="checkbox"
                checked={scheduleMode}
                onChange={(e) => setScheduleMode(e.target.checked)}
              />
              Schedule for later (Dubai time)
            </label>
            {scheduleMode ? (
              <div className="mt-2">
                <input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className="w-full rounded-md border border-gray-light p-2 text-sm"
                />
                <p className="mt-1 text-[11px] text-gray-medium">
                  The 1-min cron picks it up at this time and fires Publish on its own.
                </p>
                {schedule.isError ? (
                  <p className="mt-2 rounded-md bg-rose-50 p-2 text-xs text-rose-800">
                    {(schedule.error as Error)?.message ?? 'Schedule failed.'}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <ScheduledPostsList packageId={packageId} channelId={channel.id} />
        </>
      )}
    </div>
  );
}

function ScheduledPostsList({ packageId, channelId }: { packageId: string; channelId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['scheduled-posts', packageId],
    queryFn: () => api<ScheduledChannelPostRow[]>(`/post-packages/${packageId}/scheduled-posts`),
    refetchInterval: 30_000,
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      api(`/post-packages/${packageId}/scheduled-posts/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduled-posts', packageId] }),
  });
  const myChannelRows = (data ?? []).filter((r) => r.channel.id === channelId);
  if (myChannelRows.length === 0) return null;

  const statusColor: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    attempting: 'bg-amber-100 text-amber-800',
    done: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-rose-100 text-rose-800',
    cancelled: 'bg-gray-200 text-gray-700',
  };

  return (
    <div className="mt-3 rounded-md border border-gray-light bg-white p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-medium">
        Scheduled for this channel
      </p>
      <ul className="space-y-2">
        {myChannelRows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
            <div>
              <p className="font-semibold text-navy-deep">{utcIsoToDubaiLabel(r.scheduledFor)}</p>
              <p className="text-gray-medium">
                <span
                  className={`mr-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    statusColor[r.status] ?? 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {r.status}
                </span>
                {r.createdBy?.fullName ? `by ${r.createdBy.fullName}` : null}
              </p>
              {r.errorMessage ? (
                <p className="mt-1 text-[11px] text-rose-700">{r.errorMessage}</p>
              ) : null}
            </div>
            {r.status === 'pending' ? (
              <button
                onClick={() => cancel.mutate(r.id)}
                disabled={cancel.isPending}
                className="rounded-md border border-gray-light px-2 py-1 text-[11px] hover:bg-offwhite"
              >
                Cancel
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// =============================================================================
// PLACEMENTS LEDGER — per-channel publishing record + click attribution
// =============================================================================

interface PlacementRow {
  id: string;
  channelName: string;
  channelKind: string | null;
  externalUrl: string | null;
  groupSize: number | null;
  trackingSlug: string | null;
  clicks: number;
  lastClickAt: string | null;
  publishedAt: string;
  automated: boolean;
  publisher: { id: string; fullName: string | null; email: string | null } | null;
  _count: { attributedLeads: number };
}

function PlacementsPanel({ packageId, packageShortUrl }: { packageId: string; packageShortUrl: string | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ['post-package-placements', packageId],
    queryFn: () => api<PlacementRow[]>(`/post-packages/${packageId}/placements`),
    refetchInterval: 30_000,
  });
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  function buildPlacementUrl(slug: string | null): string | null {
    if (!packageShortUrl || !slug) return null;
    const sep = packageShortUrl.includes('?') ? '&' : '?';
    return `${packageShortUrl}${sep}s=${slug}`;
  }
  async function copyPlacementLink(slug: string | null) {
    const url = buildPlacementUrl(slug);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug((c) => (c === slug ? null : c)), 1800);
    } catch {
      /* noop */
    }
  }

  const rows = data ?? [];
  const totalClicks = rows.reduce((s, r) => s + (r.clicks ?? 0), 0);
  const totalLeads = rows.reduce((s, r) => s + (r._count?.attributedLeads ?? 0), 0);

  return (
    <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-navy-deep">Placements ledger</h2>
          <p className="mt-1 text-xs text-gray-medium">
            Every channel this listing has been posted to. Each row gets a unique tracking slug
            so we can see exactly which group brings clicks and which brings booked leads.
          </p>
        </div>
        <div className="flex gap-4 text-right text-xs">
          <div>
            <p className="text-gray-medium">Total placements</p>
            <p className="text-lg font-bold text-navy-deep">{rows.length}</p>
          </div>
          <div>
            <p className="text-gray-medium">Clicks</p>
            <p className="text-lg font-bold text-teal">{totalClicks}</p>
          </div>
          <div>
            <p className="text-gray-medium">Leads attributed</p>
            <p className="text-lg font-bold text-emerald-700">{totalLeads}</p>
          </div>
        </div>
      </div>

      {isLoading && <p className="text-xs text-gray-medium">Loading placements…</p>}
      {!isLoading && rows.length === 0 && (
        <p className="rounded-md bg-offwhite p-3 text-xs text-gray-medium">
          No placements logged yet. Field agents log placements from the mobile app once they
          publish. Auto-publish to owned channels (above) will also appear here.
        </p>
      )}
      {rows.length > 0 && (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-medium">
                <th className="px-2 py-2">Channel</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Publisher</th>
                <th className="px-2 py-2">Posted</th>
                <th className="px-2 py-2 text-right">Group size</th>
                <th className="px-2 py-2 text-right">Clicks</th>
                <th className="px-2 py-2 text-right">Leads</th>
                <th className="px-2 py-2">Live post</th>
                <th className="px-2 py-2">Track URL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-light text-xs">
                  <td className="px-2 py-2 font-semibold text-navy-deep">{r.channelName}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      r.automated ? 'bg-sky-100 text-sky-800' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {r.automated ? 'AUTO' : (r.channelKind ?? 'manual').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-gray-dark">
                    {r.automated ? '— (bot)' : (r.publisher?.fullName ?? r.publisher?.email ?? '—')}
                  </td>
                  <td className="px-2 py-2 text-gray-medium">
                    {new Date(r.publishedAt).toLocaleDateString()} {new Date(r.publishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-medium">
                    {r.groupSize ? r.groupSize.toLocaleString() : '—'}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold text-teal">{r.clicks}</td>
                  <td className="px-2 py-2 text-right font-semibold text-emerald-700">
                    {r._count?.attributedLeads ?? 0}
                  </td>
                  <td className="px-2 py-2">
                    {r.externalUrl ? (
                      <a
                        href={r.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-teal hover:underline"
                      >
                        Open ↗
                      </a>
                    ) : (
                      <span className="text-gray-medium">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {r.trackingSlug && packageShortUrl ? (
                      <button
                        onClick={() => copyPlacementLink(r.trackingSlug)}
                        title={buildPlacementUrl(r.trackingSlug) ?? ''}
                        className="rounded-md border border-gray-light px-2 py-1 text-[10px] font-semibold text-navy-deep hover:bg-offwhite"
                      >
                        {copiedSlug === r.trackingSlug ? '✓ Copied' : 'Copy link'}
                      </button>
                    ) : (
                      <span className="text-gray-medium">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {packageShortUrl && rows.length > 0 ? (
        <p className="mt-3 rounded-md bg-amber-50 p-3 text-[11px] text-amber-900">
          <strong>Tip for field agents:</strong> when posting to a new group, copy that
          row&apos;s unique <em>Track URL</em> instead of the package link. Per-group clicks
          only register on URLs with the <code>?s=&lt;slug&gt;</code> suffix — that&apos;s how
          you can see which group brings the most leads.
        </p>
      ) : null}
    </div>
  );
}
