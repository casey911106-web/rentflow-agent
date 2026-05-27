# Viewings calendar (web admin) — design

**Date:** 2026-05-27
**Status:** approved (brainstorm)
**Replaces:** the flat-list `/viewings` page in the web admin.

## Problem

The current `/viewings` page (`apps/web/src/app/(dashboard)/viewings/page.tsx`) is a flat table sorted by `scheduledAt`. Ops cannot see the shape of the schedule at a glance: how the month is loaded, which days are empty, which agent is overcommitted on a given day, where the gaps are. The mobile field-agent today/week views work because each agent only has their own viewings, but the admin view spans every agent and needs a different shape.

## Goals

1. Monthly grid as the default view, with each viewing rendered as a chip on its day.
2. Click on a day opens a side drawer with the full detail of that day's viewings (current table row content).
3. Week view as a secondary zoom, same chip semantics.
4. Backend supports range queries (`from` / `to`) so the calendar can fetch a whole month in one round-trip.

## Non-goals

- Drag-and-drop reschedule. Out of scope; clicking a viewing opens detail page as today.
- Calendar in mobile field-agent app. Mobile already has today/week list; not touched.
- Day-of-week / agent-as-row Gantt view. Could come later if month view isn't enough.
- Recurring viewings. Not a concept today.

## Data flow

### Backend

Extend `GET /viewings` (`apps/api/src/modules/viewings/viewings.controller.ts`) to accept `?from=YYYY-MM-DD&to=YYYY-MM-DD` in addition to the existing `?date`, `?status`, `?agentId`, `?propertyId` filters.

In `viewings.service.list`:

```
if (filter.from || filter.to) {
  const start = filter.from ? new Date(filter.from) : new Date('1970-01-01');
  const end = filter.to ? new Date(filter.to) : new Date('2999-12-31');
  end.setUTCHours(23, 59, 59, 999);
  where.scheduledAt = { gte: start, lte: end };
} else if (filter.date) {
  // existing single-day branch
}
```

Increase `take` from 200 → 500 to safely cover a busy month. If a company ever exceeds 500 per month we'll page; for now the cap is a guardrail, not a UX limit.

The existing `?date` parameter stays. Field-agent scoping (line 38 of the service) is unchanged: ops can see all agents, field agents see only their own.

### Frontend

`/viewings/page.tsx` is rewritten as a client component that:

1. Computes `from` and `to` for the visible month (first day to last day, both in Dubai-local then converted to UTC ISO).
2. Fetches `/viewings?from=...&to=...` via `react-query`. Key `['viewings', from, to]`.
3. Renders a 7-column grid, weeks as rows, ISO weeks (Mon-first). Empty leading cells for the previous month padding.

### Calendar grid

Each cell:
- Day number top-left. Today highlighted with the teal `#00A7A5` accent (matches mobile).
- Up to 3 chips visible per day, ordered by `scheduledAt`. Each chip shows `HH:mm` + first letter of the agent's name + status colour-coded:
  - scheduled / confirmed → teal
  - completed → gray
  - no_show / cancelled → red
- If a day has more than 3 viewings, the 4th chip is `+N more`.

### Day drawer

Click on a day → right-side drawer (Tailwind `fixed` panel, 400px wide) listing every viewing for that day with the same columns the current table has (When, Property, Lead, Agent, Status). Each row is clickable → routes to `/viewings/[id]` (existing detail page). The drawer has a close button and an Esc-key handler.

### Header controls

Above the grid:
- `< Month >` arrows + month name. Click month name → year picker.
- `Today` button that snaps the visible month to today.
- View switcher: `Month` (default) / `Week`. Week view renders the same grid but with one row of 7 cells, larger chips (full agent + property code).
- Filter chips: status, agent. Persist in URL search params.

### Empty state

If a month has zero viewings: friendly message under the header, calendar still rendered (you can still see the empty grid and click ahead).

## UX details

- Time formatting always in Dubai locale (UTC+4 no DST).
- Mobile-friendly degradation: under `md` width, switch automatically to a single-column day list scoped to "Today" + a "View calendar" link to a desktop-only modal — preserves the route working on phone without trying to cram a 7-column grid.
- Loading state: skeleton cells (gray pulse) until react-query resolves.
- Empty days are tappable too (opens drawer with `Create viewing` CTA when the user has the `ops_manager` or `super_admin` role).

## What we are not building (deferred)

- Drag a chip to another day to reschedule. Belongs to a later iteration.
- Recurring viewings.
- Agent-coloured chips by avatar / picture. Status colour is enough for now.
- iCal export. Not requested.

## Rollout

- Single PR. Backend change is additive (new optional query params), so no migration and no API contract break — the existing flat-list page would still function until the new code lands.
- After the PR merges, the route `/viewings` shows the calendar by default. No flag needed; the change is purely a UI rewrite.

## Open issues / follow-ups

- None blocking. Possible follow-ups:
  - Pagination if a single month ever exceeds 500 viewings (today RentFlow is nowhere near).
  - Agent-coloured chips.
  - Export to .ics.
