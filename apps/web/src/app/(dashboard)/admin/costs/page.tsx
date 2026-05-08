'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Summary {
  thisMonthAed: number;
  lastMonthAed: number;
  ytdAed: number;
  forecast12mAed: number;
  byKindThisMonth: Array<{ kind: string; amountAed: number }>;
  activeSubscriptionsMonthlyAed: number;
}

interface Entry {
  id: string;
  kind: string;
  label: string;
  amountAed: string;
  amountUsd: string | null;
  sourceType: string | null;
  incurredAt: string;
  subscription: { label: string } | null;
}

interface Sub {
  id: string;
  label: string;
  kind: string;
  amountAed: string;
  cadence: string;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  notes: string | null;
}

const KIND_LABEL: Record<string, string> = {
  anthropic_api: 'Anthropic AI',
  meta_whatsapp: 'Meta WhatsApp',
  fixed_subscription: 'Fixed subscriptions',
  fixed_one_off: 'One-off',
  vps: 'VPS',
  storage: 'Storage',
  other: 'Other',
};
const KIND_COLOR: Record<string, string> = {
  anthropic_api: '#8B5CF6',
  meta_whatsapp: '#25D366',
  fixed_subscription: '#0F766E',
  fixed_one_off: '#F59E0B',
  vps: '#6366F1',
  storage: '#64748B',
  other: '#94A3B8',
};

function fmtAed(n: number | string) {
  const v = typeof n === 'string' ? Number(n) : n;
  return v.toLocaleString('en-AE', { maximumFractionDigits: 2 });
}

export default function CostsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [showAddSub, setShowAddSub] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [s, e, ss] = await Promise.all([
        api<Summary>('/admin/costs/summary'),
        api<Entry[]>('/admin/costs/entries?limit=100'),
        api<Sub[]>('/admin/costs/subscriptions'),
      ]);
      setSummary(s);
      setEntries(e);
      setSubs(ss);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  if (loading) return <p className="text-sm text-gray-medium">Loading…</p>;
  if (!summary) return null;

  const monthDelta = summary.thisMonthAed - summary.lastMonthAed;
  const monthDeltaPct = summary.lastMonthAed > 0 ? (monthDelta / summary.lastMonthAed) * 100 : 0;

  const totalThisMonth = summary.byKindThisMonth.reduce((s, r) => s + r.amountAed, 0) || 1;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-navy-deep">Costs</h1>
        <p className="text-sm text-gray-medium">
          Every AED spent on the MVP — APIs (Anthropic, Meta), fixed subscriptions and manual entries.
          Daily roll-up at 02:00 UTC.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="This month" value={fmtAed(summary.thisMonthAed)} suffix="AED" />
        <Tile
          label="Last month"
          value={fmtAed(summary.lastMonthAed)}
          suffix="AED"
          sub={
            summary.lastMonthAed > 0
              ? `${monthDelta >= 0 ? '↑' : '↓'} ${Math.abs(monthDeltaPct).toFixed(0)}% vs prev`
              : undefined
          }
        />
        <Tile label="Year to date" value={fmtAed(summary.ytdAed)} suffix="AED" />
        <Tile label="12-mo forecast" value={fmtAed(summary.forecast12mAed)} suffix="AED" sub="From last 30d run-rate + active subs" />
      </div>

      <section className="rounded-md bg-white p-4 shadow-card">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-medium">
          This month by category
        </p>
        {summary.byKindThisMonth.length === 0 ? (
          <p className="text-sm text-gray-medium">No spend yet this month.</p>
        ) : (
          <>
            <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-offwhite">
              {summary.byKindThisMonth.map((r) => (
                <div
                  key={r.kind}
                  style={{
                    width: `${(r.amountAed / totalThisMonth) * 100}%`,
                    backgroundColor: KIND_COLOR[r.kind] ?? '#94A3B8',
                  }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              {summary.byKindThisMonth.map((r) => (
                <div key={r.kind} className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: KIND_COLOR[r.kind] ?? '#94A3B8' }} />
                  <span className="text-gray-dark">{KIND_LABEL[r.kind] ?? r.kind}</span>
                  <span className="font-semibold text-navy-deep">{fmtAed(r.amountAed)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Subscriptions */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-navy-deep">Recurring subscriptions</h2>
          <button
            onClick={() => setShowAddSub(true)}
            className="rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#008C8A]"
          >
            + Add subscription
          </button>
        </div>
        <div className="rounded-md border border-gray-light bg-white">
          <table className="w-full text-sm">
            <thead className="bg-offwhite text-left text-xs uppercase tracking-wide text-gray-medium">
              <tr>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Cadence</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="border-t border-gray-light">
                  <td className="px-3 py-2">
                    <p className="font-medium text-navy-deep">{s.label}</p>
                    {s.notes ? <p className="text-xs text-gray-medium">{s.notes}</p> : null}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    AED {fmtAed(s.amountAed)} <span className="text-gray-medium">/{s.cadence === 'monthly' ? 'mo' : 'yr'}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{s.cadence}</td>
                  <td className="px-3 py-2 text-xs text-gray-medium">{new Date(s.startsAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={async () => {
                        await api(`/admin/costs/subscriptions/${s.id}/toggle`, {
                          method: 'POST',
                          body: JSON.stringify({ active: !s.active }),
                        });
                        loadAll();
                      }}
                      className={`text-xs font-semibold ${s.active ? 'text-teal' : 'text-gray-medium'}`}
                    >
                      {s.active ? 'ACTIVE' : 'paused'}
                    </button>
                  </td>
                </tr>
              ))}
              {subs.length === 0 ? (
                <tr><td className="px-3 py-6 text-center text-sm text-gray-medium" colSpan={5}>No subscriptions yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Entries */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-navy-deep">Recent ledger entries</h2>
          <button
            onClick={() => setShowAddEntry(true)}
            className="rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#008C8A]"
          >
            + Add entry
          </button>
        </div>
        <div className="rounded-md border border-gray-light bg-white">
          <table className="w-full text-sm">
            <thead className="bg-offwhite text-left text-xs uppercase tracking-wide text-gray-medium">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">AED</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-gray-light">
                  <td className="px-3 py-2 text-xs text-gray-medium">{new Date(e.incurredAt).toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-2 text-xs">
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
                      style={{ backgroundColor: KIND_COLOR[e.kind] ?? '#94A3B8' }}
                    >
                      {KIND_LABEL[e.kind] ?? e.kind}
                    </span>
                  </td>
                  <td className="px-3 py-2">{e.label}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{fmtAed(e.amountAed)}</td>
                </tr>
              ))}
              {entries.length === 0 ? (
                <tr><td className="px-3 py-6 text-center text-sm text-gray-medium" colSpan={4}>No entries yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {showAddEntry ? <AddEntryModal onClose={() => setShowAddEntry(false)} onSaved={() => { setShowAddEntry(false); loadAll(); }} /> : null}
      {showAddSub ? <AddSubModal onClose={() => setShowAddSub(false)} onSaved={() => { setShowAddSub(false); loadAll(); }} /> : null}
    </div>
  );
}

function Tile({ label, value, suffix, sub }: { label: string; value: string; suffix?: string; sub?: string }) {
  return (
    <div className="rounded-md bg-white p-3 shadow-card">
      <p className="text-[10px] uppercase tracking-wide text-gray-medium">{label}</p>
      <p className="mt-1 text-xl font-bold text-navy-deep">
        {value} {suffix ? <span className="text-xs font-normal text-gray-medium">{suffix}</span> : null}
      </p>
      {sub ? <p className="text-[10px] text-gray-medium">{sub}</p> : null}
    </div>
  );
}

function AddEntryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState('fixed_one_off');
  const [label, setLabel] = useState('');
  const [amountAed, setAmountAed] = useState('');
  const [incurredAt, setIncurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api('/admin/costs/entries', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          label,
          amountAed: Number(amountAed),
          incurredAt,
        }),
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add cost entry" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Category">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
            {Object.keys(KIND_LABEL).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Description">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. VPS monthly invoice — May 2026" className={inputCls} />
        </Field>
        <Field label="Amount (AED)">
          <input value={amountAed} onChange={(e) => setAmountAed(e.target.value)} type="number" step="0.01" className={inputCls} />
        </Field>
        <Field label="Date">
          <input type="date" value={incurredAt} onChange={(e) => setIncurredAt(e.target.value)} className={inputCls} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm">Cancel</button>
          <button onClick={save} disabled={busy || !label || !amountAed} className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Saving…' : 'Add entry'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddSubModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState('');
  const [amountAed, setAmountAed] = useState('');
  const [cadence, setCadence] = useState<'monthly' | 'yearly'>('monthly');
  const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api('/admin/costs/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ label, amountAed: Number(amountAed), cadence, startsAt, notes: notes || undefined }),
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add recurring subscription" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Label">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. IONOS VPS" className={inputCls} />
        </Field>
        <Field label="Amount (AED)">
          <input value={amountAed} onChange={(e) => setAmountAed(e.target.value)} type="number" step="0.01" className={inputCls} />
        </Field>
        <Field label="Cadence">
          <select value={cadence} onChange={(e) => setCadence(e.target.value as 'monthly' | 'yearly')} className={inputCls}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </Field>
        <Field label="Start date">
          <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Notes (optional)">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm">Cancel</button>
          <button onClick={save} disabled={busy || !label || !amountAed} className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Saving…' : 'Add subscription'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const inputCls = 'w-full rounded-md border border-gray-light px-3 py-2 text-sm focus:border-teal focus:outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-medium">{label}</label>
      {children}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-md bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold text-navy-deep">{title}</h2>
        {children}
      </div>
    </div>
  );
}
