'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Slot {
  isoLocal: string;
  taken: boolean;
}

interface View {
  property: { code: string; name: string; area: string | null; priceAed: string | null };
  current?: { startsAt: string };
  canReschedule: boolean;
  slots: Slot[];
  isReschedule: boolean;
  expiresAt: string;
}

interface CommitResult {
  viewingId: string;
  scheduledAt: string;
  agentName: string | null;
  property: { code: string; name: string };
}

function fmtSlot(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Dubai',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDateLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Dubai',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function fmtTimeLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Dubai',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SchedulerPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickedSlot, setPickedSlot] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);

  useEffect(() => {
    (async () => {
      const sp = await searchParams;
      if (!sp.t) {
        setError('Missing scheduler token. Ask us for a fresh link on WhatsApp.');
        return;
      }
      setTokenId(sp.t);
      try {
        const res = await fetch(`${API_BASE}/public/scheduler/${sp.t}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message ?? 'Link is invalid or expired.');
        }
        setView(await res.json());
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [searchParams]);

  async function commit() {
    if (!tokenId || !pickedSlot) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/public/scheduler/${tokenId}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotIso: pickedSlot, leadName: name || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Could not book.');
      }
      setResult(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <Wrap>
        <div className="rounded-lg bg-white p-6 text-center shadow-card">
          <p className="text-lg font-semibold text-danger">⚠️ {error}</p>
          <Link href="/" className="mt-4 inline-block text-sm font-semibold text-teal hover:underline">
            ← Browse all rentals
          </Link>
        </div>
      </Wrap>
    );
  }
  if (!view && !result) {
    return <Wrap><p className="text-center text-gray-medium">Loading…</p></Wrap>;
  }
  if (result) {
    return (
      <Wrap>
        <div className="rounded-lg bg-white p-6 text-center shadow-card">
          <p className="text-3xl">✅</p>
          <h1 className="mt-2 text-xl font-bold text-navy-deep">Viewing confirmed</h1>
          <p className="mt-2 text-gray-dark">
            {result.property.code} — {result.property.name}
          </p>
          <p className="mt-1 text-2xl font-bold text-navy-deep">{fmtSlot(result.scheduledAt)}</p>
          {result.agentName ? (
            <p className="mt-3 text-sm text-gray-medium">
              <span className="font-semibold text-navy-deep">{result.agentName}</span> will meet you. They&apos;ll WhatsApp 30 minutes before with arrival details.
            </p>
          ) : (
            <p className="mt-3 text-sm text-gray-medium">We&apos;ll confirm the agent shortly via WhatsApp.</p>
          )}
          <Link href="/" className="mt-6 inline-block text-sm font-semibold text-teal hover:underline">
            Back to all rentals
          </Link>
        </div>
      </Wrap>
    );
  }

  // view is set
  if (!view) return null;

  if (view.isReschedule && !view.canReschedule) {
    return (
      <Wrap>
        <div className="rounded-lg bg-white p-6 text-center shadow-card">
          <p className="text-lg font-semibold text-danger">Cannot reschedule less than 1 hour before the viewing.</p>
          <p className="mt-2 text-sm text-gray-medium">Please WhatsApp us if you can&apos;t make it.</p>
        </div>
      </Wrap>
    );
  }

  // group slots by date
  const grouped: Record<string, Slot[]> = {};
  for (const s of view.slots) {
    const dateKey = fmtDateLabel(s.isoLocal);
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey]!.push(s);
  }

  return (
    <Wrap>
      <div className="mb-4 rounded-lg bg-white p-4 shadow-card">
        <p className="text-xs uppercase tracking-wide text-gray-medium">
          {view.isReschedule ? 'Reschedule viewing' : 'Schedule a viewing'}
        </p>
        <h1 className="mt-1 text-xl font-bold text-navy-deep">
          {view.property.code} — {view.property.name}
        </h1>
        {view.property.area ? <p className="text-sm text-gray-medium">{view.property.area}</p> : null}
        {view.property.priceAed ? (
          <p className="mt-2 text-base font-semibold text-navy-deep">
            AED {Number(view.property.priceAed).toLocaleString()}
            <span className="text-xs font-normal text-gray-medium"> / month</span>
          </p>
        ) : null}
        {view.current ? (
          <p className="mt-2 text-sm text-gray-medium">
            Currently scheduled: <span className="font-semibold text-navy-deep">{fmtSlot(view.current.startsAt)}</span>
          </p>
        ) : null}
      </div>

      <div className="space-y-4">
        {Object.entries(grouped).map(([dateKey, slots]) => {
          const free = slots.filter((s) => !s.taken);
          if (free.length === 0) return null;
          return (
            <div key={dateKey} className="rounded-lg bg-white p-4 shadow-card">
              <p className="mb-3 text-sm font-semibold text-navy-deep">{dateKey}</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {slots.map((s) => {
                  const picked = pickedSlot === s.isoLocal;
                  return (
                    <button
                      key={s.isoLocal}
                      type="button"
                      onClick={() => !s.taken && setPickedSlot(s.isoLocal)}
                      disabled={s.taken}
                      className={
                        s.taken
                          ? 'cursor-not-allowed rounded-md border border-gray-light bg-offwhite px-2 py-2 text-xs text-gray-medium line-through'
                          : picked
                          ? 'rounded-md border-2 border-teal bg-teal px-2 py-2 text-xs font-bold text-white'
                          : 'rounded-md border border-gray-light bg-white px-2 py-2 text-xs font-medium text-navy-deep hover:border-teal hover:text-teal'
                      }
                    >
                      {fmtTimeLabel(s.isoLocal)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {pickedSlot ? (
        <div className="sticky bottom-4 mt-4 rounded-lg bg-white p-4 shadow-lg">
          <p className="text-sm font-semibold text-navy-deep">Confirm viewing for:</p>
          <p className="text-lg font-bold text-teal">{fmtSlot(pickedSlot)}</p>
          {!view.isReschedule ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)"
              className="mt-3 w-full rounded-md border border-gray-light px-3 py-2 text-sm focus:border-teal focus:outline-none"
            />
          ) : null}
          <button
            onClick={commit}
            disabled={submitting}
            className="mt-3 w-full rounded-md bg-teal px-4 py-3 text-sm font-bold text-white hover:bg-[#008C8A] disabled:opacity-50"
          >
            {submitting
              ? 'Confirming…'
              : view.isReschedule
              ? 'Reschedule to this time'
              : 'Confirm viewing'}
          </button>
        </div>
      ) : null}
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-offwhite">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 md:px-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-mark.png" alt="" className="h-10 w-10" />
          <div>
            <p className="text-base font-bold text-navy-deep">RentFlow Agent</p>
            <p className="text-xs text-gray-medium">Viewing scheduler</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
