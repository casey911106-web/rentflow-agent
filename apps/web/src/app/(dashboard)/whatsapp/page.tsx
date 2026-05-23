'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface ConversationRow {
  id: string;
  leadPhoneE164: string;
  mode: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lead: { id: string; fullName: string | null; status: string; temperature: string } | null;
  _count: { messages: number };
}

interface WAMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  body: string | null;
  createdAt: string;
  providerStatus: string | null;
}

interface ConversationDetail {
  id: string;
  leadPhoneE164: string;
  mode: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  messages: WAMessage[];
  lead:
    | (ConversationRow['lead'] & {
        id: string;
        propertyId: string | null;
        property: { id: string; code: string; name: string; status: string } | null;
      })
    | null;
}

interface PendingSuggestion {
  id: string;
  state: string;
  suggestedReply: string;
  confidence: number | null;
  conversation: { id: string };
}

const FILTERS = [
  { key: 'all', label: 'Todo' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'human', label: 'Humano' },
  { key: 'ai', label: 'AI' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

export default function InboxPage() {
  const router = useRouter();
  const search = useSearchParams();
  const deepLinkId = search.get('c');
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkId);
  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => {
    if (deepLinkId && deepLinkId !== selectedId) setSelectedId(deepLinkId);
  }, [deepLinkId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<ConversationRow[]>('/whatsapp/conversations'),
    refetchInterval: 10_000,
  });

  const { data: pendingSuggestions } = useQuery({
    queryKey: ['suggestions', 'pending'],
    queryFn: () => api<PendingSuggestion[]>('/suggestions?status=pending'),
    refetchInterval: 10_000,
  });

  const pendingByConv = useMemo(() => {
    const m = new Map<string, PendingSuggestion>();
    (pendingSuggestions ?? []).forEach((s) => m.set(s.conversation.id, s));
    return m;
  }, [pendingSuggestions]);

  const filtered = useMemo(() => {
    if (!conversations) return [];
    return conversations.filter((c) => {
      if (filter === 'pending') return pendingByConv.has(c.id);
      if (filter === 'human') return c.mode === 'human_takeover';
      if (filter === 'ai') return c.mode === 'ai';
      return true;
    });
  }, [conversations, filter, pendingByConv]);

  function pick(id: string) {
    setSelectedId(id);
    const params = new URLSearchParams(search.toString());
    params.set('c', id);
    router.replace(`/whatsapp?${params.toString()}`, { scroll: false });
  }

  return (
    <div>
      <header className="mb-4">
        <h1>Inbox</h1>
        <p className="mt-1 text-sm text-gray-medium">
          Todas las conversaciones en un lugar. Tomá manual o devolvé a la IA cuando quieras.
        </p>
      </header>

      <div className="flex h-[calc(100vh-200px)] min-h-[520px] overflow-hidden rounded-md border border-gray-light bg-white shadow-card">
        {/* Left pane — list */}
        <aside className={`flex w-full flex-col border-r border-gray-light md:w-[360px] md:shrink-0 ${selectedId ? 'hidden md:flex' : 'flex'}`}>
          <div className="border-b border-gray-light px-3 py-2">
            <div className="flex gap-1 overflow-x-auto">
              {FILTERS.map((f) => {
                const count = f.key === 'pending' ? pendingByConv.size : null;
                const active = filter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      active ? 'bg-teal text-white' : 'bg-offwhite text-gray-dark hover:bg-gray-light'
                    }`}
                  >
                    {f.label}{count !== null ? ` · ${count}` : ''}
                  </button>
                );
              })}
            </div>
          </div>

          <ul className="flex-1 overflow-y-auto">
            {!conversations ? (
              <li className="px-4 py-6 text-sm text-gray-medium">Cargando…</li>
            ) : filtered.length === 0 ? (
              <li className="px-4 py-6 text-sm text-gray-medium">No hay conversaciones para este filtro.</li>
            ) : (
              filtered.map((c) => {
                const pending = pendingByConv.get(c.id);
                const active = selectedId === c.id;
                const lastAt = c.lastInboundAt ?? c.lastOutboundAt;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => pick(c.id)}
                      className={`w-full border-b border-gray-light px-3 py-3 text-left transition-colors ${
                        active ? 'bg-teal-light' : 'hover:bg-offwhite'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-navy-deep">
                          {c.lead?.fullName ?? c.leadPhoneE164}
                        </span>
                        {pending ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">● pending</span> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-gray-medium">
                        <span className="font-mono">{c.leadPhoneE164}</span>
                        <span>·</span>
                        <ModeBadge mode={c.mode} />
                        {c.lead ? (
                          <>
                            <span>·</span>
                            <StatusPill status={c.lead.status} />
                          </>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] text-gray-medium">
                        {c._count.messages} msgs
                        {lastAt ? ` · ${relativeTime(lastAt)}` : ''}
                      </p>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </aside>

        {/* Right pane — conversation */}
        <section className={`flex min-w-0 flex-1 flex-col ${selectedId ? 'flex' : 'hidden md:flex'}`}>
          {selectedId ? (
            <ConversationPane
              key={selectedId}
              conversationId={selectedId}
              pendingSuggestion={pendingByConv.get(selectedId) ?? null}
              onBack={() => {
                setSelectedId(null);
                router.replace('/whatsapp', { scroll: false });
              }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-gray-medium">
              Elegí una conversación para verla acá.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ConversationPane({
  conversationId,
  pendingSuggestion,
  onBack,
}: {
  conversationId: string;
  pendingSuggestion: PendingSuggestion | null;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [editingSuggestion, setEditingSuggestion] = useState(false);
  const [suggestionDraft, setSuggestionDraft] = useState(pendingSuggestion?.suggestedReply ?? '');
  const [actionError, setActionError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSuggestionDraft(pendingSuggestion?.suggestedReply ?? '');
    setEditingSuggestion(false);
  }, [pendingSuggestion?.id, pendingSuggestion?.suggestedReply]);

  const { data: conv, isLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api<ConversationDetail>(`/whatsapp/conversations/${conversationId}`),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [conv?.messages?.length]);

  const send = useMutation({
    mutationFn: () =>
      api(`/whatsapp/conversations/${conversationId}/send`, {
        method: 'POST',
        body: JSON.stringify({ text: draft }),
      }),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      setActionError(null);
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const takeover = useMutation({
    mutationFn: () => api(`/whatsapp/conversations/${conversationId}/human-takeover`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const release = useMutation({
    mutationFn: () => api(`/whatsapp/conversations/${conversationId}/release-to-ai`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const approveSuggestion = useMutation({
    mutationFn: () => api(`/suggestions/${pendingSuggestion!.id}/approve`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suggestions'] });
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const editSuggestion = useMutation({
    mutationFn: () =>
      api(`/suggestions/${pendingSuggestion!.id}/edit`, {
        method: 'POST',
        body: JSON.stringify({ editedReply: suggestionDraft.trim() }),
      }),
    onSuccess: () => {
      setEditingSuggestion(false);
      qc.invalidateQueries({ queryKey: ['suggestions'] });
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] });
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const cancelSuggestion = useMutation({
    mutationFn: () => api(`/suggestions/${pendingSuggestion!.id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suggestions'] });
    },
    onError: (err) => setActionError((err as Error).message),
  });

  if (isLoading || !conv) {
    return <div className="p-6 text-sm text-gray-medium">Cargando conversación…</div>;
  }

  const isHuman = conv.mode === 'human_takeover';

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-light bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="md:hidden text-sm text-gray-medium" aria-label="Volver">←</button>
            <p className="truncate font-semibold text-navy-deep">
              {conv.lead?.fullName ?? conv.leadPhoneE164}
            </p>
            <ModeBadge mode={conv.mode} />
            {conv.lead ? <StatusPill status={conv.lead.status} /> : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-gray-medium">
            {conv.leadPhoneE164}
            {conv.lead?.property ? ` · ${conv.lead.property.code} ${conv.lead.property.name}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {conv.lead ? (
            <Link
              href={`/leads/${conv.lead.id}`}
              className="rounded-md border border-gray-light bg-white px-2.5 py-1 text-xs font-semibold text-gray-dark hover:bg-offwhite"
            >
              Ficha del lead →
            </Link>
          ) : null}
          {isHuman ? (
            <button
              onClick={() => release.mutate()}
              disabled={release.isPending}
              className="rounded-md bg-teal px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
            >
              {release.isPending ? '...' : 'Devolver a IA'}
            </button>
          ) : (
            <button
              onClick={() => takeover.mutate()}
              disabled={takeover.isPending}
              className="rounded-md border border-teal bg-white px-2.5 py-1 text-xs font-semibold text-teal hover:bg-teal-light disabled:opacity-50"
            >
              {takeover.isPending ? '...' : 'Tomar manual'}
            </button>
          )}
        </div>
      </div>

      {/* Messages scroll area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-offwhite px-4 py-4">
        {conv.messages.length === 0 ? (
          <p className="text-center text-xs text-gray-medium">Sin mensajes todavía.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {conv.messages.map((m) => (
              <li key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm ${
                    m.direction === 'outbound'
                      ? 'bg-teal text-white'
                      : 'bg-white text-gray-dark'
                  }`}
                >
                  {m.body ?? <em className="text-xs opacity-70">({m.type})</em>}
                  <span className={`mt-1 block text-[10px] ${m.direction === 'outbound' ? 'text-white/70' : 'text-gray-medium'}`}>
                    {new Date(m.createdAt).toLocaleString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pending suggestion */}
      {pendingSuggestion && !isHuman ? (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-3">
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-amber-800">
            <span>● Sugerencia IA pendiente</span>
            {pendingSuggestion.confidence !== null ? (
              <span className="text-amber-700">conf {Math.round(pendingSuggestion.confidence * 100)}%</span>
            ) : null}
          </div>
          {editingSuggestion ? (
            <textarea
              value={suggestionDraft}
              onChange={(e) => setSuggestionDraft(e.target.value)}
              rows={3}
              className="mb-2 w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm focus:border-teal focus:outline-none"
            />
          ) : (
            <p className="mb-2 whitespace-pre-wrap text-sm text-gray-dark">{pendingSuggestion.suggestedReply}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {editingSuggestion ? (
              <>
                <button
                  onClick={() => editSuggestion.mutate()}
                  disabled={editSuggestion.isPending || !suggestionDraft.trim()}
                  className="rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
                >
                  {editSuggestion.isPending ? 'Enviando...' : 'Enviar editado'}
                </button>
                <button
                  onClick={() => { setEditingSuggestion(false); setSuggestionDraft(pendingSuggestion.suggestedReply); }}
                  className="rounded-md border border-gray-light bg-white px-3 py-1.5 text-xs font-semibold text-gray-dark hover:bg-offwhite"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => approveSuggestion.mutate()}
                  disabled={approveSuggestion.isPending}
                  className="rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
                >
                  {approveSuggestion.isPending ? 'Enviando...' : 'Aprobar'}
                </button>
                <button
                  onClick={() => setEditingSuggestion(true)}
                  className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                >
                  Editar
                </button>
                <button
                  onClick={() => cancelSuggestion.mutate()}
                  disabled={cancelSuggestion.isPending}
                  className="rounded-md border border-gray-light bg-white px-3 py-1.5 text-xs font-semibold text-gray-dark hover:bg-offwhite disabled:opacity-50"
                >
                  Descartar
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* Manual reply box */}
      <div className="border-t border-gray-light bg-white px-4 py-3">
        {!isHuman ? (
          <p className="text-[11px] text-gray-medium">
            La IA responde esta conversación. Tomá manual para enviar mensajes propios.
          </p>
        ) : null}
        <div className="mt-1 flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!isHuman || send.isPending}
            rows={2}
            placeholder={isHuman ? 'Escribí un mensaje…' : 'Pasá a manual para escribir.'}
            className="min-h-[44px] flex-1 resize-none rounded-md border border-gray-light bg-white px-3 py-2 text-sm focus:border-teal focus:outline-none disabled:bg-offwhite disabled:opacity-50"
          />
          <button
            onClick={() => send.mutate()}
            disabled={!isHuman || !draft.trim() || send.isPending}
            className="self-end rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
          >
            {send.isPending ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
        {actionError ? <p className="mt-1 text-xs text-red-700">{actionError}</p> : null}
      </div>
    </>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const label =
    mode === 'ai' ? 'IA' :
    mode === 'human_takeover' ? 'Humano' :
    mode === 'paused' ? 'Pausada' :
    mode === 'closed' ? 'Cerrada' : mode;
  const cls =
    mode === 'human_takeover' ? 'bg-violet-100 text-violet-800' :
    mode === 'paused' ? 'bg-amber-100 text-amber-800' :
    mode === 'closed' ? 'bg-gray-200 text-gray-700' :
    'bg-teal-light text-teal';
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
