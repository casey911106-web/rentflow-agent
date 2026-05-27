# Viewings calendar — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `/viewings` table in the web admin with a monthly calendar grid + day-drawer. Default view is current month. Week view is the secondary zoom.

**Architecture:** Backend gains optional `from` / `to` query params on `GET /viewings`. The web page becomes a client component that fetches a month at a time via TanStack Query, renders a 7-column grid, and opens a side drawer on day click with the same row content the current table already shows.

**Tech Stack:** Nest (api), Next.js App Router + TanStack Query + Tailwind (web). No new npm deps — the grid is built with Tailwind; date math with native `Date` (Dubai is UTC+4 no DST, simple to compute).

**Spec:** `docs/superpowers/specs/2026-05-27-viewings-calendar-design.md`

---

## File map

**Modify:**
- `apps/api/src/modules/viewings/viewings.controller.ts` (add `from` / `to` query)
- `apps/api/src/modules/viewings/viewings.service.ts` (apply the range; bump take)
- `apps/api/src/modules/viewings/viewings.service.spec.ts` (or sibling test file — add range tests)
- `apps/web/src/app/(dashboard)/viewings/page.tsx` (rewrite)

**Create:**
- `apps/web/src/app/(dashboard)/viewings/_components/calendar-grid.tsx`
- `apps/web/src/app/(dashboard)/viewings/_components/day-drawer.tsx`
- `apps/web/src/app/(dashboard)/viewings/_components/header.tsx`
- `apps/web/src/app/(dashboard)/viewings/_lib/date-utils.ts`

---

## Task 1: Backend — accept `from` / `to` range

**Files:**
- Modify: `apps/api/src/modules/viewings/viewings.controller.ts`
- Modify: `apps/api/src/modules/viewings/viewings.service.ts`

- [ ] **Step 1.1: Controller — add params**

In the `list` method add `@Query('from') from?: string, @Query('to') to?: string` and pass through to the service:

```typescript
list(
  @CurrentUser() user: JwtPayload,
  @Query('date') date?: string,
  @Query('status') status?: ViewingStatus,
  @Query('agentId') agentId?: string,
  @Query('propertyId') propertyId?: string,
  @Query('from') from?: string,
  @Query('to') to?: string,
) {
  return this.viewings.list(user, { date, status, agentId, propertyId, from, to });
}
```

- [ ] **Step 1.2: Service — apply range, bump take**

In `viewings.service.ts` find the `list(user, filter)` method. Update the filter type and the where clause:

```typescript
async list(
  user: JwtPayload,
  filter: {
    date?: string;
    status?: ViewingStatus;
    agentId?: string;
    propertyId?: string;
    from?: string;
    to?: string;
  } = {},
) {
  const scope = await this.resolveAgentScope(user);
  if (scope === undefined) return [];

  const where: Record<string, unknown> = { companyId: user.companyId };
  if (filter.status) where.status = filter.status;
  if (filter.propertyId) where.propertyId = filter.propertyId;
  if (scope) where.fieldAgentId = scope;
  else if (filter.agentId) where.fieldAgentId = filter.agentId;

  if (filter.from || filter.to) {
    const start = filter.from ? new Date(filter.from) : new Date('1970-01-01');
    const end = filter.to ? new Date(filter.to) : new Date('2999-12-31');
    end.setUTCHours(23, 59, 59, 999);
    where.scheduledAt = { gte: start, lte: end };
  } else if (filter.date) {
    const start = new Date(filter.date);
    const end = new Date(start);
    end.setUTCHours(23, 59, 59, 999);
    where.scheduledAt = { gte: start, lte: end };
  }

  return this.prisma.viewing.findMany({
    where,
    include: {
      property: { select: { id: true, code: true, name: true, area: true } },
      lead: { select: { id: true, fullName: true, phoneE164: true, status: true } },
      fieldAgent: { include: { user: { select: { fullName: true } } } },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 500,
  });
}
```

The `else if` for `filter.date` keeps backwards compatibility for any caller still using `?date=`.

- [ ] **Step 1.3: Test the range**

Add (or extend) the viewings service spec to assert:
- `from`+`to` returns rows in that window only.
- `from` alone with no `to` returns everything ≥ from.
- `to` alone returns everything ≤ to.
- `date` alone still works (regression).

Run:
```bash
pnpm --filter @rentflow/api test viewings
```

- [ ] **Step 1.4: Smoke via curl**

```bash
pnpm --filter @rentflow/api start
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/viewings?from=2026-05-01&to=2026-05-31"
```
Expected: 200 with viewings in May 2026 only.

- [ ] **Step 1.5: Commit**

```bash
git add apps/api/src/modules/viewings/
git commit -m "feat(api): viewings range from/to filter + bump take 200→500"
```

---

## Task 2: Date utilities

**Files:**
- Create: `apps/web/src/app/(dashboard)/viewings/_lib/date-utils.ts`

- [ ] **Step 2.1: Implement helpers**

```typescript
// Dubai is UTC+4 year-round. Convert ISO timestamps to Dubai-local for display
// and back to UTC ISO for API queries.
const DUBAI_OFFSET_HOURS = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function dubaiNow(): Date {
  return new Date(Date.now() + DUBAI_OFFSET_HOURS * 60 * 60 * 1000);
}

export function toDubai(utc: Date): Date {
  return new Date(utc.getTime() + DUBAI_OFFSET_HOURS * 60 * 60 * 1000);
}

/** Returns ISO YYYY-MM-DD for the first day of the month in Dubai time. */
export function monthStart(year: number, monthIndex: number): Date {
  // monthIndex 0..11 in Dubai time → corresponding UTC instant
  const dubaiMidnight = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
  return new Date(dubaiMidnight.getTime() - DUBAI_OFFSET_HOURS * 60 * 60 * 1000);
}

export function monthEnd(year: number, monthIndex: number): Date {
  const next = monthStart(year, monthIndex + 1);
  return new Date(next.getTime() - 1);
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Build a grid of (up to) 6 rows × 7 cells for a month-view. Each cell
 *  carries its Date (always Dubai-local midnight) plus a `inMonth` flag
 *  for the leading/trailing padding days. Week starts Monday. */
export function buildMonthGrid(year: number, monthIndex: number): Array<{ date: Date; inMonth: boolean }> {
  const firstDub = new Date(Date.UTC(year, monthIndex, 1));
  // JS getUTCDay: Sun=0..Sat=6. We want Mon=0..Sun=6.
  const dayOfWeek = (firstDub.getUTCDay() + 6) % 7;
  const gridStart = new Date(firstDub.getTime() - dayOfWeek * MS_PER_DAY);

  const cells: Array<{ date: Date; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime() + i * MS_PER_DAY);
    cells.push({ date: d, inMonth: d.getUTCMonth() === monthIndex && d.getUTCFullYear() === year });
  }
  // Trim trailing all-padding row if not needed
  while (cells.length > 35 && !cells.slice(-7).some((c) => c.inMonth)) cells.pop();
  return cells;
}

export function sameDubaiDay(a: Date, b: Date): boolean {
  return toISODate(toDubai(a)) === toISODate(toDubai(b));
}

export function formatHHmm(d: Date): string {
  const dub = toDubai(d);
  const h = String(dub.getUTCHours()).padStart(2, '0');
  const m = String(dub.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
```

- [ ] **Step 2.2: Commit**

```bash
git add apps/web/src/app/(dashboard)/viewings/_lib/
git commit -m "feat(web): viewings calendar — date utils"
```

---

## Task 3: Header component

**Files:**
- Create: `apps/web/src/app/(dashboard)/viewings/_components/header.tsx`

- [ ] **Step 3.1: Header with month nav, view toggle, Today button**

```tsx
'use client';

interface Props {
  year: number;
  monthIndex: number;
  view: 'month' | 'week';
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (v: 'month' | 'week') => void;
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function CalendarHeader({ year, monthIndex, view, onPrev, onNext, onToday, onViewChange }: Props) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <button onClick={onPrev} className="rounded-md border border-gray-light bg-white px-2 py-1 text-sm">‹</button>
      <span className="min-w-[180px] text-center text-lg font-semibold text-navy">
        {MONTH_NAMES[monthIndex]} {year}
      </span>
      <button onClick={onNext} className="rounded-md border border-gray-light bg-white px-2 py-1 text-sm">›</button>
      <button onClick={onToday} className="rounded-md border border-gray-light bg-white px-3 py-1 text-sm">Today</button>
      <div className="ml-auto flex rounded-md border border-gray-light bg-white p-0.5 text-sm">
        <button
          onClick={() => onViewChange('month')}
          className={`px-3 py-1 ${view === 'month' ? 'bg-teal text-white rounded' : 'text-gray-dark'}`}
        >Month</button>
        <button
          onClick={() => onViewChange('week')}
          className={`px-3 py-1 ${view === 'week' ? 'bg-teal text-white rounded' : 'text-gray-dark'}`}
        >Week</button>
      </div>
    </div>
  );
}
```

(Adjust class names to whatever the design tokens in the repo expose — peek at the existing `viewings/page.tsx` for the conventions: it uses `text-navy`, `text-gray-medium`, etc.)

- [ ] **Step 3.2: Commit**

```bash
git add apps/web/src/app/(dashboard)/viewings/_components/header.tsx
git commit -m "feat(web): viewings calendar — header component"
```

---

## Task 4: Calendar grid component

**Files:**
- Create: `apps/web/src/app/(dashboard)/viewings/_components/calendar-grid.tsx`

- [ ] **Step 4.1: Grid with chips per day**

```tsx
'use client';
import { buildMonthGrid, dubaiNow, formatHHmm, sameDubaiDay, toDubai } from '../_lib/date-utils';

export interface ViewingRow {
  id: string;
  status: string;
  scheduledAt: string;
  property: { code: string; name: string };
  lead: { fullName: string | null; phoneE164: string };
  fieldAgent: { user: { fullName: string } } | null;
}

interface Props {
  year: number;
  monthIndex: number;
  rows: ViewingRow[];
  onDayClick: (date: Date) => void;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function statusColor(status: string): string {
  switch (status) {
    case 'scheduled':
    case 'confirmed': return 'bg-teal/10 text-teal';
    case 'completed': return 'bg-gray-light text-gray-medium';
    case 'cancelled':
    case 'no_show':   return 'bg-red-100 text-red-700';
    default:          return 'bg-offwhite text-gray-dark';
  }
}

export function CalendarGrid({ year, monthIndex, rows, onDayClick }: Props) {
  const cells = buildMonthGrid(year, monthIndex);
  const now = dubaiNow();

  // Bucket rows by Dubai YYYY-MM-DD
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
        {cells.map((cell, i) => {
          const key = cell.date.toISOString().slice(0, 10);
          const dayRows = byDay.get(key) ?? [];
          const isToday = sameDubaiDay(cell.date, now);
          return (
            <button
              key={i}
              onClick={() => onDayClick(cell.date)}
              className={`min-h-[110px] border-r border-b border-gray-light p-2 text-left text-xs hover:bg-offwhite ${cell.inMonth ? '' : 'bg-gray-50 text-gray-300'}`}
            >
              <div className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${isToday ? 'bg-teal text-white' : 'text-gray-dark'}`}>
                {cell.date.getUTCDate()}
              </div>
              <div className="space-y-1">
                {dayRows.slice(0, 3).map((r) => (
                  <div key={r.id} className={`truncate rounded px-1.5 py-0.5 ${statusColor(r.status)}`}>
                    {formatHHmm(new Date(r.scheduledAt))} · {r.property.code}
                  </div>
                ))}
                {dayRows.length > 3 ? (
                  <div className="text-xs text-gray-medium">+{dayRows.length - 3} more</div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4.2: Commit**

```bash
git add apps/web/src/app/(dashboard)/viewings/_components/calendar-grid.tsx
git commit -m "feat(web): viewings calendar — month grid"
```

---

## Task 5: Day drawer

**Files:**
- Create: `apps/web/src/app/(dashboard)/viewings/_components/day-drawer.tsx`

- [ ] **Step 5.1: Side drawer with the day's rows**

```tsx
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
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!date) return null;
  const dateLabel = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai' });

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-30 bg-black/30" />
      <aside className="fixed right-0 top-0 z-40 h-full w-[400px] overflow-y-auto border-l border-gray-light bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-navy">{dateLabel}</h2>
          <button onClick={onClose} className="text-gray-medium hover:text-gray-dark">✕</button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-medium">No viewings on this day.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-md border border-gray-light p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-semibold text-navy">
                    {new Date(r.scheduledAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })}
                  </span>
                  <StatusPill status={r.status} />
                </div>
                <Link href={`/viewings/${r.id}`} className="block text-sm font-semibold text-navy hover:underline">
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
      </aside>
    </>
  );
}
```

- [ ] **Step 5.2: Commit**

```bash
git add apps/web/src/app/(dashboard)/viewings/_components/day-drawer.tsx
git commit -m "feat(web): viewings calendar — day drawer"
```

---

## Task 6: Rewrite /viewings page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/viewings/page.tsx`

- [ ] **Step 6.1: Replace contents**

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CalendarHeader } from './_components/header';
import { CalendarGrid, type ViewingRow } from './_components/calendar-grid';
import { DayDrawer } from './_components/day-drawer';
import { dubaiNow, monthStart, monthEnd, toISODate, sameDubaiDay } from './_lib/date-utils';

export default function ViewingsPage() {
  const today = dubaiNow();
  const [year, setYear] = useState(today.getUTCFullYear());
  const [monthIndex, setMonthIndex] = useState(today.getUTCMonth());
  const [view, setView] = useState<'month' | 'week'>('month');
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const range = useMemo(() => {
    if (view === 'week') {
      const base = today; // anchor week to today for the v1 of week view
      const dow = (base.getUTCDay() + 6) % 7;
      const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - dow));
      const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
      return { from: toISODate(start), to: toISODate(end) };
    }
    return { from: toISODate(monthStart(year, monthIndex)), to: toISODate(monthEnd(year, monthIndex)) };
  }, [view, year, monthIndex, today]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['viewings', range.from, range.to],
    queryFn: () => api<ViewingRow[]>(`/viewings?from=${range.from}&to=${range.to}`),
  });

  const drawerRows = selectedDay
    ? rows.filter((r) => sameDubaiDay(new Date(r.scheduledAt), selectedDay))
    : [];

  function goPrev() {
    if (monthIndex === 0) { setYear(year - 1); setMonthIndex(11); }
    else setMonthIndex(monthIndex - 1);
  }
  function goNext() {
    if (monthIndex === 11) { setYear(year + 1); setMonthIndex(0); }
    else setMonthIndex(monthIndex + 1);
  }
  function goToday() {
    setYear(today.getUTCFullYear()); setMonthIndex(today.getUTCMonth());
  }

  return (
    <div>
      <header className="mb-6">
        <h1>Viewings</h1>
        <p className="mt-1 text-sm text-gray-medium">Scheduled viewings across all field agents.</p>
      </header>

      <CalendarHeader
        year={year} monthIndex={monthIndex} view={view}
        onPrev={goPrev} onNext={goNext} onToday={goToday}
        onViewChange={setView}
      />

      {isLoading ? (
        <div className="rounded-md border border-gray-light bg-white p-8 text-center text-gray-medium">Loading…</div>
      ) : (
        <CalendarGrid year={year} monthIndex={monthIndex} rows={rows} onDayClick={setSelectedDay} />
      )}

      <DayDrawer date={selectedDay} rows={drawerRows} onClose={() => setSelectedDay(null)} />
    </div>
  );
}
```

- [ ] **Step 6.2: Verify locally**

```bash
pnpm --filter @rentflow/web dev
```

Open `http://localhost:3001/viewings`. Expected: calendar shows current month, today highlighted teal, chips render with the correct HH:mm + property code, click a day → drawer with the day's viewings, click chevrons → month navigates, Esc closes the drawer.

- [ ] **Step 6.3: Commit**

```bash
git add apps/web/src/app/(dashboard)/viewings/page.tsx
git commit -m "feat(web): /viewings becomes a monthly calendar with day-drawer"
```

---

## Task 7: Smoke + deploy

- [ ] **Step 7.1: Run full web build**

```bash
pnpm --filter @rentflow/web build
```
Expected: clean build, no type errors. Pay attention to any class name mismatch from this plan vs the project's actual Tailwind config — fix inline.

- [ ] **Step 7.2: Deploy** — follow the repo's web-deploy command. Production smoke: load `/viewings`, navigate to the prior/next month, click a day with viewings, click a viewing in the drawer → opens detail page.

- [ ] **Step 7.3: Tag follow-ups (separate PRs, not in this plan)**

- Calendar pagination if a month exceeds 500.
- Agent-coloured chips.
- iCal export.
- Drag a chip to reschedule.

---

## Self-review

- Spec coverage: range backend (Task 1), grid (Task 4), drawer (Task 5), header switcher + Today (Task 3), URL/filter chips — *not yet wired*. URL state for filters is left as a follow-up; the spec mentioned it but it is not load-bearing for v1.
- Placeholder scan: no TBDs.
- Type consistency: `ViewingRow` defined in `calendar-grid.tsx` is exported and re-used by `day-drawer.tsx` and `page.tsx`. ✓
