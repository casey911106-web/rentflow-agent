'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ScoreBadge, StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface LeadDetail {
  id: string;
  fullName: string | null;
  phoneE164: string;
  status: string;
  temperature: string;
  qualificationScore: number;
  attributionConfidence: string;
  budgetAed: string | null;
  preferredArea: string | null;
  peopleCount: number | null;
  moveInDate: string | null;
  rentalDurationMonths: number | null;
  firstSeenAt: string;
  lastInteractionAt: string | null;
  property: {
    id: string;
    code: string;
    name: string;
    area: string | null;
    priceAed: string | null;
    status: string;
    qualityScore: number;
    readinessScore: number;
  } | null;
  postPackage: {
    id: string;
    title: string | null;
    channelName: string | null;
    trackingLink: { sourceCode: string; postCode: string } | null;
  } | null;
  source: {
    channel: string;
    channelName: string | null;
    sourceCode: string | null;
    postCode: string | null;
    rawText: string | null;
  } | null;
  whatsappConversation: {
    id: string;
    mode: string;
    lastInboundAt: string | null;
    messages: Array<{
      id: string;
      direction: 'inbound' | 'outbound';
      type: string;
      body: string | null;
      providerStatus: string | null;
      createdAt: string;
    }>;
  } | null;
  viewings: Array<{
    id: string;
    status: string;
    scheduledAt: string;
    fieldAgent: { user: { fullName: string } } | null;
  }>;
  deal: {
    id: string;
    status: string;
    rentAmount: string | null;
    commissionAmount: string | null;
    commission: { status: string; collectedAmount: string } | null;
  } | null;
  messages: Array<{
    id: string;
    direction: 'inbound' | 'outbound';
    channel: string;
    body: string;
    createdAt: string;
  }>;
}

interface FieldAgent {
  id: string;
  user: { fullName: string };
  performanceScore: number;
}

const STATUS_TRANSITIONS: Array<{ to: string; label: string; tone: 'primary' | 'secondary' | 'danger' | 'ghost' }> = [
  { to: 'qualifying',         label: 'Mark qualifying',  tone: 'ghost' },
  { to: 'qualified',          label: 'Mark qualified',   tone: 'primary' },
  { to: 'options_sent',       label: 'Options sent',     tone: 'ghost' },
  { to: 'cold',               label: 'Mark cold',        tone: 'ghost' },
  { to: 'opted_out',          label: 'Mark opted out',   tone: 'danger' },
];

export default function LeadDetailPage({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const { data: lead, isLoading } = useQuery({
    queryKey: ['leads', params.id],
    queryFn: () => api<LeadDetail>(`/leads/${params.id}`),
    refetchInterval: 5_000,
  });

  const { data: agents } = useQuery({
    queryKey: ['field-agents'],
    queryFn: () => api<FieldAgent[]>('/field-agents'),
  });

  const [editFields, setEditFields] = useState({
    fullName: '',
    budgetAed: '',
    preferredArea: '',
    peopleCount: '',
    moveInDate: '',
    rentalDurationMonths: '',
  });
  const [fieldsDirty, setFieldsDirty] = useState(false);

  const [composeText, setComposeText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lead) {
      setEditFields({
        fullName: lead.fullName ?? '',
        budgetAed: lead.budgetAed ?? '',
        preferredArea: lead.preferredArea ?? '',
        peopleCount: lead.peopleCount?.toString() ?? '',
        moveInDate: lead.moveInDate ? lead.moveInDate.slice(0, 10) : '',
        rentalDurationMonths: lead.rentalDurationMonths?.toString() ?? '',
      });
      setFieldsDirty(false);
    }
  }, [lead]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lead?.whatsappConversation?.messages.length]);

  const updateLead = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/leads/${params.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads', params.id] });
      setFieldsDirty(false);
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const transitionStatus = useMutation({
    mutationFn: (status: string) =>
      api(`/leads/${params.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', params.id] }),
    onError: (err) => setActionError((err as Error).message),
  });

  const sendMessage = useMutation({
    mutationFn: (text: string) =>
      api(`/whatsapp/conversations/${lead?.whatsappConversation?.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      setComposeText('');
      qc.invalidateQueries({ queryKey: ['leads', params.id] });
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const setMode = useMutation({
    mutationFn: (mode: 'human_takeover' | 'ai') =>
      api(
        `/whatsapp/conversations/${lead?.whatsappConversation?.id}/${mode === 'human_takeover' ? 'human-takeover' : 'release-to-ai'}`,
        { method: 'POST' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads', params.id] }),
    onError: (err) => setActionError((err as Error).message),
  });

  function setField(key: keyof typeof editFields, value: string) {
    setEditFields((prev) => ({ ...prev, [key]: value }));
    setFieldsDirty(true);
  }

  function saveFields() {
    const body: Record<string, unknown> = {
      fullName: editFields.fullName || null,
      preferredArea: editFields.preferredArea || null,
      budgetAed: editFields.budgetAed ? Number(editFields.budgetAed) : null,
      peopleCount: editFields.peopleCount ? Number(editFields.peopleCount) : null,
      rentalDurationMonths: editFields.rentalDurationMonths ? Number(editFields.rentalDurationMonths) : null,
      moveInDate: editFields.moveInDate ? new Date(editFields.moveInDate).toISOString() : null,
    };
    updateLead.mutate(body);
  }

  if (isLoading) return <p className="text-sm text-gray-medium">Loading…</p>;
  if (!lead) return <p className="text-sm text-danger">Lead not found.</p>;

  const conv = lead.whatsappConversation;

  return (
    <div>
      <Link href="/leads" className="text-sm text-gray-medium hover:text-navy-deep">
        ← Back to Leads
      </Link>

      <header className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill status={lead.status} />
            <StatusPill status={lead.temperature} />
            <ScoreBadge score={lead.qualificationScore} label="Score" />
            {lead.attributionConfidence !== 'none' ? (
              <span className="text-xs text-gray-medium">
                attribution: <strong className="text-gray-dark">{lead.attributionConfidence}</strong>
              </span>
            ) : null}
          </div>
          <h1 className="mt-1">{lead.fullName ?? '(unnamed lead)'}</h1>
          <p className="text-sm text-gray-medium">
            <span className="font-mono">{lead.phoneE164}</span>
            {' · '}
            first seen {new Date(lead.firstSeenAt).toLocaleString()}
          </p>
        </div>
      </header>

      {actionError ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* LEFT — qualification + actions */}
        <aside className="space-y-4 xl:col-span-3">
          <section className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm uppercase tracking-wide text-gray-medium">Qualification</h3>
              {fieldsDirty ? (
                <button
                  onClick={saveFields}
                  disabled={updateLead.isPending}
                  className="rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
                >
                  {updateLead.isPending ? 'Saving…' : 'Save'}
                </button>
              ) : null}
            </div>

            <Field label="Full name" value={editFields.fullName} onChange={(v) => setField('fullName', v)} />
            <Field
              label="Budget (AED)"
              type="number"
              value={editFields.budgetAed}
              onChange={(v) => setField('budgetAed', v)}
            />
            <Field
              label="Preferred area"
              value={editFields.preferredArea}
              onChange={(v) => setField('preferredArea', v)}
            />
            <Field
              label="People"
              type="number"
              value={editFields.peopleCount}
              onChange={(v) => setField('peopleCount', v)}
            />
            <Field
              label="Move-in date"
              type="date"
              value={editFields.moveInDate}
              onChange={(v) => setField('moveInDate', v)}
            />
            <Field
              label="Rental duration (months)"
              type="number"
              value={editFields.rentalDurationMonths}
              onChange={(v) => setField('rentalDurationMonths', v)}
            />
          </section>

          <section className="rounded-md border border-gray-light bg-white p-5 shadow-card">
            <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Status</h3>
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
                const active = lead.status === s.to;
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
        </aside>

        {/* CENTER — WhatsApp thread */}
        <section className="xl:col-span-6">
          <div className="flex h-[640px] flex-col rounded-md border border-gray-light bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-gray-light px-5 py-3">
              <div>
                <h3 className="text-sm font-semibold text-navy-deep">WhatsApp conversation</h3>
                <p className="text-xs text-gray-medium">
                  {conv ? (
                    <>
                      Mode: <StatusPill status={conv.mode} />{' '}
                      {conv.lastInboundAt
                        ? `· last inbound ${new Date(conv.lastInboundAt).toLocaleString()}`
                        : ''}
                    </>
                  ) : (
                    'No WhatsApp conversation yet.'
                  )}
                </p>
              </div>
              {conv ? (
                <div className="flex gap-2">
                  <Link
                    href={`/whatsapp?c=${conv.id}`}
                    className="rounded-md border border-gray-light bg-white px-3 py-1.5 text-xs font-semibold text-gray-dark hover:bg-offwhite"
                  >
                    Abrir en Inbox →
                  </Link>
                  {conv.mode === 'ai' ? (
                    <button
                      onClick={() => setMode.mutate('human_takeover')}
                      disabled={setMode.isPending}
                      className="rounded-md border border-violet-300 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                    >
                      Take over
                    </button>
                  ) : conv.mode === 'human_takeover' ? (
                    <button
                      onClick={() => setMode.mutate('ai')}
                      disabled={setMode.isPending}
                      className="rounded-md border border-teal px-3 py-1.5 text-xs font-semibold text-teal hover:bg-teal-light"
                    >
                      Release to AI
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {!conv || conv.messages.length === 0 ? (
                <p className="text-center text-sm text-gray-medium">No messages yet.</p>
              ) : (
                <div className="space-y-3">
                  {conv.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm shadow-sm ${
                          m.direction === 'inbound'
                            ? 'bg-offwhite text-near-black'
                            : 'bg-teal-light text-navy-deep border border-teal/20'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{m.body ?? <em>(non-text message)</em>}</p>
                        <p className="mt-1 text-right text-[10px] text-gray-medium">
                          {new Date(m.createdAt).toLocaleString()}
                          {m.direction === 'outbound' && m.providerStatus
                            ? ` · ${m.providerStatus}`
                            : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={threadEndRef} />
                </div>
              )}
            </div>

            {conv && conv.mode !== 'closed' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (composeText.trim()) sendMessage.mutate(composeText.trim());
                }}
                className="border-t border-gray-light p-3"
              >
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={composeText}
                    onChange={(e) => setComposeText(e.target.value)}
                    placeholder={
                      conv.mode === 'human_takeover'
                        ? 'Type your reply…'
                        : 'AI is handling this. Take over to send manually.'
                    }
                    disabled={sendMessage.isPending || conv.mode === 'ai'}
                    className="flex-1 rounded-md border border-gray-light px-3 py-2 text-sm focus:border-teal focus:outline-none disabled:bg-offwhite"
                  />
                  <button
                    type="submit"
                    disabled={!composeText.trim() || sendMessage.isPending || conv.mode === 'ai'}
                    className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </section>

        {/* RIGHT — property + attribution + viewing + deal */}
        <aside className="space-y-4 xl:col-span-3">
          {/* Property */}
          {lead.property ? (
            <section className="rounded-md border border-gray-light bg-white p-5 shadow-card">
              <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Property</h3>
              <Link
                href={`/properties/${lead.property.id}`}
                className="block font-semibold text-navy-deep hover:underline"
              >
                {lead.property.code} — {lead.property.name}
              </Link>
              <p className="mt-1 text-xs text-gray-medium">{lead.property.area ?? '—'}</p>
              <p className="mt-2 text-lg font-bold text-navy-deep">
                {lead.property.priceAed
                  ? `AED ${Number(lead.property.priceAed).toLocaleString()}`
                  : '—'}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <StatusPill status={lead.property.status} />
                <ScoreBadge score={lead.property.readinessScore} label="R" />
                <ScoreBadge score={lead.property.qualityScore} label="Q" />
              </div>
            </section>
          ) : null}

          {/* Attribution */}
          {lead.source || lead.postPackage ? (
            <section className="rounded-md border border-gray-light bg-white p-5 shadow-card">
              <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Attribution</h3>
              {lead.postPackage ? (
                <p className="text-sm">
                  Post package:{' '}
                  <Link
                    href={`/posting/${lead.postPackage.id}`}
                    className="font-semibold text-teal hover:underline"
                  >
                    {lead.postPackage.title ?? '(unnamed)'}
                  </Link>
                </p>
              ) : null}
              {lead.source ? (
                <dl className="mt-2 space-y-1 text-xs">
                  <div>
                    <dt className="inline text-gray-medium">Channel:</dt>{' '}
                    <dd className="inline font-mono">{lead.source.channelName ?? lead.source.channel}</dd>
                  </div>
                  {lead.source.sourceCode ? (
                    <div>
                      <dt className="inline text-gray-medium">Source:</dt>{' '}
                      <dd className="inline font-mono">{lead.source.sourceCode}</dd>
                    </div>
                  ) : null}
                  {lead.source.postCode ? (
                    <div>
                      <dt className="inline text-gray-medium">Post:</dt>{' '}
                      <dd className="inline font-mono">{lead.source.postCode}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </section>
          ) : null}

          {/* Schedule viewing */}
          {lead.property && lead.status !== 'won' && lead.status !== 'lost' && lead.status !== 'opted_out' ? (
            <ScheduleViewingForm
              leadId={lead.id}
              propertyId={lead.property.id}
              agents={agents ?? []}
              onSuccess={() => qc.invalidateQueries({ queryKey: ['leads', params.id] })}
            />
          ) : null}

          {/* Viewings */}
          {lead.viewings.length > 0 ? (
            <section className="rounded-md border border-gray-light bg-white p-5 shadow-card">
              <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Viewings</h3>
              <ul className="space-y-2">
                {lead.viewings.map((v) => (
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
            </section>
          ) : null}

          {/* Deal */}
          {lead.deal ? (
            <section className="rounded-md border border-gray-light bg-white p-5 shadow-card">
              <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Deal</h3>
              <Link
                href={`/deals/${lead.deal.id}`}
                className="block rounded-md border border-gray-light p-3 hover:bg-offwhite"
              >
                <div className="flex items-center justify-between">
                  <StatusPill status={lead.deal.status} />
                  <span className="font-semibold">
                    {lead.deal.commissionAmount
                      ? `AED ${Number(lead.deal.commissionAmount).toLocaleString()}`
                      : '—'}
                  </span>
                </div>
                {lead.deal.commission ? (
                  <p className="mt-2 text-xs text-gray-medium">
                    commission: {lead.deal.commission.status} · collected{' '}
                    AED {Number(lead.deal.commission.collectedAmount).toLocaleString()}
                  </p>
                ) : null}
              </Link>
            </section>
          ) : lead.property && lead.status !== 'won' && lead.status !== 'lost' && lead.status !== 'opted_out' ? (
            <CloseAsWonForm
              leadId={lead.id}
              defaultRentAed={lead.property.priceAed}
              onSuccess={() => qc.invalidateQueries({ queryKey: ['leads', params.id] })}
            />
          ) : null}
        </aside>
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

function ScheduleViewingForm({
  leadId,
  propertyId,
  agents,
  onSuccess,
}: {
  leadId: string;
  propertyId: string;
  agents: FieldAgent[];
  onSuccess: () => void;
}) {
  const [scheduledAt, setScheduledAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [fieldAgentId, setFieldAgentId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api('/viewings', {
        method: 'POST',
        body: JSON.stringify({
          leadId,
          propertyId,
          scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes: Number(durationMinutes),
          fieldAgentId: fieldAgentId || undefined,
        }),
      }),
    onSuccess: () => {
      setScheduledAt('');
      setFieldAgentId('');
      setError(null);
      onSuccess();
    },
    onError: (err) => setError((err as Error).message),
  });

  return (
    <section className="rounded-md border border-gray-light bg-white p-5 shadow-card">
      <h3 className="mb-3 text-sm uppercase tracking-wide text-gray-medium">Schedule viewing</h3>

      {error ? (
        <p className="mb-2 rounded-md bg-red-50 p-2 text-xs text-red-800">{error}</p>
      ) : null}

      <label className="mb-1 block text-xs font-semibold text-gray-dark">When</label>
      <input
        type="datetime-local"
        value={scheduledAt}
        onChange={(e) => setScheduledAt(e.target.value)}
        className="mb-3 w-full rounded-md border border-gray-light px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
      />

      <label className="mb-1 block text-xs font-semibold text-gray-dark">Duration (min)</label>
      <select
        value={durationMinutes}
        onChange={(e) => setDurationMinutes(e.target.value)}
        className="mb-3 w-full rounded-md border border-gray-light px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
      >
        <option value="15">15 min</option>
        <option value="30">30 min</option>
        <option value="45">45 min</option>
        <option value="60">60 min</option>
      </select>

      <label className="mb-1 block text-xs font-semibold text-gray-dark">Field agent</label>
      <select
        value={fieldAgentId}
        onChange={(e) => setFieldAgentId(e.target.value)}
        className="mb-3 w-full rounded-md border border-gray-light px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
      >
        <option value="">Unassigned (assign later)</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.user.fullName} (perf {a.performanceScore})
          </option>
        ))}
      </select>

      <button
        onClick={() => create.mutate()}
        disabled={!scheduledAt || create.isPending}
        className="w-full rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
      >
        {create.isPending ? 'Scheduling…' : 'Schedule viewing'}
      </button>
    </section>
  );
}

function CloseAsWonForm({
  leadId,
  defaultRentAed,
  onSuccess,
}: {
  leadId: string;
  defaultRentAed: string | null;
  onSuccess: () => void;
}) {
  const [rentAed, setRentAed] = useState(defaultRentAed ?? '');
  const [commissionAed, setCommissionAed] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = useMutation({
    mutationFn: async () => {
      const deal = await api<{ id: string }>('/deals', {
        method: 'POST',
        body: JSON.stringify({
          leadId,
          rentAmount: rentAed ? Number(rentAed) : undefined,
          commissionAmount: Number(commissionAed),
        }),
      });
      await api(`/deals/${deal.id}/mark-won`, { method: 'POST' });
      return deal;
    },
    onSuccess: () => {
      setError(null);
      onSuccess();
    },
    onError: (err) => setError((err as Error).message),
  });

  const commissionValid = commissionAed && Number(commissionAed) > 0;

  return (
    <section className="rounded-md border border-teal/30 bg-teal-light/40 p-5 shadow-card">
      <h3 className="mb-1 text-sm uppercase tracking-wide text-navy-deep">Cerrar como ganado</h3>
      <p className="mb-3 text-xs text-gray-medium">
        Crea el deal + lo marca como won + setea la comisión esperada.
      </p>

      {error ? (
        <p className="mb-2 rounded-md bg-red-50 p-2 text-xs text-red-800">{error}</p>
      ) : null}

      <label className="mb-1 block text-xs font-semibold text-gray-dark">Rent (AED)</label>
      <input
        type="number"
        value={rentAed}
        onChange={(e) => setRentAed(e.target.value)}
        placeholder={defaultRentAed ?? 'optional'}
        className="mb-3 w-full rounded-md border border-gray-light px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
      />

      <label className="mb-1 block text-xs font-semibold text-gray-dark">Comisión (AED) *</label>
      <input
        type="number"
        value={commissionAed}
        onChange={(e) => setCommissionAed(e.target.value)}
        placeholder="1000"
        className="mb-3 w-full rounded-md border border-gray-light px-2.5 py-1.5 text-sm focus:border-teal focus:outline-none"
      />

      <button
        onClick={() => close.mutate()}
        disabled={!commissionValid || close.isPending}
        className="w-full rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
      >
        {close.isPending ? 'Cerrando…' : 'Cerrar como ganado'}
      </button>
    </section>
  );
}
