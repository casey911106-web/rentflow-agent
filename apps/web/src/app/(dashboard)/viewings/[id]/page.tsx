'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ScoreBadge, StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface ViewingDetail {
  id: string;
  status: string;
  assignmentStatus: string;
  scheduledAt: string;
  durationMinutes: number;
  arrivedAt: string | null;
  completedAt: string | null;
  outcomeNotes: string | null;
  cancelReason: string | null;
  property: {
    id: string;
    code: string;
    name: string;
    area: string | null;
    addressLine: string | null;
    priceAed: string | null;
    status: string;
    qualityScore: number;
  };
  lead: {
    id: string;
    fullName: string | null;
    phoneE164: string;
    status: string;
    temperature: string;
    qualificationScore: number;
    property: { id: string; code: string; name: string } | null;
  };
  fieldAgent: {
    id: string;
    performanceScore: number;
    user: { fullName: string; phoneE164: string | null };
  } | null;
  feedback: {
    rating: number | null;
    comments: string | null;
    bookingIntent: string | null;
  } | null;
}

interface FieldAgent {
  id: string;
  user: { fullName: string };
  performanceScore: number;
}

interface DealRow {
  id: string;
  lead: { id: string };
}

const STATUS_TRANSITIONS: Array<{ to: string; label: string; tone: 'primary' | 'secondary' | 'danger' | 'ghost' }> = [
  { to: 'confirmed',  label: 'Confirm',          tone: 'ghost' },
  { to: 'completed',  label: 'Mark completed',   tone: 'primary' },
  { to: 'no_show',    label: 'No-show',          tone: 'ghost' },
  { to: 'converted',  label: 'Lead interested',  tone: 'secondary' },
  { to: 'lost',       label: 'Mark lost',        tone: 'danger' },
  { to: 'cancelled',  label: 'Cancel viewing',   tone: 'danger' },
];

export default function ViewingDetailPage({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const { data: viewing, isLoading } = useQuery({
    queryKey: ['viewings', params.id],
    queryFn: () => api<ViewingDetail>(`/viewings/${params.id}`),
  });

  const { data: agents } = useQuery({
    queryKey: ['field-agents'],
    queryFn: () => api<FieldAgent[]>('/field-agents'),
  });

  const { data: deals } = useQuery({
    queryKey: ['deals'],
    queryFn: () => api<DealRow[]>('/deals'),
    enabled: !!viewing,
  });

  const [actionError, setActionError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);

  const transitionStatus = useMutation({
    mutationFn: (status: string) =>
      api(`/viewings/${params.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, notes: notesDraft || undefined }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['viewings', params.id] });
      setNotesDirty(false);
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const assignAgent = useMutation({
    mutationFn: (fieldAgentId: string) =>
      api(`/viewings/${params.id}/assign-agent`, {
        method: 'POST',
        body: JSON.stringify({ fieldAgentId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['viewings', params.id] }),
    onError: (err) => setActionError((err as Error).message),
  });

  if (isLoading) return <p className="text-sm text-gray-medium">Loading…</p>;
  if (!viewing) return <p className="text-sm text-danger">Viewing not found.</p>;

  const existingDeal = deals?.find((d) => d.lead.id === viewing.lead.id);
  const showCreateDeal = !existingDeal && (viewing.status === 'converted' || viewing.status === 'completed');

  return (
    <div>
      <Link href="/viewings" className="text-sm text-gray-medium hover:text-navy-deep">
        ← Back to Viewings
      </Link>

      <header className="mb-6 mt-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill status={viewing.status} />
            <span className="text-xs text-gray-medium">
              assignment: <strong className="text-gray-dark">{viewing.assignmentStatus}</strong>
            </span>
          </div>
          <h1 className="mt-1">{viewing.property.code} — {viewing.property.name}</h1>
          <p className="text-sm text-gray-medium">
            {new Date(viewing.scheduledAt).toLocaleString()} · {viewing.durationMinutes} min
          </p>
        </div>
      </header>

      {actionError ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* LEFT — actors */}
        <aside className="space-y-4 xl:col-span-4">
          {/* Lead */}
          <section className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Lead</h3>
            <Link
              href={`/leads/${viewing.lead.id}`}
              className="block font-semibold text-navy-deep hover:underline"
            >
              {viewing.lead.fullName ?? '(unnamed)'}
            </Link>
            <p className="mt-0.5 font-mono text-xs text-gray-medium">{viewing.lead.phoneE164}</p>
            <div className="mt-3 flex items-center gap-2">
              <StatusPill status={viewing.lead.status} />
              <StatusPill status={viewing.lead.temperature} />
              <ScoreBadge score={viewing.lead.qualificationScore} />
            </div>
          </section>

          {/* Property */}
          <section className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Property</h3>
            <Link
              href={`/properties/${viewing.property.id}`}
              className="block font-semibold text-navy-deep hover:underline"
            >
              {viewing.property.code} — {viewing.property.name}
            </Link>
            <p className="mt-0.5 text-xs text-gray-medium">
              {viewing.property.area ?? '—'}
              {viewing.property.addressLine ? ` · ${viewing.property.addressLine}` : ''}
            </p>
            <p className="mt-2 text-lg font-bold text-navy-deep">
              {viewing.property.priceAed
                ? `AED ${Number(viewing.property.priceAed).toLocaleString()}`
                : '—'}
            </p>
            <div className="mt-2">
              <StatusPill status={viewing.property.status} />
            </div>
          </section>

          {/* Agent */}
          <section className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Field agent</h3>
            {viewing.fieldAgent ? (
              <>
                <p className="font-semibold">{viewing.fieldAgent.user.fullName}</p>
                {viewing.fieldAgent.user.phoneE164 ? (
                  <p className="text-xs text-gray-medium">{viewing.fieldAgent.user.phoneE164}</p>
                ) : null}
                <div className="mt-2">
                  <ScoreBadge score={viewing.fieldAgent.performanceScore} label="Perf" />
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-medium">— unassigned —</p>
            )}

            <label className="mt-4 block text-xs font-semibold text-gray-dark">Reassign</label>
            <select
              defaultValue={viewing.fieldAgent?.id ?? ''}
              onChange={(e) => {
                if (e.target.value) assignAgent.mutate(e.target.value);
              }}
              disabled={assignAgent.isPending}
              className="mt-1 w-full rounded-md border border-gray-light px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
            >
              <option value="">Pick an agent…</option>
              {(agents ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.user.fullName} (perf {a.performanceScore})
                </option>
              ))}
            </select>
          </section>
        </aside>

        {/* CENTER — outcome + status */}
        <section className="space-y-4 xl:col-span-5">
          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Status timeline</h3>
            <ul className="space-y-1 text-sm text-gray-dark">
              <li>📅 Scheduled: {new Date(viewing.scheduledAt).toLocaleString()}</li>
              {viewing.arrivedAt ? <li>📍 Arrived: {new Date(viewing.arrivedAt).toLocaleString()}</li> : null}
              {viewing.completedAt ? (
                <li>✅ Completed: {new Date(viewing.completedAt).toLocaleString()}</li>
              ) : null}
              {viewing.cancelReason ? (
                <li className="text-danger">✗ Cancelled: {viewing.cancelReason}</li>
              ) : null}
            </ul>
          </div>

          <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Outcome notes</h3>
            <textarea
              rows={4}
              placeholder="Notes from the agent / operator about this viewing…"
              defaultValue={viewing.outcomeNotes ?? ''}
              onChange={(e) => {
                setNotesDraft(e.target.value);
                setNotesDirty(true);
              }}
              className="w-full rounded-md border border-gray-light bg-offwhite p-3 text-sm focus:border-teal focus:bg-white focus:outline-none"
            />
            {notesDirty ? (
              <p className="mt-1 text-xs text-gray-medium">
                Notes will be saved when you transition the status next.
              </p>
            ) : null}
          </div>

          {viewing.feedback ? (
            <div className="rounded-md border border-gray-light bg-white p-5 shadow-card">
              <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Lead feedback</h3>
              {viewing.feedback.rating ? (
                <p className="text-2xl">
                  {'★'.repeat(viewing.feedback.rating)}
                  <span className="text-gray-light">{'★'.repeat(5 - viewing.feedback.rating)}</span>
                </p>
              ) : null}
              {viewing.feedback.comments ? (
                <p className="mt-2 text-sm text-gray-dark">"{viewing.feedback.comments}"</p>
              ) : null}
              {viewing.feedback.bookingIntent ? (
                <p className="mt-2 text-xs text-gray-medium">
                  Booking intent: <strong className="text-gray-dark">{viewing.feedback.bookingIntent}</strong>
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* RIGHT — actions */}
        <aside className="space-y-4 xl:col-span-3">
          <section className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Update status</h3>
            <div className="space-y-2">
              {STATUS_TRANSITIONS.map((s) => {
                const tone =
                  s.tone === 'primary'
                    ? 'bg-teal text-white hover:bg-[#008C8A]'
                    : s.tone === 'secondary'
                      ? 'bg-secondary text-white hover:bg-navy-deep'
                      : s.tone === 'danger'
                        ? 'border border-red-200 text-red-700 hover:bg-red-50'
                        : 'border border-gray-light text-gray-dark hover:bg-offwhite';
                const active = viewing.status === s.to;
                return (
                  <button
                    key={s.to}
                    onClick={() => transitionStatus.mutate(s.to)}
                    disabled={active || transitionStatus.isPending}
                    className={`w-full rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50 ${tone}`}
                  >
                    {active ? `Already ${s.to.replace(/_/g, ' ')}` : s.label}
                  </button>
                );
              })}
            </div>
          </section>

          {existingDeal ? (
            <section className="rounded-md border border-emerald-200 bg-emerald-50 p-5">
              <h3 className="mb-2 text-sm uppercase tracking-wide text-emerald-800">Deal exists</h3>
              <Link
                href={`/deals/${existingDeal.id}`}
                className="text-sm font-semibold text-emerald-800 hover:underline"
              >
                Open deal →
              </Link>
            </section>
          ) : showCreateDeal ? (
            <CreateDealForm
              leadId={viewing.lead.id}
              property={viewing.property}
              onSuccess={(dealId) => {
                qc.invalidateQueries({ queryKey: ['deals'] });
                qc.invalidateQueries({ queryKey: ['viewings', params.id] });
                window.location.href = `/deals/${dealId}`;
              }}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function CreateDealForm({
  leadId,
  property,
  onSuccess,
}: {
  leadId: string;
  property: { priceAed: string | null };
  onSuccess: (dealId: string) => void;
}) {
  const defaultRent = property.priceAed ? Number(property.priceAed) : 0;
  const [rentAmount, setRentAmount] = useState(defaultRent.toString());
  const [depositAmount, setDepositAmount] = useState(defaultRent.toString());
  const [commissionAmount, setCommissionAmount] = useState((defaultRent * 0.5).toString());
  const [commissionPaidBy, setCommissionPaidBy] = useState('tenant');
  const [moveInDate, setMoveInDate] = useState('');
  const [duration, setDuration] = useState('6');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/deals', {
        method: 'POST',
        body: JSON.stringify({
          leadId,
          rentAmount: rentAmount ? Number(rentAmount) : undefined,
          depositAmount: depositAmount ? Number(depositAmount) : undefined,
          commissionAmount: commissionAmount ? Number(commissionAmount) : undefined,
          commissionPaidBy,
          moveInDate: moveInDate ? new Date(moveInDate).toISOString() : undefined,
          rentalDurationMonths: duration ? Number(duration) : undefined,
        }),
      }),
    onSuccess: (deal) => onSuccess(deal.id),
    onError: (err) => setError((err as Error).message),
  });

  return (
    <section className="rounded-md border border-teal/30 bg-teal-light p-5">
      <h3 className="mb-3 text-sm uppercase tracking-wide text-navy-deep">Create deal</h3>
      <p className="mb-3 text-xs text-navy-deep">
        Lead is converted. Record the deal terms; it'll start as <strong>open</strong> and you can mark won/lost from the deal page.
      </p>

      {error ? (
        <p className="mb-2 rounded-md bg-red-50 p-2 text-xs text-red-800">{error}</p>
      ) : null}

      <DealField label="Rent (AED)" type="number" value={rentAmount} onChange={setRentAmount} />
      <DealField label="Deposit (AED)" type="number" value={depositAmount} onChange={setDepositAmount} />
      <DealField label="Commission (AED)" type="number" value={commissionAmount} onChange={setCommissionAmount} />

      <label className="mb-1 block text-xs font-semibold text-navy-deep">Commission paid by</label>
      <select
        value={commissionPaidBy}
        onChange={(e) => setCommissionPaidBy(e.target.value)}
        className="mb-3 w-full rounded-md border border-gray-light bg-white px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
      >
        <option value="tenant">Tenant</option>
        <option value="owner">Owner</option>
        <option value="split">Split</option>
      </select>

      <DealField label="Move-in date" type="date" value={moveInDate} onChange={setMoveInDate} />
      <DealField label="Duration (months)" type="number" value={duration} onChange={setDuration} />

      <button
        onClick={() => create.mutate()}
        disabled={create.isPending}
        className="mt-2 w-full rounded-md bg-teal px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
      >
        {create.isPending ? 'Creating…' : 'Create deal'}
      </button>
    </section>
  );
}

function DealField({
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
      <label className="mb-1 block text-xs font-semibold text-navy-deep">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-light bg-white px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
      />
    </div>
  );
}
