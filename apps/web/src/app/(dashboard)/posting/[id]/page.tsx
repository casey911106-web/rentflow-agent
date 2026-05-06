'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ScoreBadge, StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

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
