'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ScoreBadge, StatusPill } from '@rentflow/ui';
import { AuthedImage } from '@/components/AuthedImage';
import { api } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface PropertyDetail {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  area: string | null;
  addressLine: string | null;
  priceAed: string | null;
  depositAed: string | null;
  description: string | null;
  occupancyMax: number | null;
  rentalMinMonths: number | null;
  amenities: string[] | null;
  viewingAccess: string | null;
  moveInDate: string | null;
  rentedUntil: string | null;
  priceConfirmedAt: string | null;
  availabilityConfirmedAt: string | null;
  qualityScore: number;
  readinessScore: number;
  owner: { id: string; fullName: string; phoneE164: string; trustScore: number } | null;
  media: Array<{
    id: string;
    kind: string;
    caption: string | null;
    file: { id: string; mimeType: string; originalName: string | null };
  }>;
  availabilityBlocks: Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    reason: string;
  }>;
  issues: Array<{
    id: string;
    type: string;
    description: string;
    resolvedAt: string | null;
    createdAt: string;
  }>;
  postPackages: Array<{
    id: string;
    title: string | null;
    status: string;
    channelName: string | null;
    publishedAt: string | null;
    trackingLink: { sourceCode: string; postCode: string; clicks: number } | null;
  }>;
  leads: Array<{
    id: string;
    fullName: string | null;
    phoneE164: string;
    status: string;
    temperature: string;
    qualificationScore: number;
    createdAt: string;
  }>;
  viewings: Array<{
    id: string;
    status: string;
    scheduledAt: string;
    fieldAgent: { user: { fullName: string } } | null;
  }>;
}

const STATUS_OPTIONS = [
  'draft',
  'available',
  'pending_owner_confirmation',
  'rented',
  'blocked',
  'unavailable',
  'archived',
  'needs_media',
  'needs_price_confirmation',
  'not_ready_to_post',
];

export default function PropertyDetailPage({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const { data: property, isLoading } = useQuery({
    queryKey: ['properties', params.id],
    queryFn: () => api<PropertyDetail>(`/properties/${params.id}`),
  });

  const [edit, setEdit] = useState({
    name: '',
    status: 'draft',
    area: '',
    addressLine: '',
    priceAed: '',
    depositAed: '',
    description: '',
    occupancyMax: '',
    rentalMinMonths: '',
    viewingAccess: '',
  });
  const [dirty, setDirty] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (property) {
      setEdit({
        name: property.name,
        status: property.status,
        area: property.area ?? '',
        addressLine: property.addressLine ?? '',
        priceAed: property.priceAed ?? '',
        depositAed: property.depositAed ?? '',
        description: property.description ?? '',
        occupancyMax: property.occupancyMax?.toString() ?? '',
        rentalMinMonths: property.rentalMinMonths?.toString() ?? '',
        viewingAccess: property.viewingAccess ?? '',
      });
      setDirty(false);
    }
  }, [property]);

  const saveEdit = useMutation({
    mutationFn: () =>
      api(`/properties/${params.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: edit.name,
          status: edit.status,
          area: edit.area || null,
          addressLine: edit.addressLine || null,
          priceAed: edit.priceAed ? Number(edit.priceAed) : null,
          depositAed: edit.depositAed ? Number(edit.depositAed) : null,
          description: edit.description || null,
          occupancyMax: edit.occupancyMax ? Number(edit.occupancyMax) : null,
          rentalMinMonths: edit.rentalMinMonths ? Number(edit.rentalMinMonths) : null,
          viewingAccess: edit.viewingAccess || null,
          priceConfirmedAt: edit.priceAed ? new Date().toISOString() : undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['properties', params.id] });
      setDirty(false);
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const recalcScores = useMutation({
    mutationFn: () =>
      api(`/properties/${params.id}/recalculate-scores`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['properties', params.id] }),
    onError: (err) => setActionError((err as Error).message),
  });

  const addBlock = useMutation({
    mutationFn: (body: { startsAt: string; endsAt: string; reason: string }) =>
      api(`/properties/${params.id}/availability-blocks`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['properties', params.id] }),
    onError: (err) => setActionError((err as Error).message),
  });

  function setField<K extends keyof typeof edit>(key: K, value: (typeof edit)[K]) {
    setEdit((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function uploadFiles(files: FileList) {
    const token = window.localStorage.getItem('rentflow_token');
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('kind', file.type.startsWith('video/') ? 'video' : 'photo');
        const res = await fetch(`${API_BASE}/properties/${params.id}/media`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
        if (!res.ok) throw new Error(await res.text());
      }
      qc.invalidateQueries({ queryKey: ['properties', params.id] });
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  if (isLoading) return <p className="text-sm text-gray-medium">Loading…</p>;
  if (!property) return <p className="text-sm text-danger">Property not found.</p>;

  return (
    <div>
      <Link href="/properties" className="text-sm text-gray-medium hover:text-navy-deep">
        ← Back to Properties
      </Link>

      <header className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-gray-medium">{property.code}</span>
            <StatusPill status={property.status} />
          </div>
          <h1 className="mt-1">{property.name}</h1>
          <p className="text-sm text-gray-medium">
            {property.type.replace(/_/g, ' ')} · {property.area ?? '—'}
            {property.addressLine ? ` · ${property.addressLine}` : ''}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <ScoreBadge score={property.readinessScore} label="Readiness" />
            <ScoreBadge score={property.qualityScore} label="Quality" />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => recalcScores.mutate()}
            disabled={recalcScores.isPending}
            className="rounded-md border border-gray-light px-3 py-2 text-xs font-semibold text-gray-dark hover:bg-offwhite"
          >
            {recalcScores.isPending ? 'Recalculating…' : 'Recalculate readiness'}
          </button>
          {dirty ? (
            <button
              onClick={() => saveEdit.mutate()}
              disabled={saveEdit.isPending}
              className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
            >
              {saveEdit.isPending ? 'Saving…' : 'Save changes'}
            </button>
          ) : null}
        </div>
      </header>

      {actionError ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* LEFT — editable fields */}
        <section className="space-y-4 xl:col-span-5">
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-4 text-sm uppercase tracking-wide text-gray-medium">Property fields</h3>
            <Field label="Name" value={edit.name} onChange={(v) => setField('name', v)} />

            <label className="mb-1 block text-xs font-semibold text-gray-dark">Status</label>
            <select
              value={edit.status}
              onChange={(e) => setField('status', e.target.value)}
              className="mb-3 w-full rounded-md border border-gray-light px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>

            <Field label="Area" value={edit.area} onChange={(v) => setField('area', v)} />
            <Field label="Address" value={edit.addressLine} onChange={(v) => setField('addressLine', v)} />

            <div className="grid grid-cols-2 gap-3">
              <Field label="Price (AED)" type="number" value={edit.priceAed} onChange={(v) => setField('priceAed', v)} />
              <Field label="Deposit (AED)" type="number" value={edit.depositAed} onChange={(v) => setField('depositAed', v)} />
              <Field label="Occupancy max" type="number" value={edit.occupancyMax} onChange={(v) => setField('occupancyMax', v)} />
              <Field label="Min stay (months)" type="number" value={edit.rentalMinMonths} onChange={(v) => setField('rentalMinMonths', v)} />
            </div>

            <label className="mb-1 mt-2 block text-xs font-semibold text-gray-dark">Description</label>
            <textarea
              rows={3}
              value={edit.description}
              onChange={(e) => setField('description', e.target.value)}
              className="mb-3 w-full rounded-md border border-gray-light bg-offwhite p-2.5 text-sm focus:border-teal focus:bg-white focus:outline-none"
            />

            <label className="mb-1 block text-xs font-semibold text-gray-dark">Viewing access</label>
            <textarea
              rows={2}
              value={edit.viewingAccess}
              onChange={(e) => setField('viewingAccess', e.target.value)}
              className="w-full rounded-md border border-gray-light bg-offwhite p-2.5 text-sm focus:border-teal focus:bg-white focus:outline-none"
            />
          </div>

          {/* Owner */}
          {property.owner ? (
            <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
              <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Owner</h3>
              <Link
                href={`/owners/${property.owner.id}`}
                className="block font-semibold text-navy-deep hover:underline"
              >
                {property.owner.fullName}
              </Link>
              <p className="font-mono text-xs text-gray-medium">{property.owner.phoneE164}</p>
              <div className="mt-2">
                <ScoreBadge score={property.owner.trustScore} label="Trust" />
              </div>
            </div>
          ) : null}

          {/* Availability blocks */}
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Availability blocks</h3>
            <BlockForm onSubmit={(b) => addBlock.mutate(b)} pending={addBlock.isPending} />
            {property.availabilityBlocks.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {property.availabilityBlocks.map((b) => (
                  <li key={b.id} className="rounded-md border border-gray-light p-2 text-xs">
                    <p className="font-semibold">
                      {new Date(b.startsAt).toLocaleDateString()} →{' '}
                      {new Date(b.endsAt).toLocaleDateString()}
                    </p>
                    <p className="text-gray-medium">{b.reason}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-gray-medium">No blocks yet.</p>
            )}
          </div>
        </section>

        {/* RIGHT — media + activity */}
        <section className="space-y-4 xl:col-span-7">
          {/* Media gallery */}
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm uppercase tracking-wide text-gray-medium">Media</h3>
              <div>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept="image/*,video/mp4,video/quicktime"
                  onChange={(e) => e.target.files && uploadFiles(e.target.files)}
                  className="hidden"
                />
                <button
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                  className="rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
                >
                  {uploading ? 'Uploading…' : '+ Upload photos'}
                </button>
              </div>
            </div>

            {property.media.length === 0 ? (
              <p className="text-sm text-gray-medium">No photos yet. Upload some to lift readiness score.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                {property.media.map((m) => (
                  <div
                    key={m.id}
                    className="aspect-square overflow-hidden rounded-md border border-gray-light bg-offwhite"
                  >
                    {m.file.mimeType.startsWith('image/') ? (
                      <AuthedImage
                        fileId={m.file.id}
                        alt={m.caption ?? 'Property media'}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-gray-medium">
                        {m.kind}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Recent leads */}
            <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
              <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">
                Recent leads ({property.leads.length})
              </h3>
              {property.leads.length === 0 ? (
                <p className="text-xs text-gray-medium">No leads yet.</p>
              ) : (
                <ul className="space-y-2">
                  {property.leads.map((l) => (
                    <li key={l.id}>
                      <Link
                        href={`/leads/${l.id}`}
                        className="block rounded-md border border-gray-light p-2 text-xs hover:bg-offwhite"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{l.fullName ?? l.phoneE164}</span>
                          <StatusPill status={l.status} />
                        </div>
                        <p className="mt-0.5 text-gray-medium">
                          {l.temperature} · score {l.qualificationScore} ·{' '}
                          {new Date(l.createdAt).toLocaleDateString()}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Recent viewings */}
            <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
              <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">
                Recent viewings ({property.viewings.length})
              </h3>
              {property.viewings.length === 0 ? (
                <p className="text-xs text-gray-medium">No viewings yet.</p>
              ) : (
                <ul className="space-y-2">
                  {property.viewings.map((v) => (
                    <li key={v.id}>
                      <Link
                        href={`/viewings/${v.id}`}
                        className="block rounded-md border border-gray-light p-2 text-xs hover:bg-offwhite"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">
                            {new Date(v.scheduledAt).toLocaleString()}
                          </span>
                          <StatusPill status={v.status} />
                        </div>
                        <p className="mt-0.5 text-gray-medium">
                          agent: {v.fieldAgent?.user?.fullName ?? '— unassigned —'}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Post packages */}
            <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
              <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">
                Post packages ({property.postPackages.length})
              </h3>
              {property.postPackages.length === 0 ? (
                <p className="text-xs text-gray-medium">No packages generated yet.</p>
              ) : (
                <ul className="space-y-2">
                  {property.postPackages.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/posting/${p.id}`}
                        className="block rounded-md border border-gray-light p-2 text-xs hover:bg-offwhite"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{p.title ?? '(unnamed)'}</span>
                          <StatusPill status={p.status} />
                        </div>
                        <p className="mt-0.5 text-gray-medium">
                          {p.channelName ?? '—'}
                          {p.trackingLink
                            ? ` · ${p.trackingLink.clicks} clicks`
                            : ''}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Issues */}
            <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
              <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">
                Issues ({property.issues.length})
              </h3>
              {property.issues.length === 0 ? (
                <p className="text-xs text-gray-medium">No issues reported.</p>
              ) : (
                <ul className="space-y-2">
                  {property.issues.map((i) => (
                    <li key={i.id} className="rounded-md border border-gray-light p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{i.type.replace(/_/g, ' ')}</span>
                        {i.resolvedAt ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            ✓ resolved
                          </span>
                        ) : (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                            open
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-gray-dark">{i.description}</p>
                      <p className="mt-0.5 text-gray-medium">
                        {new Date(i.createdAt).toLocaleDateString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'number' | 'date';
}) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs font-semibold text-gray-dark">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-light px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
      />
    </div>
  );
}

function BlockForm({
  onSubmit,
  pending,
}: {
  onSubmit: (b: { startsAt: string; endsAt: string; reason: string }) => void;
  pending: boolean;
}) {
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          type="date"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          className="rounded-md border border-gray-light px-2 py-1.5 text-xs focus:border-teal focus:outline-none"
        />
        <input
          type="date"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
          className="rounded-md border border-gray-light px-2 py-1.5 text-xs focus:border-teal focus:outline-none"
        />
      </div>
      <input
        type="text"
        placeholder="Reason (e.g. rented, maintenance)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full rounded-md border border-gray-light px-2 py-1.5 text-xs focus:border-teal focus:outline-none"
      />
      <button
        onClick={() => {
          if (startsAt && endsAt && reason) {
            onSubmit({
              startsAt: new Date(startsAt).toISOString(),
              endsAt: new Date(endsAt).toISOString(),
              reason,
            });
            setStartsAt('');
            setEndsAt('');
            setReason('');
          }
        }}
        disabled={!startsAt || !endsAt || !reason || pending}
        className="w-full rounded-md bg-secondary px-2 py-1.5 text-xs font-semibold text-white hover:bg-navy-deep disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add block'}
      </button>
    </div>
  );
}
