'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ScoreBadge, StatusPill } from '@rentflow/ui';
import { api } from '@/lib/api';

interface SuggestionRow {
  id: string;
  state: string;
  suggestedReply: string;
  reasoning: string | null;
  confidence: number | null;
  stateAfter: string | null;
  escalate: boolean;
  status: string;
  finalReply: string | null;
  createdAt: string;
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  lead: {
    id: string;
    fullName: string | null;
    phoneE164: string;
    status: string;
    temperature: string;
  };
  conversation: { id: string; mode: string };
}

const TABS = [
  { key: 'pending',   label: 'Pending'   },
  { key: 'approved',  label: 'Approved'  },
  { key: 'edited',    label: 'Edited'    },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'failed',    label: 'Failed'    },
] as const;

export default function SuggestionsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<typeof TABS[number]['key']>('pending');
  const { data, isLoading } = useQuery({
    queryKey: ['suggestions', tab],
    queryFn: () => api<SuggestionRow[]>(`/suggestions?status=${tab}`),
    refetchInterval: 5_000,
  });

  return (
    <div>
      <header className="mb-6">
        <h1>Suggestions inbox</h1>
        <p className="mt-1 text-sm text-gray-medium">
          AI-suggested replies waiting for operator decision. Approve to send verbatim, edit to teach the model, or cancel to drop.
        </p>
      </header>

      <nav className="mb-6 flex gap-2 border-b border-gray-light">
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

      {isLoading ? (
        <p className="text-sm text-gray-medium">Loading…</p>
      ) : !data?.length ? (
        <div className="rounded-md border border-dashed border-gray-light bg-white p-12 text-center">
          <p className="text-sm text-gray-medium">
            {tab === 'pending'
              ? '🎉 Inbox zero — no pending suggestions.'
              : `No ${tab} suggestions.`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              onChange={() => qc.invalidateQueries({ queryKey: ['suggestions'] })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onChange,
}: {
  suggestion: SuggestionRow;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(suggestion.suggestedReply);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setEditText(suggestion.suggestedReply);
  }, [suggestion.suggestedReply]);

  const approve = useMutation({
    mutationFn: () => api(`/suggestions/${suggestion.id}/approve`, { method: 'POST' }),
    onSuccess: onChange,
    onError: (err) => setActionError((err as Error).message),
  });

  const edit = useMutation({
    mutationFn: () =>
      api(`/suggestions/${suggestion.id}/edit`, {
        method: 'POST',
        body: JSON.stringify({ editedReply: editText.trim() }),
      }),
    onSuccess: () => {
      setEditing(false);
      onChange();
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const cancel = useMutation({
    mutationFn: () => api(`/suggestions/${suggestion.id}/cancel`, { method: 'POST' }),
    onSuccess: onChange,
    onError: (err) => setActionError((err as Error).message),
  });

  const isPending = suggestion.status === 'pending';
  const isFailed = suggestion.status === 'failed';

  return (
    <article className="rounded-md border border-gray-light bg-white p-5 shadow-card">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/leads/${suggestion.lead.id}`}
              className="font-semibold text-navy-deep hover:underline"
            >
              {suggestion.lead.fullName ?? suggestion.lead.phoneE164}
            </Link>
            <StatusPill status={suggestion.lead.status} />
            <StatusPill status={suggestion.lead.temperature} />
            {suggestion.escalate ? (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800">
                ⚠ escalate
              </span>
            ) : null}
            {suggestion.confidence !== null ? (
              <ScoreBadge
                score={Math.round(suggestion.confidence * 100)}
                label="conf"
              />
            ) : null}
          </div>
          <p className="mt-1 text-xs text-gray-medium">
            <span className="font-mono">{suggestion.lead.phoneE164}</span>
            {' · '}state: <strong className="text-gray-dark">{suggestion.state.replace(/_/g, ' ')}</strong>
            {suggestion.stateAfter && suggestion.stateAfter !== suggestion.state ? (
              <span> → <strong className="text-gray-dark">{suggestion.stateAfter.replace(/_/g, ' ')}</strong></span>
            ) : null}
            {' · '}{new Date(suggestion.createdAt).toLocaleString()}
          </p>
        </div>
        <StatusPill status={suggestion.status} />
      </div>

      {/* Reasoning */}
      {suggestion.reasoning ? (
        <div className="mb-3 rounded-md bg-offwhite p-3 text-xs text-gray-dark">
          <strong className="text-gray-medium">Reasoning:</strong> {suggestion.reasoning}
        </div>
      ) : null}

      {/* Failed state */}
      {isFailed ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <strong>Generation failed:</strong> {suggestion.errorMessage ?? 'unknown error'}
        </div>
      ) : null}

      {/* Body — editable when pending, read-only otherwise */}
      {!isFailed ? (
        <div className="mb-3">
          {editing ? (
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-teal bg-teal-light/30 p-3 text-sm focus:bg-white focus:outline-none"
              autoFocus
            />
          ) : (
            <div className="rounded-md border border-gray-light bg-white p-3 text-sm whitespace-pre-wrap">
              {suggestion.finalReply ?? suggestion.suggestedReply}
            </div>
          )}
          {suggestion.finalReply && suggestion.finalReply !== suggestion.suggestedReply ? (
            <details className="mt-2 text-xs text-gray-medium">
              <summary className="cursor-pointer font-semibold">Original AI suggestion</summary>
              <p className="mt-1 whitespace-pre-wrap rounded-md bg-offwhite p-2 text-gray-dark">
                {suggestion.suggestedReply}
              </p>
            </details>
          ) : null}
        </div>
      ) : null}

      {actionError ? (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {actionError}
        </div>
      ) : null}

      {/* Actions */}
      {isPending ? (
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={() => edit.mutate()}
                disabled={edit.isPending || !editText.trim() || editText === suggestion.suggestedReply}
                className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-[#008C8A] disabled:opacity-50"
              >
                {edit.isPending ? 'Sending…' : 'Send edited'}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setEditText(suggestion.suggestedReply);
                  setActionError(null);
                }}
                className="rounded-md border border-gray-light px-4 py-2 text-sm font-semibold text-gray-dark hover:bg-offwhite"
              >
                Discard edit
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => approve.mutate()}
                disabled={approve.isPending}
                className="rounded-md bg-success px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {approve.isPending ? 'Sending…' : '✓ Approve & send'}
              </button>
              <button
                onClick={() => setEditing(true)}
                className="rounded-md bg-secondary px-4 py-2 text-sm font-semibold text-white hover:bg-navy-deep"
              >
                ✎ Edit
              </button>
              <button
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
                className="rounded-md border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {cancel.isPending ? 'Cancelling…' : '✗ Cancel'}
              </button>
            </>
          )}
        </div>
      ) : null}

      {/* Telemetry footer */}
      <div className="mt-3 border-t border-gray-light pt-2 text-xs text-gray-medium">
        <span>{suggestion.modelId}</span>
        {suggestion.inputTokens !== null ? (
          <>
            {' · '}
            <span>
              {suggestion.inputTokens}/{suggestion.outputTokens ?? 0} tok
            </span>
          </>
        ) : null}
        {suggestion.cacheReadTokens ? (
          <>
            {' · '}
            <span className="text-emerald-700">cache read {suggestion.cacheReadTokens}</span>
          </>
        ) : null}
        {suggestion.cacheCreationTokens ? (
          <>
            {' · '}
            <span className="text-amber-700">cache write {suggestion.cacheCreationTokens}</span>
          </>
        ) : null}
        {suggestion.latencyMs ? (
          <>
            {' · '}
            <span>{(suggestion.latencyMs / 1000).toFixed(1)}s</span>
          </>
        ) : null}
      </div>
    </article>
  );
}
