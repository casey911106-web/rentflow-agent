# Owner sweeps — design

**Date:** 2026-05-27
**Status:** approved (brainstorm)
**Replaces (functionally):** per-property `OwnerAvailabilityCheck` cron flow + per-property `PropertyDetailsCheck` cron flow.

## Problem

Today availability and FAQ flows are **per-property**:
- `OwnerAvailabilityScheduler` sends one WhatsApp template per stale property. It is currently disabled (`OWNER_AVAILABILITY_SWEEP_ENABLED!=true`) because the heuristic reply parser produced too many false positives and burned Claude tokens.
- `OwnerReplyParser` matches an inbound owner reply to the *first* pending `OwnerAvailabilityCheck`. When an owner has several stale properties it is ambiguous which one the reply refers to.
- `PropertyDetailsCheck` rows are assigned per-property via hourly round-robin. They are not surfacing reliably for field agents today.
- Owners with several properties get pinged repeatedly with messages that name only the property `code`, which they do not always recognise.

The result: field agents cannot trust either queue, owners get a poor experience, and stale properties stay stale.

## Goals

1. One conversation per owner instead of one ping per property.
2. The field agent drives the conversation offline (phone or own WhatsApp). The mobile app is a checklist; the system never parses inbound owner replies for this flow.
3. Availability and FAQ are answered in the same conversation: for each property, mark availability first; if `available`, fill the pending FAQ.
4. Give the agent a public-link share asset per property so the owner can recognise which property is being discussed.
5. Replace the disabled per-property cron and the unreliable per-property FAQ rotation with a single per-owner sweep entity.

## Non-goals

- Fast-post gating (number of photos, required details at publish time) is out of scope — the publish flow is not touched.
- WhatsApp template approval / Meta integration changes — sweeps are offline to the system.
- Touching `OwnerReplyParser` semantics or removing it. It stays in code, inert relative to sweeps.
- Lead workflow, viewings, scheduler, scoring weights — unchanged.

## Data model

Two new Prisma models. No destructive changes to existing tables and no new columns on `Property` — the existing `availabilityConfirmedAt`, `priceConfirmedAt`, and `detailsCompletedAt` are enough to drive the cron and the readiness score.

```prisma
enum OwnerSweepStatus {
  pending
  in_progress
  closed
}

enum OwnerSweepItemAvailability {
  available
  rented
  price_changed
  no_answer
}

model OwnerSweep {
  id              String   @id @default(cuid())
  companyId       String
  ownerId         String
  status          OwnerSweepStatus
  assigneeUserId  String?
  assignedAt      DateTime?
  startedAt       DateTime?   // first share or first item mark by the agent
  closedAt        DateTime?
  closedBy        String?     // userId that closed the sweep
  createdAt       DateTime    @default(now())
  items           OwnerSweepItem[]

  @@index([companyId, ownerId, status])
  @@index([companyId, assigneeUserId, status])
}

model OwnerSweepItem {
  id               String   @id @default(cuid())
  sweepId          String
  propertyId       String
  availability     OwnerSweepItemAvailability?
  rentedUntil      DateTime?
  newPriceAed      Decimal?
  faqAnswers       Json?    // { questionKey: value } — audit copy
  faqAllRequired   Boolean  @default(false)
  sharedAt         DateTime?  // when agent tapped "Send WA"
  shareLinkUsed    String?
  notes            String?
  resolvedAt       DateTime?

  sweep            OwnerSweep @relation(fields: [sweepId], references: [id], onDelete: Cascade)
  property         Property   @relation(fields: [propertyId], references: [id])

  @@unique([sweepId, propertyId])
  @@index([propertyId])
}
```

### Notes on the model

- `Property.availabilityConfirmedAt` and `Property.priceConfirmedAt` are the single source of truth for readiness scoring. The sweep flow updates them on resolve (see API §`/availability`).
- `OwnerSweepItem.faqAnswers` is an audit copy. The authoritative FAQ data still lives in `Property.details` and is merged on submit, reusing `PropertyDetailsService.validateAnswers`.
- `availability=no_answer` is a *deliberate* terminal state distinct from "not marked". `Property.availabilityConfirmedAt` is **not** touched on `no_answer`.
- `unique([sweepId, propertyId])` makes both the `on-publish` append and the cron creation idempotent.

## Lifecycle

### Creation

Two triggers.

**On-publish hook.** Replaces the call to `propertyDetails.ensureCheck(...)` in `PostingService` (around line 476 of `posting.service.ts`):

```
ownerSweeps.ensureOpenSweepIncludes(companyId, propertyId, preferredAssigneeUserId)
```

Behavior:
- If there is an `OwnerSweep` with status in (`pending`, `in_progress`) for this owner: insert a fresh `OwnerSweepItem(propertyId)`. The unique index makes this a no-op if already present.
- Otherwise: create a new sweep + items covering **all** stale properties of that owner. A property is stale when:
  - `availabilityConfirmedAt is null OR < now() - 7 days`, OR
  - `detailsCompletedAt is null OR < now() - 90 days` (FAQ stale).

**Cron `OwnerSweepScheduler`** — daily at 09:00 Asia/Dubai (`@Cron('0 5 * * *', { timeZone: 'UTC' })`):
- For each owner with at least one stale property AND no open sweep: create a sweep + items for all their stale properties.
- Take a sane cap per tick (e.g. 50 owners) to avoid runaway.

### Assignee selection

Round-robin among active `field_agent` users in the company. Pick the agent with the oldest `assignedAt` over all their sweeps — reuses the same logic as `PropertyDetailsService.pickAssignee`. `preferredAssigneeUserId` from the on-publish path takes priority if that user is a field agent.

### Status transitions

```
pending      → in_progress    first share or first item mark
pending      → closed         agent taps "Close sweep" without touching anything
in_progress  → closed         agent taps "Close sweep"
```

There is no automatic reassignment if the agent does not act within 24h — by Carlos' decision. Sweeps open >24h surface in admin metrics, not in field-agent rotation.

### Partial close

On close:
- Items with `resolvedAt = null` are marked `availability=no_answer`, `resolvedAt=closedAt`.
- `Property.availabilityConfirmedAt` is **not** touched for `no_answer` items — they stay stale.
- The next cron tick (next day at 09:00) will create a new sweep for that owner including those items, because they are still stale.

This guarantees forward progress without retries-within-a-sweep.

## API surface

All routes mounted under `apps/api/src/modules/owner-sweeps/`.

### Field-agent (mobile)

```
GET  /owner-sweeps/my
  → sweeps {pending, in_progress} assigned to current user
  → orderBy assignedAt asc
  → include items.property (id, code, name, area, priceAed, first photo, availabilityConfirmedAt, detailsCompletedAt, pending FAQ count)
  → include owner (id, fullName, phoneE164, preferredLanguage)

POST /owner-sweeps/:id/items/:itemId/share
  body: { channel: 'whatsapp' }
  → POST first, deep-link after on the client.
  → marks sharedAt = now, shareLinkUsed = <PUBLIC_WEB_URL>/p/<code>
  → if sweep.status === 'pending': transitions to in_progress, startedAt=now
  → returns { waDeepLink, publicUrl, prefilledText }
  → text is English (RentFlow field-agent rule)

POST /owner-sweeps/:id/items/:itemId/availability
  body: {
    outcome: 'available' | 'rented' | 'price_changed' | 'no_answer',
    rentedUntil?: ISO,
    newPriceAed?: number,
    notes?: string
  }
  → sets OwnerSweepItem.availability + resolvedAt (unless outcome === 'no_answer', resolvedAt stays null until close)
  → sweep.status: pending → in_progress (sets startedAt = now) if applicable
  → side-effects on Property:
      available      → availabilityConfirmedAt = now, status = 'available'
      rented         → availabilityConfirmedAt = now, status = 'rented',
                       rentedUntil if provided, pause active postPackages
                       (same behavior as today's AvailabilityChecksService.markUnavailable)
      price_changed  → priceAed = newPriceAed if provided, priceConfirmedAt = now,
                       status stays 'available'
      no_answer      → no Property mutation

POST /owner-sweeps/:id/items/:itemId/faq
  body: { answers: { [questionKey]: value } }
  → reuses PropertyDetailsService.validateAnswers + merge into Property.details
  → sets OwnerSweepItem.faqAnswers + faqAllRequired = (every required active question now present)
  → sets Property.detailsCompletedAt if faqAllRequired
  → sweep.status: pending → in_progress

POST /owner-sweeps/:id/close
  → for every item with resolvedAt === null: availability='no_answer', resolvedAt=now
  → sweep.status='closed', closedAt=now, closedBy=user.sub
```

### Admin / ops

```
GET  /owner-sweeps                  paginated, filters: status, assigneeUserId, ownerId, dateRange
GET  /owner-sweeps/:id              full detail incl. items + audit
POST /owner-sweeps                  manual create — body: { ownerId } → builds items from current stale list
POST /owner-sweeps/:id/reassign     body: { assigneeUserId }
GET  /owner-sweeps/coverage         { ownersCovered7d, ownersStale, itemsResolvedRate, openSweeps, openSweepsOver24h }
```

RBAC:
- `field_agent`: `/my` + item POSTs limited to sweeps where `assigneeUserId === user.sub`.
- `ops_manager`, `super_admin`: full surface.

## Mobile UX

Tab `Owner sweeps` replaces both `Availability` and `Property details` tabs in the bottom navigation.

### List screen (`/owner-sweeps`)

Cards keyed by owner. Each card shows:
- Owner fullName + phone
- Property count + breakdown ("3 stale availability · 2 stale FAQ")
- Assigned time ago

Pull-to-refresh + 30s polling while the screen is mounted (consistent with `(tabs)/availability.tsx`).

### Detail screen (`/owner-sweeps/[id]`)

Header: owner name, phone, language, count, two CTAs — `Call` (`tel:`) and `WhatsApp` (`whatsapp://send?phone=...` without prefilled text — the agent decides what to say).

For each item:
- Property code, name, area, price.
- One thumbnail of the first photo.
- "Stale X days" if availability or details are stale.
- `Send WA link` button — fires POST `/items/:id/share`, then `Linking.openURL(waDeepLink)`. The link payload is the public listing URL.
- Availability segmented control with four options: `Available`, `Rented`, `Price changed`, `No answer`. Tap fires POST immediately.
  - `Rented` opens an optional date picker for `rentedUntil`.
  - `Price changed` opens a number input for `newPriceAed`.
- `Fill FAQ` button (badge with pending-required count). Opens modal with active `PropertyDetailQuestion`s pre-loaded from `Property.details`. On submit fires POST `/items/:id/faq` and modal closes.

Footer: `Close sweep` button with a confirm dialog: "Items not marked will be saved as No answer. Close?"

### Push notifications

When sweeps are assigned, a single consolidated push: `"3 owners need check today"`. No per-sweep pushes (avoid feature piling).

### Deprecation banners

Old tabs `Availability` and `Property details` stay in code for one release with a top banner: `"This view is deprecated — use Owner sweeps."` Deep links from notifications redirect to the new tab. The screens are deleted in the follow-up PR after the new flow has 30 days in production.

### Performance scoring

`daily_scores` gains:
- +1 per sweep closed by the agent
- +1 per item with `availability ∈ {available, rented, price_changed}` (i.e. not `no_answer`)

`no_answer` does not penalise — it can reflect a real unresponsive owner.

## Public link

Already implemented at `apps/api/src/modules/public/public.controller.ts` route `GET /public/properties/:code`. The mobile share uses `${PUBLIC_WEB_URL}/p/${property.code}` where `PUBLIC_WEB_URL` is the existing env var used by other features. The route renders photo + area + name + price + description for unauthenticated visitors. No backend changes needed for the share asset.

## Migration / rollout

Order of deploy in `rentflow-agent`:

1. **Prisma migration.** Add `OwnerSweep`, `OwnerSweepItem`, `Property.lastSweepAttemptAt`. Non-destructive.
2. **Backend module.** `apps/api/src/modules/owner-sweeps/`: controller, service, scheduler, module wiring. Unit tests on the service (ensureOpenSweepIncludes idempotency, close partial behavior, FAQ merge into `Property.details`).
3. **Posting hook.** Replace the `propertyDetails.ensureCheck(...)` call in `PostingService` with `ownerSweeps.ensureOpenSweepIncludes(...)`.
4. **Legacy crons.**
   - `OwnerAvailabilityScheduler` is already disabled. Leave the code, add a deprecation log on the manual trigger endpoint.
   - `PropertyDetailsScheduler` gets a new env flag `PROPERTY_DETAILS_LEGACY_SWEEP_ENABLED`, default `false`. Module-level CRUD for `PropertyDetailQuestion` and `coverage()` stay.
5. **Mobile.** New tab + screens. Existing tabs keep deprecation banner for one release.
6. **Admin web.** New `/owner-sweeps` page (list + detail + manual create). Add a "Last sweep" widget to the existing `/owners` detail view.

Rollback path: env flag `OWNER_SWEEP_ENABLED=false` short-circuits the cron and the posting hook (the hook reverts to calling `propertyDetails.ensureCheck`). Mobile list shows empty state. Prisma tables stay in place — empty tables are not a problem.

Cleanup PR (≥30 days after stable): delete `OwnerAvailabilityScheduler`, `PropertyDetailsScheduler`, old mobile tabs, and the legacy env flags.

## Metrics to watch post-deploy

- `# sweeps created/day` — should track `# owners with stale properties`.
- `# sweeps closed/day` — and median time from `assignedAt` to `closedAt`.
- `% items resolved` per sweep (`non-no_answer / total`).
- `# sweeps open > 24h` — surfaces stuck queues.
- After 30 days: % owners with at least one sweep closed in the last 7 days.

## Open issues / follow-ups

None blocking. Possible follow-ups, not in this spec:
- Voice-note attached to a sweep item (Carlos uses voice often during calls).
- Owner self-service link (owner opens a URL, marks their own properties). Would require a different security model and is deliberately deferred.
- Multi-company sweep digest for the admin dashboard.
