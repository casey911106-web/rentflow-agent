'use client';

import { buildMonthGrid, dubaiNow, formatHHmm, sameDubaiDay, toDubai } from '../_lib/date-utils';

export interface ViewingRow {
  id: string;
  status: string;
  scheduledAt: string;
  durationMinutes: number;
  property: { id?: string; code: string; name: string; area?: string | null };
  lead: { id?: string; fullName: string | null; phoneE164: string; status?: string };
  fieldAgent: { user: { fullName: string } } | null;
}

interface Props {
  year: number;
  monthIndex: number;
  rows: ViewingRow[];
  onDayClick: (date: Date) => void;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function statusChipClass(status: string): string {
  switch (status) {
    case 'scheduled':
    case 'confirmed':
      return 'bg-teal/10 text-teal';
    case 'completed':
      return 'bg-gray-light text-gray-medium';
    case 'cancelled':
    case 'no_show':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-offwhite text-gray-dark';
  }
}

export function CalendarGrid({ year, monthIndex, rows, onDayClick }: Props) {
  const cells = buildMonthGrid(year, monthIndex);
  const now = dubaiNow();

  const byDay = new Map<string, ViewingRow[]>();
  for (const r of rows) {
    const key = toDubai(new Date(r.scheduledAt)).toISOString().slice(0, 10);
    const arr = byDay.get(key) ?? [];
    arr.push(r);
    byDay.set(key, arr);
  }

  return (
    <div className="overflow-hidden rounded-md border border-gray-light bg-white shadow-card">
      <div className="grid grid-cols-7 border-b border-gray-light bg-offwhite text-xs uppercase tracking-wide text-gray-medium">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="px-3 py-2 text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const key = cell.date.toISOString().slice(0, 10);
          const dayRows = byDay.get(key) ?? [];
          const isToday = sameDubaiDay(cell.date, now);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onDayClick(cell.date)}
              className={`flex min-h-[110px] flex-col items-stretch border-b border-r border-gray-light p-2 text-left text-xs hover:bg-offwhite ${
                cell.inMonth ? '' : 'bg-gray-50 text-gray-300'
              }`}
            >
              <div
                className={`mb-1 inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-xs font-semibold ${
                  isToday ? 'bg-teal text-white' : cell.inMonth ? 'text-gray-dark' : 'text-gray-300'
                }`}
              >
                {cell.date.getUTCDate()}
              </div>
              <div className="flex-1 space-y-1">
                {dayRows.slice(0, 3).map((r) => (
                  <div
                    key={r.id}
                    className={`truncate rounded px-1.5 py-0.5 ${statusChipClass(r.status)}`}
                    title={`${r.property.code} — ${r.fieldAgent?.user.fullName ?? 'unassigned'}`}
                  >
                    {formatHHmm(new Date(r.scheduledAt))} · {r.property.code}
                  </div>
                ))}
                {dayRows.length > 3 ? (
                  <div className="text-[11px] text-gray-medium">+{dayRows.length - 3} more</div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
