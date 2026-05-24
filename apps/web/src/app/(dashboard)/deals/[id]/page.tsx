'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface DealDetail {
  id: string;
  status: string;
  rentAmount: string | null;
  depositAmount: string | null;
  commissionAmount: string | null;
  commissionPaidBy: string | null;
  moveInDate: string | null;
  rentalDurationMonths: number | null;
  closedAt: string | null;
  lostReason: string | null;
  internalNotes: string | null;
  createdAt: string;
  lead: { id: string; fullName: string | null; phoneE164: string };
  property: { id: string; code: string; name: string };
  fieldAgent: { id: string; user: { fullName: string } } | null;
  commission: {
    id: string;
    status: string;
    expectedAmount: string;
    invoicedAmount: string | null;
    collectedAmount: string;
    invoicedAt: string | null;
    collectedAt: string | null;
    notes: string | null;
    payments: Array<{
      id: string;
      amount: string;
      status: string;
      method: string | null;
      reference: string | null;
      paidAt: string | null;
      createdAt: string;
    }>;
  } | null;
  splits: Array<{
    id: string;
    recipientUserId: string | null;
    recipient: { id: string; fullName: string } | null;
    label: string;
    percent: string;
    notes: string | null;
  }>;
}

interface UserOption {
  id: string;
  fullName: string;
  roles: string[];
}

const COMMISSION_STATUSES = [
  { value: 'expected',             label: 'Expected' },
  { value: 'invoiced',             label: 'Invoiced' },
  { value: 'partially_collected',  label: 'Partially collected' },
  { value: 'collected',            label: 'Collected' },
  { value: 'waived',               label: 'Waived' },
  { value: 'lost',                 label: 'Lost' },
];

export default function DealDetailPage({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const { data: deal, isLoading } = useQuery({
    queryKey: ['deals', params.id],
    queryFn: () => api<DealDetail>(`/deals/${params.id}`),
  });

  const { data: users } = useQuery({
    queryKey: ['users-for-splits'],
    queryFn: () => api<UserOption[]>('/users'),
  });

  const updateSplits = useMutation({
    mutationFn: (splits: Array<{ recipientUserId?: string | null; label: string; percent: number }>) =>
      api(`/deals/${params.id}/splits`, {
        method: 'POST',
        body: JSON.stringify({ splits }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals', params.id] }),
    onError: (err) => setActionError((err as Error).message),
  });

  const [actionError, setActionError] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [showLostForm, setShowLostForm] = useState(false);

  const markWon = useMutation({
    mutationFn: () => api(`/deals/${params.id}/mark-won`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals', params.id] }),
    onError: (err) => setActionError((err as Error).message),
  });

  const markLost = useMutation({
    mutationFn: (reason: string) =>
      api(`/deals/${params.id}/mark-lost`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals', params.id] });
      setShowLostForm(false);
      setLostReason('');
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const updateCommission = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/deals/${params.id}/commission`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals', params.id] }),
    onError: (err) => setActionError((err as Error).message),
  });

  if (isLoading) return <p className="text-sm text-gray-medium">Loading…</p>;
  if (!deal) return <p className="text-sm text-danger">Deal not found.</p>;

  const c = deal.commission;
  const expected = c ? Number(c.expectedAmount) : 0;
  const collected = c ? Number(c.collectedAmount) : 0;
  const collectionPct = expected ? Math.min(100, (collected / expected) * 100) : 0;

  return (
    <div>
      <Link href="/deals" className="text-sm text-gray-medium hover:text-navy-deep">
        ← Back to Deals
      </Link>

      <header className="mb-6 mt-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill status={deal.status} />
            {deal.closedAt ? (
              <span className="text-xs text-gray-medium">
                closed {new Date(deal.closedAt).toLocaleDateString()}
              </span>
            ) : null}
          </div>
          <h1 className="mt-1">
            {deal.property.code} — {deal.property.name}
          </h1>
          <p className="text-sm text-gray-medium">
            {deal.lead.fullName ?? '(unnamed lead)'} ·{' '}
            <span className="font-mono">{deal.lead.phoneE164}</span>
          </p>
        </div>

        <div className="flex gap-2">
          {deal.status === 'open' || deal.status === 'negotiating' ? (
            <>
              <button
                onClick={() => markWon.mutate()}
                disabled={markWon.isPending}
                className="rounded-md bg-success px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {markWon.isPending ? 'Saving…' : 'Mark won'}
              </button>
              <button
                onClick={() => setShowLostForm(true)}
                className="rounded-md border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50"
              >
                Mark lost
              </button>
            </>
          ) : null}
        </div>
      </header>

      {actionError ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </div>
      ) : null}

      {showLostForm ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-red-800">Mark deal lost — reason?</h3>
          <input
            type="text"
            placeholder="e.g. Found cheaper option / Owner pulled / Lead unresponsive"
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            className="w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => markLost.mutate(lostReason)}
              disabled={!lostReason || markLost.isPending}
              className="rounded-md bg-danger px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {markLost.isPending ? 'Saving…' : 'Confirm lost'}
            </button>
            <button
              onClick={() => setShowLostForm(false)}
              className="rounded-md border border-gray-light px-3 py-2 text-sm font-semibold text-gray-dark hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* LEFT — terms */}
        <section className="space-y-4 xl:col-span-5">
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Terms</h3>
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <DealStat label="Rent" value={deal.rentAmount} />
              <DealStat label="Deposit" value={deal.depositAmount} />
              <DealStat label="Commission" value={deal.commissionAmount} />
              <div>
                <dt className="text-xs text-gray-medium">Paid by</dt>
                <dd className="font-semibold">{deal.commissionPaidBy ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-medium">Move-in</dt>
                <dd className="font-semibold">
                  {deal.moveInDate ? new Date(deal.moveInDate).toLocaleDateString() : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-medium">Duration</dt>
                <dd className="font-semibold">
                  {deal.rentalDurationMonths ? `${deal.rentalDurationMonths} months` : '—'}
                </dd>
              </div>
            </dl>

            {deal.lostReason ? (
              <div className="mt-4 rounded-md bg-red-50 p-3">
                <p className="text-xs font-semibold text-red-700">Lost reason</p>
                <p className="text-sm text-red-800">{deal.lostReason}</p>
              </div>
            ) : null}

            {deal.internalNotes ? (
              <div className="mt-4 border-t border-gray-light pt-3">
                <p className="text-xs font-semibold text-gray-medium">Internal notes</p>
                <p className="mt-1 text-sm text-gray-dark">{deal.internalNotes}</p>
              </div>
            ) : null}
          </div>

          {/* Actors */}
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Actors</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <span className="text-xs text-gray-medium">Lead:</span>{' '}
                <Link
                  href={`/leads/${deal.lead.id}`}
                  className="font-semibold text-navy-deep hover:underline"
                >
                  {deal.lead.fullName ?? deal.lead.phoneE164}
                </Link>
              </li>
              <li>
                <span className="text-xs text-gray-medium">Property:</span>{' '}
                <Link
                  href={`/properties/${deal.property.id}`}
                  className="font-semibold text-navy-deep hover:underline"
                >
                  {deal.property.code} — {deal.property.name}
                </Link>
              </li>
              <li>
                <span className="text-xs text-gray-medium">Field agent:</span>{' '}
                <span className="font-semibold">
                  {deal.fieldAgent?.user.fullName ?? '— unassigned —'}
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* RIGHT — commission */}
        <section className="space-y-4 xl:col-span-7">
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm uppercase tracking-wide text-gray-medium">Commission</h3>
              {c ? <StatusPill status={c.status} /> : null}
            </div>

            {c ? (
              <>
                <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-gray-medium">Expected</p>
                    <p className="text-2xl font-bold text-navy-deep">
                      AED {Number(c.expectedAmount).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-medium">Invoiced</p>
                    <p className="text-2xl font-bold text-navy-deep">
                      {c.invoicedAmount
                        ? `AED ${Number(c.invoicedAmount).toLocaleString()}`
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-medium">Collected</p>
                    <p className="text-2xl font-bold text-success">
                      AED {Number(c.collectedAmount).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="mb-4 h-2 overflow-hidden rounded-full bg-offwhite">
                  <div
                    className="h-full bg-success transition-all"
                    style={{ width: `${collectionPct}%` }}
                  />
                </div>
                <p className="text-right text-xs text-gray-medium">
                  {collectionPct.toFixed(0)}% collected
                </p>

                {c.invoicedAt ? (
                  <p className="mt-3 text-xs text-gray-medium">
                    Invoiced {new Date(c.invoicedAt).toLocaleDateString()}
                  </p>
                ) : null}
                {c.collectedAt ? (
                  <p className="text-xs text-gray-medium">
                    Last collection {new Date(c.collectedAt).toLocaleDateString()}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-gray-medium">No commission recorded yet.</p>
            )}

            <div className="mt-4 border-t border-gray-light pt-4">
              <UpdateCommissionForm
                current={c}
                onSubmit={(body) => updateCommission.mutate(body)}
                pending={updateCommission.isPending}
              />
            </div>
          </div>

          {/* Splits */}
          <SplitsEditor
            commissionAed={deal.commissionAmount ? Number(deal.commissionAmount) : null}
            currentSplits={deal.splits}
            users={users ?? []}
            defaultAgentUserId={deal.fieldAgent?.user ? null : null /* fieldAgent.user has no id in DealDetail */}
            onSave={(splits) => updateSplits.mutate(splits)}
            pending={updateSplits.isPending}
          />

          {/* Payments */}
          {c && c.payments.length > 0 ? (
            <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
              <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Payments</h3>
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-medium">
                  <tr>
                    <th className="pb-2">Amount</th>
                    <th className="pb-2">Method</th>
                    <th className="pb-2">Reference</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {c.payments.map((p) => (
                    <tr key={p.id} className="border-t border-gray-light">
                      <td className="py-2 font-semibold">
                        AED {Number(p.amount).toLocaleString()}
                      </td>
                      <td className="py-2 text-gray-dark">{p.method ?? '—'}</td>
                      <td className="py-2 font-mono text-xs">{p.reference ?? '—'}</td>
                      <td className="py-2">
                        <StatusPill status={p.status} />
                      </td>
                      <td className="py-2 text-xs text-gray-medium">
                        {p.paidAt ? new Date(p.paidAt).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

type DraftSplit = { recipientUserId: string | null; label: string; percent: string };

function SplitsEditor({
  commissionAed,
  currentSplits,
  users,
  onSave,
  pending,
}: {
  commissionAed: number | null;
  currentSplits: DealDetail['splits'];
  users: UserOption[];
  defaultAgentUserId: string | null;
  onSave: (splits: Array<{ recipientUserId?: string | null; label: string; percent: number }>) => void;
  pending: boolean;
}) {
  const initial: DraftSplit[] = currentSplits.length > 0
    ? currentSplits.map((s) => ({
        recipientUserId: s.recipientUserId,
        label: s.label,
        percent: String(Number(s.percent)),
      }))
    : [
        { recipientUserId: null, label: 'Platform', percent: '50' },
        { recipientUserId: '', label: 'Field agent', percent: '50' },
      ];

  const [drafts, setDrafts] = useState<DraftSplit[]>(initial);

  function update(idx: number, patch: Partial<DraftSplit>) {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }
  function addRow() {
    setDrafts((prev) => [...prev, { recipientUserId: '', label: '', percent: '0' }]);
  }
  function removeRow(idx: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  }

  const totalPct = drafts.reduce((acc, d) => acc + (Number(d.percent) || 0), 0);
  const valid = Math.abs(totalPct - 100) < 0.01 && drafts.every((d) => d.label.trim());

  function submit() {
    onSave(
      drafts.map((d) => ({
        recipientUserId: d.recipientUserId || null,
        label: d.label.trim(),
        percent: Number(d.percent),
      })),
    );
  }

  return (
    <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm uppercase tracking-wide text-gray-medium">Distribución de comisión</h3>
        <span className={`text-xs font-semibold ${Math.abs(totalPct - 100) < 0.01 ? 'text-success' : 'text-danger'}`}>
          {totalPct.toFixed(1)}% / 100
        </span>
      </div>

      <p className="mb-3 text-xs text-gray-medium">
        Quién recibe qué porcentaje de la comisión. Platform = la plataforma; el resto se asigna a usuarios. La suma debe ser 100.
      </p>

      <div className="space-y-2">
        {drafts.map((d, i) => {
          const isPlatform = d.recipientUserId === null;
          const aed = commissionAed ? (commissionAed * (Number(d.percent) || 0)) / 100 : null;
          return (
            <div key={i} className="grid grid-cols-12 items-center gap-2 rounded-md border border-gray-light p-2">
              <div className="col-span-4">
                <select
                  value={d.recipientUserId === null ? '__platform__' : d.recipientUserId}
                  onChange={(e) =>
                    update(i, {
                      recipientUserId: e.target.value === '__platform__' ? null : e.target.value,
                      label: e.target.value === '__platform__' ? 'Platform' : d.label || 'Field agent',
                    })
                  }
                  className="w-full rounded-md border border-gray-light bg-white px-2 py-1.5 text-xs focus:border-teal focus:outline-none"
                >
                  <option value="__platform__">Platform</option>
                  <option value="">— pick user —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                value={d.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder={isPlatform ? 'Platform' : 'Label (e.g. Field agent)'}
                className="col-span-4 rounded-md border border-gray-light bg-white px-2 py-1.5 text-xs focus:border-teal focus:outline-none"
              />
              <input
                type="number"
                value={d.percent}
                onChange={(e) => update(i, { percent: e.target.value })}
                placeholder="%"
                step="0.01"
                className="col-span-2 rounded-md border border-gray-light bg-white px-2 py-1.5 text-right text-xs focus:border-teal focus:outline-none"
              />
              <div className="col-span-1 text-right text-[10px] text-gray-medium">
                {aed !== null ? `AED ${aed.toFixed(0)}` : '—'}
              </div>
              <button
                onClick={() => removeRow(i)}
                disabled={drafts.length <= 1}
                title="Remove"
                className="col-span-1 text-xs text-gray-medium hover:text-danger disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex justify-between">
        <button
          onClick={addRow}
          className="rounded-md border border-gray-light px-3 py-1.5 text-xs font-semibold text-gray-dark hover:bg-offwhite"
        >
          + Agregar
        </button>
        <button
          onClick={submit}
          disabled={!valid || pending}
          className="rounded-md bg-teal px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
        >
          {pending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

function DealStat({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-gray-medium">{label}</dt>
      <dd className="text-lg font-bold text-navy-deep">
        {value ? `AED ${Number(value).toLocaleString()}` : '—'}
      </dd>
    </div>
  );
}

function UpdateCommissionForm({
  current,
  onSubmit,
  pending,
}: {
  current: DealDetail['commission'];
  onSubmit: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [status, setStatus] = useState(current?.status ?? 'expected');
  const [expectedAmount, setExpectedAmount] = useState(current?.expectedAmount ?? '');
  const [invoicedAmount, setInvoicedAmount] = useState(current?.invoicedAmount ?? '');
  const [collectedAmount, setCollectedAmount] = useState(current?.collectedAmount ?? '');
  const [notes, setNotes] = useState(current?.notes ?? '');

  return (
    <div>
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-medium">
        Update commission
      </h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-dark">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-md border border-gray-light px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
          >
            {COMMISSION_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-dark">Expected (AED)</label>
          <input
            type="number"
            value={expectedAmount}
            onChange={(e) => setExpectedAmount(e.target.value)}
            className="w-full rounded-md border border-gray-light px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-dark">Invoiced (AED)</label>
          <input
            type="number"
            value={invoicedAmount}
            onChange={(e) => setInvoicedAmount(e.target.value)}
            className="w-full rounded-md border border-gray-light px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-dark">Collected (AED)</label>
          <input
            type="number"
            value={collectedAmount}
            onChange={(e) => setCollectedAmount(e.target.value)}
            className="w-full rounded-md border border-gray-light px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
          />
        </div>
      </div>
      <label className="mt-3 mb-1 block text-xs font-semibold text-gray-dark">Notes</label>
      <textarea
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full rounded-md border border-gray-light bg-offwhite p-2.5 text-sm focus:border-teal focus:bg-white focus:outline-none"
      />
      <button
        onClick={() =>
          onSubmit({
            status,
            expectedAmount: expectedAmount ? Number(expectedAmount) : undefined,
            invoicedAmount: invoicedAmount ? Number(invoicedAmount) : undefined,
            collectedAmount: collectedAmount ? Number(collectedAmount) : undefined,
            notes: notes || undefined,
          })
        }
        disabled={pending}
        className="mt-3 w-full rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save commission'}
      </button>
    </div>
  );
}
