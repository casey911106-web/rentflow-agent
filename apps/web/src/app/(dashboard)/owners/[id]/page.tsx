'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ScoreBadge, StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface OwnerDetail {
  id: string;
  fullName: string;
  phoneE164: string;
  email: string | null;
  notes: string | null;
  trustScore: number;
  responseRate: number;
  lastContactedAt: string | null;
  createdAt: string;
  properties: Array<{
    id: string;
    code: string;
    name: string;
    type: string;
    status: string;
    area: string | null;
    priceAed: string | null;
    qualityScore: number;
    readinessScore: number;
  }>;
  scoreSnapshots: Array<{
    id: string;
    score: number;
    factors: Record<string, unknown>;
    createdAt: string;
  }>;
  availabilityChecks: Array<{
    id: string;
    status: string;
    askedAt: string;
    repliedAt: string | null;
    rawReply: string | null;
    nextCheckAt: string | null;
    propertyId: string;
  }>;
}

export default function OwnerDetailPage({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const { data: owner, isLoading } = useQuery({
    queryKey: ['owners', params.id],
    queryFn: () => api<OwnerDetail>(`/owners/${params.id}`),
  });

  const [edit, setEdit] = useState({ fullName: '', phoneE164: '', email: '', notes: '' });
  const [dirty, setDirty] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [triggered, setTriggered] = useState<number | null>(null);

  useEffect(() => {
    if (owner) {
      setEdit({
        fullName: owner.fullName,
        phoneE164: owner.phoneE164,
        email: owner.email ?? '',
        notes: owner.notes ?? '',
      });
      setDirty(false);
    }
  }, [owner]);

  const save = useMutation({
    mutationFn: () =>
      api(`/owners/${params.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: edit.fullName,
          phoneE164: edit.phoneE164,
          email: edit.email || null,
          notes: edit.notes || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owners', params.id] });
      setDirty(false);
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const triggerCheck = useMutation({
    mutationFn: () =>
      api<unknown[]>(`/owners/${params.id}/check-availability`, { method: 'POST' }),
    onSuccess: (rows) => {
      qc.invalidateQueries({ queryKey: ['owners', params.id] });
      setTriggered(Array.isArray(rows) ? rows.length : 0);
      setTimeout(() => setTriggered(null), 4000);
    },
    onError: (err) => setActionError((err as Error).message),
  });

  function setField<K extends keyof typeof edit>(key: K, value: (typeof edit)[K]) {
    setEdit((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  if (isLoading) return <p className="text-sm text-gray-medium">Loading…</p>;
  if (!owner) return <p className="text-sm text-danger">Owner not found.</p>;

  const propertyMap = new Map(owner.properties.map((p) => [p.id, p]));

  return (
    <div>
      <Link href="/owners" className="text-sm text-gray-medium hover:text-navy-deep">
        ← Back to Owners
      </Link>

      <header className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1>{owner.fullName}</h1>
          <p className="text-sm text-gray-medium">
            <span className="font-mono">{owner.phoneE164}</span>
            {owner.email ? ` · ${owner.email}` : ''}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <ScoreBadge score={owner.trustScore} label="Trust" />
            <span className="text-xs text-gray-medium">
              Response rate: <strong className="text-gray-dark">
                {(owner.responseRate * 100).toFixed(0)}%
              </strong>
            </span>
            {owner.lastContactedAt ? (
              <span className="text-xs text-gray-medium">
                Last contact: {new Date(owner.lastContactedAt).toLocaleDateString()}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={() => triggerCheck.mutate()}
            disabled={triggerCheck.isPending || owner.properties.length === 0}
            className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
          >
            {triggerCheck.isPending ? 'Triggering…' : '📲 Trigger availability check'}
          </button>
          {triggered !== null ? (
            <p className="text-xs text-emerald-700">
              ✓ Queued {triggered} check{triggered === 1 ? '' : 's'}
            </p>
          ) : null}
          {dirty ? (
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="rounded-md bg-secondary px-4 py-2 text-sm font-semibold text-white hover:bg-navy-deep disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save changes'}
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
        {/* LEFT — editable */}
        <section className="space-y-4 xl:col-span-4">
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Contact</h3>
            <Field label="Full name" value={edit.fullName} onChange={(v) => setField('fullName', v)} />
            <Field label="Phone (E.164)" value={edit.phoneE164} onChange={(v) => setField('phoneE164', v)} />
            <Field label="Email" type="email" value={edit.email} onChange={(v) => setField('email', v)} />

            <label className="mb-1 block text-xs font-semibold text-gray-dark">Notes</label>
            <textarea
              rows={4}
              value={edit.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder="Internal notes about this owner — preferences, quirks, history…"
              className="w-full rounded-md border border-gray-light bg-offwhite p-2.5 text-sm focus:border-teal focus:bg-white focus:outline-none"
            />
          </div>

          {/* Score history */}
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Trust score history</h3>
            {owner.scoreSnapshots.length === 0 ? (
              <p className="text-xs text-gray-medium">No snapshots yet.</p>
            ) : (
              <ul className="space-y-1">
                {owner.scoreSnapshots.map((s) => (
                  <li key={s.id} className="flex items-center justify-between text-xs">
                    <span className="text-gray-medium">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </span>
                    <ScoreBadge score={s.score} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* RIGHT — properties + checks */}
        <section className="space-y-4 xl:col-span-8">
          {/* Properties */}
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">
              Properties ({owner.properties.length})
            </h3>
            {owner.properties.length === 0 ? (
              <p className="text-sm text-gray-medium">No properties linked yet.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-gray-light">
                <table className="w-full text-left text-sm">
                  <thead className="bg-offwhite text-xs uppercase text-gray-medium">
                    <tr>
                      <th className="px-3 py-2">Code</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Price</th>
                      <th className="px-3 py-2">Readiness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {owner.properties.map((p) => (
                      <tr key={p.id} className="border-t border-gray-light hover:bg-offwhite">
                        <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                        <td className="px-3 py-2 font-semibold">
                          <Link href={`/properties/${p.id}`} className="text-navy hover:underline">
                            {p.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-gray-dark">{p.type.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2">
                          <StatusPill status={p.status} />
                        </td>
                        <td className="px-3 py-2 text-gray-dark">
                          {p.priceAed ? `AED ${Number(p.priceAed).toLocaleString()}` : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <ScoreBadge score={p.readinessScore} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Availability checks */}
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">
              Availability checks ({owner.availabilityChecks.length})
            </h3>
            {owner.availabilityChecks.length === 0 ? (
              <p className="text-sm text-gray-medium">No checks yet. Trigger one above.</p>
            ) : (
              <ul className="space-y-2">
                {owner.availabilityChecks.map((c) => {
                  const property = propertyMap.get(c.propertyId);
                  return (
                    <li
                      key={c.id}
                      className="rounded-md border border-gray-light p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          {property ? (
                            <Link
                              href={`/properties/${property.id}`}
                              className="font-semibold text-navy-deep hover:underline"
                            >
                              {property.code} — {property.name}
                            </Link>
                          ) : (
                            <span className="font-mono text-gray-medium">
                              property {c.propertyId.slice(0, 8)}…
                            </span>
                          )}
                          <p className="mt-0.5 text-gray-medium">
                            asked {new Date(c.askedAt).toLocaleString()}
                            {c.repliedAt
                              ? ` · replied ${new Date(c.repliedAt).toLocaleString()}`
                              : ' · awaiting reply'}
                          </p>
                          {c.rawReply ? (
                            <p className="mt-1 text-gray-dark">"{c.rawReply}"</p>
                          ) : null}
                        </div>
                        <StatusPill status={c.status} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
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
  type?: 'text' | 'number' | 'email';
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
