'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { StatusPill } from '@rentflow/ui';
import type { ViewingRow } from './calendar-grid';

interface Props {
  date: Date | null;
  rows: ViewingRow[];
  onClose: () => void;
}

export function DayDrawer({ date, rows, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (date) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [date, onClose]);

  if (!date) return null;
  const dateLabel = date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Dubai',
  });

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/30"
        aria-hidden
      />
      <aside className="fixed right-0 top-0 z-40 flex h-full w-full max-w-[420px] flex-col border-l border-gray-light bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-light px-5 py-4">
          <h2 className="text-base font-semibold text-navy">{dateLabel}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-medium hover:text-gray-dark"
            aria-label="Close drawer"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {rows.length === 0 ? (
            <p className="text-sm text-gray-medium">No viewings on this day.</p>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.id} className="rounded-md border border-gray-light p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-semibold text-navy">
                      {new Date(r.scheduledAt).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Dubai',
                      })}
                    </span>
                    <StatusPill status={r.status} />
                  </div>
                  <Link
                    href={`/viewings/${r.id}`}
                    className="block text-sm font-semibold text-navy hover:underline"
                  >
                    {r.property.code} — {r.property.name}
                  </Link>
                  <div className="mt-1 text-xs text-gray-medium">
                    Lead: {r.lead.fullName ?? r.lead.phoneE164}
                  </div>
                  <div className="text-xs text-gray-medium">
                    Agent: {r.fieldAgent?.user.fullName ?? '— unassigned —'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
