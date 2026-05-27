# Owner sweeps — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-property availability + FAQ flows with a single per-owner `OwnerSweep` entity that the field agent drives offline via a mobile checklist.

**Architecture:** New `OwnerSweep` + `OwnerSweepItem` Prisma models. New Nest module `owner-sweeps` with field-agent + ops API. New daily cron (replaces the disabled `OwnerAvailabilityScheduler`). New mobile tab and new web admin page. Legacy schedulers gated behind env flags and removed in a follow-up after 30 days of stable operation.

**Tech Stack:** NestJS, Prisma, Expo React Native (mobile), Next.js App Router + TanStack Query + Tailwind (web).

**Spec:** `docs/superpowers/specs/2026-05-27-owner-sweeps-design.md`

---

## File map

**Create:**
- `packages/database/prisma/migrations/<ts>_owner_sweeps/migration.sql`
- `apps/api/src/modules/owner-sweeps/owner-sweeps.module.ts`
- `apps/api/src/modules/owner-sweeps/owner-sweeps.service.ts`
- `apps/api/src/modules/owner-sweeps/owner-sweeps.controller.ts`
- `apps/api/src/modules/owner-sweeps/owner-sweeps.scheduler.ts`
- `apps/api/src/modules/owner-sweeps/owner-sweeps.service.spec.ts`
- `apps/mobile/app/(tabs)/owner-sweeps.tsx`
- `apps/mobile/app/owner-sweeps/[id].tsx`
- `apps/web/src/app/(dashboard)/owner-sweeps/page.tsx`
- `apps/web/src/app/(dashboard)/owner-sweeps/[id]/page.tsx`

**Modify:**
- `packages/database/prisma/schema.prisma` (add models + relations on `Owner`, `Property`, `User`, `Company`)
- `apps/api/src/app.module.ts` (register new module)
- `apps/api/src/modules/posting/posting.service.ts` (replace `propertyDetails.ensureCheck` call)
- `apps/api/src/modules/automation/owner-availability.scheduler.ts` (deprecation log)
- `apps/api/src/modules/property-details/property-details.scheduler.ts` (env flag gate)
- `apps/mobile/app/(tabs)/_layout.tsx` (replace Availability + Property details tabs with Owner sweeps)
- `apps/web/src/components/sidebar.tsx` or equivalent nav (add Owner sweeps link)
- `apps/web/src/app/(dashboard)/owners/[id]/page.tsx` (add Last sweep widget)
- `apps/api/src/modules/scores/scores.service.ts` (sweep-closed +1, item-resolved +1)

---

## Task 1: Prisma schema for OwnerSweep + OwnerSweepItem

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1.1: Add two enums + two models at the bottom of the file (before the closing of any datasource block)**

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
  id             String            @id @default(uuid())
  companyId      String
  company        Company           @relation(fields: [companyId], references: [id])
  ownerId        String
  owner          Owner             @relation(fields: [ownerId], references: [id])
  status         OwnerSweepStatus  @default(pending)
  assigneeUserId String?
  assignee       User?             @relation("OwnerSweepAssignee", fields: [assigneeUserId], references: [id])
  assignedAt     DateTime?
  startedAt      DateTime?
  closedAt       DateTime?
  closedBy       String?
  createdAt      DateTime          @default(now())

  items          OwnerSweepItem[]

  @@index([companyId, ownerId, status])
  @@index([companyId, assigneeUserId, status])
}

model OwnerSweepItem {
  id              String                       @id @default(uuid())
  sweepId         String
  sweep           OwnerSweep                   @relation(fields: [sweepId], references: [id], onDelete: Cascade)
  propertyId      String
  property        Property                     @relation(fields: [propertyId], references: [id])
  availability    OwnerSweepItemAvailability?
  rentedUntil     DateTime?
  newPriceAed     Decimal?                     @db.Decimal(12, 2)
  faqAnswers      Json?
  faqAllRequired  Boolean                      @default(false)
  sharedAt        DateTime?
  shareLinkUsed   String?
  notes           String?
  resolvedAt      DateTime?

  @@unique([sweepId, propertyId])
  @@index([propertyId])
}
```

- [ ] **Step 1.2: Add relation back-refs to existing models**

In `model Company` add:
```prisma
ownerSweeps OwnerSweep[]
```

In `model Owner` add:
```prisma
ownerSweeps OwnerSweep[]
```

In `model Property` add:
```prisma
ownerSweepItems OwnerSweepItem[]
```

In `model User` add (next to existing `availabilityChecks`):
```prisma
ownerSweeps OwnerSweep[] @relation("OwnerSweepAssignee")
```

- [ ] **Step 1.3: Generate migration**

Run from repo root:
```bash
pnpm --filter @rentflow/database prisma migrate dev --name owner_sweeps
```
Expected: migration file created + client regenerated.

- [ ] **Step 1.4: Verify client types**

Run:
```bash
pnpm --filter @rentflow/api typecheck
```
Expected: clean. (Should still be clean because no code uses the new types yet.)

- [ ] **Step 1.5: Commit**

```bash
git add packages/database/prisma/
git commit -m "feat(db): add OwnerSweep + OwnerSweepItem models"
```

---

## Task 2: OwnerSweepsService — core methods

**Files:**
- Create: `apps/api/src/modules/owner-sweeps/owner-sweeps.service.ts`
- Create: `apps/api/src/modules/owner-sweeps/owner-sweeps.service.spec.ts`

- [ ] **Step 2.1: Scaffold the service**

```typescript
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Prisma, OwnerSweepStatus, OwnerSweepItemAvailability } from '@rentflow/database';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertyDetailsService } from '../property-details/property-details.service';

export const AVAILABILITY_STALE_DAYS = 7;
export const FAQ_STALE_DAYS = 90;

@Injectable()
export class OwnerSweepsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly details: PropertyDetailsService,
  ) {}

  // (methods below)
}
```

- [ ] **Step 2.2: Implement `staleCutoffs()` helper + `findStaleProperties(ownerId)`**

```typescript
private cutoffs() {
  const now = Date.now();
  return {
    availabilityCutoff: new Date(now - AVAILABILITY_STALE_DAYS * 24 * 60 * 60 * 1000),
    faqCutoff: new Date(now - FAQ_STALE_DAYS * 24 * 60 * 60 * 1000),
  };
}

private async findStalePropertyIds(companyId: string, ownerId: string): Promise<string[]> {
  const { availabilityCutoff, faqCutoff } = this.cutoffs();
  const rows = await this.prisma.property.findMany({
    where: {
      companyId,
      ownerId,
      deletedAt: null,
      status: { notIn: ['archived'] },
      OR: [
        { availabilityConfirmedAt: null },
        { availabilityConfirmedAt: { lt: availabilityCutoff } },
        { detailsCompletedAt: null },
        { detailsCompletedAt: { lt: faqCutoff } },
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
```

- [ ] **Step 2.3: Implement `pickAssignee()` — same round-robin as PropertyDetailsService**

```typescript
private async pickAssignee(companyId: string, preferred: string | null): Promise<string | null> {
  if (preferred) {
    const ok = await this.prisma.user.findFirst({
      where: { id: preferred, companyId, deletedAt: null, status: 'active', roles: { has: 'field_agent' as never } },
      select: { id: true },
    });
    if (ok) return ok.id;
  }
  const agents = await this.prisma.user.findMany({
    where: { companyId, deletedAt: null, status: 'active', roles: { has: 'field_agent' as never } },
    select: { id: true },
  });
  if (agents.length === 0) return null;
  const groups = await this.prisma.ownerSweep.groupBy({
    by: ['assigneeUserId'],
    where: { companyId, assigneeUserId: { not: null } },
    _max: { assignedAt: true },
  });
  const lastByAgent = new Map<string, Date>();
  for (const g of groups) {
    if (g.assigneeUserId && g._max.assignedAt) lastByAgent.set(g.assigneeUserId, g._max.assignedAt);
  }
  agents.sort((a, b) => (lastByAgent.get(a.id)?.getTime() ?? 0) - (lastByAgent.get(b.id)?.getTime() ?? 0));
  return agents[0]?.id ?? null;
}
```

- [ ] **Step 2.4: Implement `ensureOpenSweepIncludes(companyId, propertyId, preferredAssigneeUserId)`**

```typescript
async ensureOpenSweepIncludes(
  companyId: string,
  propertyId: string,
  preferredAssigneeUserId: string | null,
): Promise<{ sweepId: string; created: boolean }> {
  const property = await this.prisma.property.findFirst({
    where: { id: propertyId, companyId, deletedAt: null },
    select: { id: true, ownerId: true },
  });
  if (!property?.ownerId) return { sweepId: '', created: false };

  const existing = await this.prisma.ownerSweep.findFirst({
    where: { companyId, ownerId: property.ownerId, status: { in: ['pending', 'in_progress'] } },
    select: { id: true },
  });
  if (existing) {
    await this.prisma.ownerSweepItem.upsert({
      where: { sweepId_propertyId: { sweepId: existing.id, propertyId } },
      create: { sweepId: existing.id, propertyId },
      update: {},
    });
    return { sweepId: existing.id, created: false };
  }

  const assigneeUserId = await this.pickAssignee(companyId, preferredAssigneeUserId);
  const staleIds = await this.findStalePropertyIds(companyId, property.ownerId);
  const itemIds = Array.from(new Set([propertyId, ...staleIds]));
  const now = new Date();

  const sweep = await this.prisma.ownerSweep.create({
    data: {
      companyId,
      ownerId: property.ownerId,
      status: 'pending',
      assigneeUserId,
      assignedAt: assigneeUserId ? now : null,
      items: { create: itemIds.map((id) => ({ propertyId: id })) },
    },
    select: { id: true },
  });
  return { sweepId: sweep.id, created: true };
}
```

- [ ] **Step 2.5: Write unit tests for `ensureOpenSweepIncludes` idempotency**

In `owner-sweeps.service.spec.ts`, test:
- Property with no owner → no sweep created.
- No existing sweep, owner has 3 stale properties → creates sweep with 3 items.
- Existing pending sweep without this property → upserts item, returns same sweepId.
- Existing pending sweep already with this property → no-op, returns same sweepId.

Use `PrismaService` from a test DB or mock with `vitest`/`jest` per existing project convention. Inspect a peer service spec for the pattern.

Run:
```bash
pnpm --filter @rentflow/api test owner-sweeps
```
Expected: 4 tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add apps/api/src/modules/owner-sweeps/
git commit -m "feat(api): OwnerSweepsService ensureOpenSweepIncludes + tests"
```

---

## Task 3: OwnerSweepsService — list, share, item mutations, close

**Files:**
- Modify: `apps/api/src/modules/owner-sweeps/owner-sweeps.service.ts`
- Modify: `apps/api/src/modules/owner-sweeps/owner-sweeps.service.spec.ts`

- [ ] **Step 3.1: Add `listMySweeps(companyId, userId)`**

```typescript
async listMySweeps(companyId: string, userId: string) {
  return this.prisma.ownerSweep.findMany({
    where: { companyId, assigneeUserId: userId, status: { in: ['pending', 'in_progress'] } },
    orderBy: { assignedAt: 'asc' },
    include: {
      owner: { select: { id: true, fullName: true, phoneE164: true } },
      items: {
        include: {
          property: {
            select: {
              id: true, code: true, name: true, area: true, priceAed: true,
              availabilityConfirmedAt: true, detailsCompletedAt: true,
              media: {
                where: { file: { mimeType: { startsWith: 'image/' } } },
                orderBy: { position: 'asc' },
                take: 1,
                select: { id: true, file: { select: { id: true, mimeType: true } } },
              },
            },
          },
        },
      },
    },
  });
}
```

- [ ] **Step 3.2: Add `share(sweepId, itemId, userId)`**

```typescript
private get publicWebUrl(): string {
  const url = process.env.PUBLIC_WEB_URL;
  if (!url) throw new BadRequestException('PUBLIC_WEB_URL not configured');
  return url.replace(/\/$/, '');
}

async share(sweepId: string, itemId: string, userId: string) {
  const item = await this.requireOwnedItem(sweepId, itemId, userId);
  const publicUrl = `${this.publicWebUrl}/p/${item.property.code}`;
  const text = `Hi ${this.firstName(item.sweep.owner.fullName)}, this is RentFlow Agent. Quick check — is this property still available? ${publicUrl}`;
  const waDeepLink = `whatsapp://send?phone=${item.sweep.owner.phoneE164.replace(/[^0-9]/g, '')}&text=${encodeURIComponent(text)}`;
  await this.prisma.$transaction(async (tx) => {
    await tx.ownerSweepItem.update({
      where: { id: itemId },
      data: { sharedAt: new Date(), shareLinkUsed: publicUrl },
    });
    await this.markInProgress(tx, item.sweep.id, item.sweep.status);
  });
  return { waDeepLink, publicUrl, prefilledText: text };
}

private firstName(full: string | null): string {
  if (!full) return 'there';
  return full.split(/\s+/)[0] ?? full;
}

private async markInProgress(tx: Prisma.TransactionClient, sweepId: string, currentStatus: OwnerSweepStatus) {
  if (currentStatus !== 'pending') return;
  await tx.ownerSweep.update({
    where: { id: sweepId },
    data: { status: 'in_progress', startedAt: new Date() },
  });
}

private async requireOwnedItem(sweepId: string, itemId: string, userId: string) {
  const item = await this.prisma.ownerSweepItem.findFirst({
    where: { id: itemId, sweepId },
    include: {
      property: { select: { id: true, code: true, companyId: true } },
      sweep: { select: { id: true, status: true, assigneeUserId: true, ownerId: true, companyId: true, owner: { select: { fullName: true, phoneE164: true } } } },
    },
  });
  if (!item) throw new NotFoundException('Sweep item not found');
  if (item.sweep.assigneeUserId !== userId) throw new ForbiddenException('Not your sweep');
  if (item.sweep.status === 'closed') throw new ForbiddenException('Sweep already closed');
  return item;
}
```

- [ ] **Step 3.3: Add `setAvailability(sweepId, itemId, userId, body)`**

```typescript
async setAvailability(
  sweepId: string,
  itemId: string,
  userId: string,
  body: { outcome: OwnerSweepItemAvailability; rentedUntil?: string; newPriceAed?: number; notes?: string },
) {
  const item = await this.requireOwnedItem(sweepId, itemId, userId);
  const now = new Date();
  const rentedUntil = body.rentedUntil ? new Date(body.rentedUntil) : null;

  return this.prisma.$transaction(async (tx) => {
    await tx.ownerSweepItem.update({
      where: { id: itemId },
      data: {
        availability: body.outcome,
        rentedUntil,
        newPriceAed: body.newPriceAed != null ? new Prisma.Decimal(body.newPriceAed) : null,
        notes: body.notes ?? null,
        resolvedAt: body.outcome === 'no_answer' ? null : now,
      },
    });
    await this.markInProgress(tx, item.sweep.id, item.sweep.status);

    if (body.outcome === 'available') {
      await tx.property.update({
        where: { id: item.property.id },
        data: { status: 'available', availabilityConfirmedAt: now },
      });
    } else if (body.outcome === 'rented') {
      await tx.property.update({
        where: { id: item.property.id },
        data: { status: 'rented', availabilityConfirmedAt: now, rentedUntil: rentedUntil ?? undefined },
      });
      await tx.postPackage.updateMany({
        where: { companyId: item.property.companyId, propertyId: item.property.id, status: { in: ['approved', 'published'] } },
        data: { status: 'paused', pausedAt: now },
      });
    } else if (body.outcome === 'price_changed') {
      await tx.property.update({
        where: { id: item.property.id },
        data: {
          priceAed: body.newPriceAed != null ? new Prisma.Decimal(body.newPriceAed) : undefined,
          priceConfirmedAt: now,
        },
      });
    }
    return tx.ownerSweepItem.findUnique({ where: { id: itemId } });
  });
}
```

- [ ] **Step 3.4: Add `setFaq(sweepId, itemId, userId, answers)`**

```typescript
async setFaq(sweepId: string, itemId: string, userId: string, answers: Record<string, unknown>) {
  const item = await this.requireOwnedItem(sweepId, itemId, userId);
  const questions = await this.details.listActiveQuestions(item.sweep.companyId);
  const cleaned = (this.details as any).validateAnswers
    ? (this.details as any).validateAnswers(questions, answers)
    : answers; // validateAnswers is private — expose it via a thin public wrapper in PropertyDetailsService if not already public.

  const now = new Date();
  return this.prisma.$transaction(async (tx) => {
    const property = await tx.property.findUnique({
      where: { id: item.property.id },
      select: { details: true },
    });
    const merged = { ...((property?.details as Record<string, unknown> | null) ?? {}), ...cleaned };
    const allRequired = questions.filter((q) => q.isRequired).every((q) => isPresent(merged[q.key]));

    await tx.property.update({
      where: { id: item.property.id },
      data: {
        details: merged as Prisma.InputJsonValue,
        detailsCompletedAt: allRequired ? now : null,
      },
    });

    await tx.ownerSweepItem.update({
      where: { id: itemId },
      data: { faqAnswers: cleaned as Prisma.InputJsonValue, faqAllRequired: allRequired },
    });

    await this.markInProgress(tx, item.sweep.id, item.sweep.status);
    return tx.ownerSweepItem.findUnique({ where: { id: itemId } });
  });
}

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
```

If `validateAnswers` is `private` in `PropertyDetailsService`, in the same step add a public method to it:

```typescript
// in property-details.service.ts
async validateAnswersPublic(companyId: string, answers: Record<string, unknown>) {
  const questions = await this.listActiveQuestions(companyId);
  return this.validateAnswers(questions, answers);
}
```

And call `details.validateAnswersPublic(...)` from `setFaq` instead of the cast.

- [ ] **Step 3.5: Add `close(sweepId, userId)`**

```typescript
async close(sweepId: string, userId: string) {
  const sweep = await this.prisma.ownerSweep.findUnique({ where: { id: sweepId } });
  if (!sweep) throw new NotFoundException('Sweep not found');
  if (sweep.assigneeUserId !== userId) throw new ForbiddenException('Not your sweep');
  if (sweep.status === 'closed') return sweep;
  const now = new Date();
  return this.prisma.$transaction(async (tx) => {
    await tx.ownerSweepItem.updateMany({
      where: { sweepId, resolvedAt: null },
      data: { availability: 'no_answer', resolvedAt: now },
    });
    return tx.ownerSweep.update({
      where: { id: sweepId },
      data: { status: 'closed', closedAt: now, closedBy: userId, startedAt: sweep.startedAt ?? now },
    });
  });
}
```

- [ ] **Step 3.6: Add spec tests covering**

- `share` sets `sharedAt` and bumps sweep to in_progress.
- `setAvailability(available)` updates Property.status + availabilityConfirmedAt; item gets resolvedAt.
- `setAvailability(rented)` pauses postPackages.
- `setAvailability(no_answer)` does NOT set resolvedAt; Property untouched.
- `setFaq` merges into Property.details and sets detailsCompletedAt only when all required filled.
- `close` marks unresolved items as no_answer and resolves them.
- Non-owner field agent gets ForbiddenException.

Run:
```bash
pnpm --filter @rentflow/api test owner-sweeps
```

- [ ] **Step 3.7: Commit**

```bash
git add apps/api/src/modules/owner-sweeps/ apps/api/src/modules/property-details/property-details.service.ts
git commit -m "feat(api): OwnerSweepsService item + close + share methods"
```

---

## Task 4: Admin methods + coverage

**Files:**
- Modify: `apps/api/src/modules/owner-sweeps/owner-sweeps.service.ts`
- Modify: `apps/api/src/modules/owner-sweeps/owner-sweeps.service.spec.ts`

- [ ] **Step 4.1: Add admin `list`, `detail`, `manualCreate`, `reassign`, `coverage`**

```typescript
async listAdmin(companyId: string, filter: { status?: OwnerSweepStatus; assigneeUserId?: string; ownerId?: string; from?: string; to?: string; cursor?: string }) {
  const where: Prisma.OwnerSweepWhereInput = { companyId };
  if (filter.status) where.status = filter.status;
  if (filter.assigneeUserId) where.assigneeUserId = filter.assigneeUserId;
  if (filter.ownerId) where.ownerId = filter.ownerId;
  if (filter.from || filter.to) {
    where.createdAt = {};
    if (filter.from) (where.createdAt as any).gte = new Date(filter.from);
    if (filter.to) (where.createdAt as any).lte = new Date(filter.to);
  }
  return this.prisma.ownerSweep.findMany({
    where, take: 50, orderBy: { createdAt: 'desc' },
    cursor: filter.cursor ? { id: filter.cursor } : undefined, skip: filter.cursor ? 1 : 0,
    include: {
      owner: { select: { fullName: true, phoneE164: true } },
      assignee: { select: { fullName: true } },
      _count: { select: { items: true } },
    },
  });
}

async detail(companyId: string, id: string) {
  const sweep = await this.prisma.ownerSweep.findFirst({
    where: { id, companyId },
    include: {
      owner: true, assignee: true,
      items: { include: { property: { select: { id: true, code: true, name: true, area: true, priceAed: true } } } },
    },
  });
  if (!sweep) throw new NotFoundException();
  return sweep;
}

async manualCreate(companyId: string, ownerId: string, assigneeUserId: string | null) {
  const owner = await this.prisma.owner.findFirst({ where: { id: ownerId, companyId, deletedAt: null } });
  if (!owner) throw new NotFoundException('Owner not found');
  const existing = await this.prisma.ownerSweep.findFirst({
    where: { companyId, ownerId, status: { in: ['pending', 'in_progress'] } },
    select: { id: true },
  });
  if (existing) throw new BadRequestException('Open sweep already exists for this owner');
  const staleIds = await this.findStalePropertyIds(companyId, ownerId);
  if (staleIds.length === 0) throw new BadRequestException('Owner has no stale properties');
  const assignee = await this.pickAssignee(companyId, assigneeUserId);
  return this.prisma.ownerSweep.create({
    data: {
      companyId, ownerId, status: 'pending',
      assigneeUserId: assignee, assignedAt: assignee ? new Date() : null,
      items: { create: staleIds.map((id) => ({ propertyId: id })) },
    },
  });
}

async reassign(companyId: string, id: string, assigneeUserId: string) {
  const sweep = await this.prisma.ownerSweep.findFirst({ where: { id, companyId } });
  if (!sweep) throw new NotFoundException();
  if (sweep.status === 'closed') throw new BadRequestException('Sweep already closed');
  return this.prisma.ownerSweep.update({
    where: { id }, data: { assigneeUserId, assignedAt: new Date() },
  });
}

async coverage(companyId: string) {
  const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [open, openOver24h, closed7d, itemsClosed7d] = await Promise.all([
    this.prisma.ownerSweep.count({ where: { companyId, status: { in: ['pending', 'in_progress'] } } }),
    this.prisma.ownerSweep.count({ where: { companyId, status: { in: ['pending', 'in_progress'] }, assignedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    this.prisma.ownerSweep.count({ where: { companyId, status: 'closed', closedAt: { gte: cutoff7d } } }),
    this.prisma.ownerSweepItem.findMany({
      where: { sweep: { companyId, status: 'closed', closedAt: { gte: cutoff7d } } },
      select: { availability: true },
    }),
  ]);
  const resolved = itemsClosed7d.filter((i) => i.availability && i.availability !== 'no_answer').length;
  const total = itemsClosed7d.length;
  return {
    openSweeps: open, openSweepsOver24h: openOver24h, closedLast7d: closed7d,
    itemsResolvedRate: total === 0 ? 0 : resolved / total,
  };
}
```

- [ ] **Step 4.2: Tests for `manualCreate` + `coverage`**

Run:
```bash
pnpm --filter @rentflow/api test owner-sweeps
```

- [ ] **Step 4.3: Commit**

```bash
git add apps/api/src/modules/owner-sweeps/
git commit -m "feat(api): OwnerSweepsService admin methods + coverage"
```

---

## Task 5: Controller + module wiring

**Files:**
- Create: `apps/api/src/modules/owner-sweeps/owner-sweeps.controller.ts`
- Create: `apps/api/src/modules/owner-sweeps/owner-sweeps.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 5.1: Controller**

```typescript
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { OwnerSweepStatus, OwnerSweepItemAvailability } from '@rentflow/database';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { OwnerSweepsService } from './owner-sweeps.service';

const ADMIN_OPS = ['super_admin', 'ops_manager'] as const;

@ApiTags('owner-sweeps')
@Controller('owner-sweeps')
export class OwnerSweepsController {
  constructor(private readonly sweeps: OwnerSweepsService) {}

  @Get('my')
  my(@CurrentUser() user: JwtPayload) {
    return this.sweeps.listMySweeps(user.companyId, user.sub);
  }

  @Get('coverage')
  @Roles(...ADMIN_OPS)
  coverage(@CurrentUser() user: JwtPayload) {
    return this.sweeps.coverage(user.companyId);
  }

  @Get()
  @Roles(...ADMIN_OPS)
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: OwnerSweepStatus,
    @Query('assigneeUserId') assigneeUserId?: string,
    @Query('ownerId') ownerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.sweeps.listAdmin(user.companyId, { status, assigneeUserId, ownerId, from, to, cursor });
  }

  @Get(':id')
  detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sweeps.detail(user.companyId, id);
  }

  @Post()
  @Roles(...ADMIN_OPS)
  create(@CurrentUser() user: JwtPayload, @Body() body: { ownerId: string; assigneeUserId?: string }) {
    return this.sweeps.manualCreate(user.companyId, body.ownerId, body.assigneeUserId ?? null);
  }

  @Post(':id/reassign')
  @Roles(...ADMIN_OPS)
  reassign(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: { assigneeUserId: string }) {
    return this.sweeps.reassign(user.companyId, id, body.assigneeUserId);
  }

  @Post(':id/close')
  close(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sweeps.close(id, user.sub);
  }

  @Post(':id/items/:itemId/share')
  share(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.sweeps.share(id, itemId, user.sub);
  }

  @Post(':id/items/:itemId/availability')
  availability(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { outcome: OwnerSweepItemAvailability; rentedUntil?: string; newPriceAed?: number; notes?: string },
  ) {
    return this.sweeps.setAvailability(id, itemId, user.sub, body);
  }

  @Post(':id/items/:itemId/faq')
  faq(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { answers: Record<string, unknown> },
  ) {
    return this.sweeps.setFaq(id, itemId, user.sub, body.answers);
  }
}
```

- [ ] **Step 5.2: Module**

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PropertyDetailsModule } from '../property-details/property-details.module';
import { OwnerSweepsService } from './owner-sweeps.service';
import { OwnerSweepsController } from './owner-sweeps.controller';
import { OwnerSweepsScheduler } from './owner-sweeps.scheduler';

@Module({
  imports: [PrismaModule, PropertyDetailsModule],
  controllers: [OwnerSweepsController],
  providers: [OwnerSweepsService, OwnerSweepsScheduler],
  exports: [OwnerSweepsService],
})
export class OwnerSweepsModule {}
```

- [ ] **Step 5.3: Register in `app.module.ts`**

Add `import { OwnerSweepsModule } from './modules/owner-sweeps/owner-sweeps.module';` and add `OwnerSweepsModule` to the `imports` array.

- [ ] **Step 5.4: Verify typecheck + e2e the routes**

```bash
pnpm --filter @rentflow/api typecheck
pnpm --filter @rentflow/api start
# in another shell:
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/owner-sweeps/coverage
```
Expected: 200 with `{ openSweeps: 0, ... }`.

- [ ] **Step 5.5: Commit**

```bash
git add apps/api/src/modules/owner-sweeps/ apps/api/src/app.module.ts
git commit -m "feat(api): wire OwnerSweepsModule + controller"
```

---

## Task 6: Daily cron — OwnerSweepsScheduler

**Files:**
- Create: `apps/api/src/modules/owner-sweeps/owner-sweeps.scheduler.ts`

- [ ] **Step 6.1: Scheduler**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnerSweepsService, AVAILABILITY_STALE_DAYS, FAQ_STALE_DAYS } from './owner-sweeps.service';

const OWNER_TICK_CAP = 50;

@Injectable()
export class OwnerSweepsScheduler {
  private readonly logger = new Logger(OwnerSweepsScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweeps: OwnerSweepsService,
  ) {}

  /** Daily at 09:00 Asia/Dubai (05:00 UTC). */
  @Cron('0 5 * * *', { name: 'owner-sweeps-daily', timeZone: 'UTC' })
  async tick(): Promise<void> {
    if (process.env.OWNER_SWEEP_ENABLED === 'false') {
      this.logger.debug('Owner-sweep cron disabled by env flag');
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.runOnce();
      this.logger.log(`Owner-sweep cron: companies=${result.companies} owners=${result.owners} created=${result.created}`);
    } catch (err) {
      this.logger.error(`Owner-sweep cron failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async runManually() { return this.runOnce(); }

  private async runOnce() {
    const companies = await this.prisma.company.findMany({ where: { deletedAt: null }, select: { id: true } });
    let owners = 0, created = 0;
    const availabilityCutoff = new Date(Date.now() - AVAILABILITY_STALE_DAYS * 24 * 60 * 60 * 1000);
    const faqCutoff = new Date(Date.now() - FAQ_STALE_DAYS * 24 * 60 * 60 * 1000);

    for (const c of companies) {
      const candidates = await this.prisma.owner.findMany({
        where: {
          companyId: c.id, deletedAt: null,
          ownerSweeps: { none: { status: { in: ['pending', 'in_progress'] } } },
          properties: {
            some: {
              deletedAt: null,
              status: { notIn: ['archived'] },
              OR: [
                { availabilityConfirmedAt: null },
                { availabilityConfirmedAt: { lt: availabilityCutoff } },
                { detailsCompletedAt: null },
                { detailsCompletedAt: { lt: faqCutoff } },
              ],
            },
          },
        },
        select: { id: true },
        take: OWNER_TICK_CAP,
      });

      for (const owner of candidates) {
        try {
          const result = await this.sweeps.manualCreate(c.id, owner.id, null);
          if (result) created++;
        } catch {
          // BadRequestException("no stale") races against another tick — ignore.
        }
        owners++;
      }
    }
    return { companies: companies.length, owners, created };
  }
}
```

- [ ] **Step 6.2: Manual trigger endpoint (ops only)**

Add to the controller:

```typescript
@Post('cron/run-once')
@Roles(...ADMIN_OPS)
runCron() { return this.scheduler.runManually(); }
```

And inject `OwnerSweepsScheduler` into the controller constructor.

- [ ] **Step 6.3: Run locally + verify**

```bash
pnpm --filter @rentflow/api start
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/owner-sweeps/cron/run-once
```
Expected: `{ companies: N, owners: M, created: K }`.

- [ ] **Step 6.4: Commit**

```bash
git add apps/api/src/modules/owner-sweeps/
git commit -m "feat(api): daily OwnerSweepsScheduler + manual trigger"
```

---

## Task 7: PostingService hook + legacy deprecation

**Files:**
- Modify: `apps/api/src/modules/posting/posting.service.ts`
- Modify: `apps/api/src/modules/posting/posting.module.ts`
- Modify: `apps/api/src/modules/automation/owner-availability.scheduler.ts`
- Modify: `apps/api/src/modules/property-details/property-details.scheduler.ts`

- [ ] **Step 7.1: Inject `OwnerSweepsService` into `PostingService`**

In `posting.service.ts` constructor add `private readonly ownerSweeps: OwnerSweepsService,`.
In `posting.module.ts` add `OwnerSweepsModule` to imports.

- [ ] **Step 7.2: Replace `propertyDetails.ensureCheck` call**

Find the call around line 476 (`this.propertyDetails.ensureCheck(companyId, pkg.propertyId, userId)`) and replace with:

```typescript
this.ownerSweeps
  .ensureOpenSweepIncludes(companyId, pkg.propertyId, userId)
  .catch((err) =>
    this.logger.warn(`ensureOpenSweepIncludes failed for property ${pkg.propertyId}: ${(err as Error).message}`),
  );
```

Keep the existing `propertyDetails.ensureCheck` import only if it is still used elsewhere; otherwise remove it.

- [ ] **Step 7.3: Gate `PropertyDetailsScheduler` behind flag**

In `property-details.scheduler.ts` top of `tick()`:

```typescript
if (process.env.PROPERTY_DETAILS_LEGACY_SWEEP_ENABLED !== 'true') {
  this.logger.debug('Legacy property-details sweep disabled by env flag');
  return;
}
```

- [ ] **Step 7.4: Deprecation log on `OwnerAvailabilityScheduler.runManually()`**

```typescript
async runManually(): Promise<{ pinged: number; skipped: number }> {
  this.logger.warn('OwnerAvailabilityScheduler.runManually is deprecated — use OwnerSweepsScheduler');
  return this.runSweep();
}
```

- [ ] **Step 7.5: Run posting flow locally — publish a package, confirm a sweep is created**

```bash
pnpm --filter @rentflow/api start
# Post a fast-post package via the admin UI or curl, then:
psql "$DATABASE_URL" -c 'SELECT id, "ownerId", status FROM "OwnerSweep" ORDER BY "createdAt" DESC LIMIT 5;'
```
Expected: a fresh row with status `pending` and items linked.

- [ ] **Step 7.6: Commit**

```bash
git add apps/api/src/modules/posting/ apps/api/src/modules/automation/ apps/api/src/modules/property-details/
git commit -m "feat(api): wire posting → OwnerSweeps + gate legacy schedulers"
```

---

## Task 8: Mobile — Owner sweeps tab (list)

**Files:**
- Create: `apps/mobile/app/(tabs)/owner-sweeps.tsx`
- Modify: `apps/mobile/app/(tabs)/_layout.tsx`

- [ ] **Step 8.1: Replace tabs in `_layout.tsx`**

Locate the two existing `Tabs.Screen` entries for `availability` and `property-details`. Replace both with a single:

```tsx
<Tabs.Screen
  name="owner-sweeps"
  options={{
    title: 'Owners',
    tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color} />,
  }}
/>
```

(Use the icon library already in the project — check the other tabs for the import.)

The original two tab files (`availability.tsx`, `property-details.tsx`) stay on disk for the deprecation release; they just lose their tab entry.

- [ ] **Step 8.2: List screen**

```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../lib/api';

interface SweepItem {
  id: string;
  availability: string | null;
  resolvedAt: string | null;
  property: {
    id: string; code: string; name: string; area: string | null; priceAed: string | null;
    availabilityConfirmedAt: string | null; detailsCompletedAt: string | null;
  };
}
interface Sweep {
  id: string;
  status: 'pending' | 'in_progress' | 'closed';
  assignedAt: string | null;
  owner: { id: string; fullName: string | null; phoneE164: string };
  items: SweepItem[];
}

function staleSummary(items: SweepItem[]) {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let staleAvail = 0, staleFaq = 0;
  for (const i of items) {
    const conf = i.property.availabilityConfirmedAt ? new Date(i.property.availabilityConfirmedAt).getTime() : 0;
    const det = i.property.detailsCompletedAt ? new Date(i.property.detailsCompletedAt).getTime() : 0;
    if (now - conf > sevenDays) staleAvail++;
    if (now - det > ninetyDays) staleFaq++;
  }
  return `${staleAvail} stale availability · ${staleFaq} stale FAQ`;
}

export default function OwnerSweepsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Sweep[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<Sweep[]>('/owner-sweeps/my');
      setItems(data);
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (loading) return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator color="#00A7A5" />
    </View>
  );

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: '#F8FAFC' }}>
      {error ? <Text style={{ color: '#DC2626', marginBottom: 12, fontSize: 13 }}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 64 }}>
            <Text style={{ color: '#64748B' }}>No owner sweeps today 👌</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/owner-sweeps/${item.id}` as never)}
            style={{ backgroundColor: 'white', padding: 14, borderRadius: 12, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: item.status === 'in_progress' ? '#F59E0B' : '#00A7A5' }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', color: '#061D3F' }}>{item.owner.fullName ?? item.owner.phoneE164}</Text>
              <Text style={{ color: '#64748B', fontSize: 12 }}>{item.items.length} props</Text>
            </View>
            <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 4 }}>{staleSummary(item.items)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
```

- [ ] **Step 8.3: Verify locally on simulator**

```bash
pnpm --filter @rentflow/mobile start
```
Expected: tab `Owners` shows the assigned sweeps. Empty state if none.

- [ ] **Step 8.4: Commit**

```bash
git add apps/mobile/app/
git commit -m "feat(mobile): Owner sweeps tab — list screen"
```

---

## Task 9: Mobile — sweep detail screen

**Files:**
- Create: `apps/mobile/app/owner-sweeps/[id].tsx`

- [ ] **Step 9.1: Screen with header + checklist + close**

Build the screen following the UX section of the spec. Key interactions:
- Header: owner name, phone, count. Two buttons: `Call` (`Linking.openURL('tel:...')`), `WhatsApp` (`Linking.openURL('whatsapp://send?phone=...')`).
- Per item card: code, name, price, primary photo thumb, `Send WA link` button, availability segmented control (Available / Rented / Price changed / No answer), `Fill FAQ` button.
- `Send WA link` does:

```tsx
async function sendWa(sweepId: string, itemId: string) {
  const res = await api<{ waDeepLink: string; publicUrl: string; prefilledText: string }>(
    `/owner-sweeps/${sweepId}/items/${itemId}/share`,
    { method: 'POST', body: JSON.stringify({ channel: 'whatsapp' }) },
  );
  await Linking.openURL(res.waDeepLink);
}
```

- Availability radio uses POST `/owner-sweeps/:id/items/:itemId/availability` with the chosen outcome. After 200 the screen refetches the sweep (or optimistically updates).
- `Fill FAQ` opens a modal that fetches `/property-details/questions` (active questions endpoint — verify the route on the existing module; it may be `/property-detail-questions` or similar) and renders inputs by `type`. On submit POSTs to `/owner-sweeps/:id/items/:itemId/faq`.
- Footer button `Close sweep` shows a confirm dialog (`Alert.alert`). On confirm POSTs `/owner-sweeps/:id/close` and `router.back()`.

Polling: refetch every 30s while mounted, plus pull-to-refresh.

The full file is too long to inline here in one step. Build it incrementally with one commit per chunk (header, item card, modal, close).

- [ ] **Step 9.2: Test the share button on a real device**

`Send WA link` must open WhatsApp with the right phone + text. On simulator this typically fails — verify on a physical device.

- [ ] **Step 9.3: Commit**

```bash
git add apps/mobile/app/owner-sweeps/
git commit -m "feat(mobile): owner sweep detail screen"
```

---

## Task 10: Web admin — list + detail page

**Files:**
- Create: `apps/web/src/app/(dashboard)/owner-sweeps/page.tsx`
- Create: `apps/web/src/app/(dashboard)/owner-sweeps/[id]/page.tsx`
- Modify: `apps/web/src/components/sidebar.tsx` (or whichever file holds the nav links)

- [ ] **Step 10.1: List page**

Mirror the structure of `apps/web/src/app/(dashboard)/viewings/page.tsx` (table layout, react-query, StatusPill). Columns: Owner · Properties (count) · Assignee · Created · Status · Open >24h badge. Filter bar: status select, agent select. Each row links to `/owner-sweeps/:id`.

Headers / wrapper: `Coverage: open=X, >24h=Y, closedLast7d=Z, resolvedRate=W%` from `/owner-sweeps/coverage`.

- [ ] **Step 10.2: Detail page**

Read-only view of all items in the sweep with their availability outcome + resolvedAt + notes + sharedAt. Ops-only `Reassign` button (modal with field-agent picker) and `Close on agent's behalf` button (calls the existing close endpoint with admin override — needs a small adjustment in the controller to allow ops to close any sweep; add `Roles(...ADMIN_OPS)` route variant if necessary).

`Manual create` is a button in the list page header that opens a modal with an owner picker. POSTs to `/owner-sweeps` with `{ ownerId }`.

- [ ] **Step 10.3: Sidebar link**

Add `Owner sweeps` entry. Visible to all roles; the page itself enforces RBAC.

- [ ] **Step 10.4: Verify locally**

```bash
pnpm --filter @rentflow/web dev
```
Open `http://localhost:3001/owner-sweeps`. Expected: list view with filter chips; click into a sweep, see items.

- [ ] **Step 10.5: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): /owner-sweeps list + detail + sidebar"
```

---

## Task 11: Owners page — Last sweep widget

**Files:**
- Modify: `apps/web/src/app/(dashboard)/owners/[id]/page.tsx` (verify exact path; if owners are not currently a route, skip this task)

- [ ] **Step 11.1: Fetch the last sweep for the owner**

```tsx
const { data: lastSweep } = useQuery({
  queryKey: ['owner-last-sweep', ownerId],
  queryFn: () => api<{ id: string; status: string; closedAt: string | null; createdAt: string }[]>(`/owner-sweeps?ownerId=${ownerId}`),
  select: (rows) => rows[0] ?? null,
});
```

- [ ] **Step 11.2: Render widget**

Box with: status pill, "Last sweep N days ago", "X/Y items resolved", link to the sweep detail. If no sweep ever: "Never swept — [Start sweep]" CTA that POSTs `/owner-sweeps` with `{ ownerId }`.

- [ ] **Step 11.3: Commit**

```bash
git add apps/web/src/app/(dashboard)/owners/
git commit -m "feat(web): Owners — Last sweep widget"
```

---

## Task 12: Performance scoring

**Files:**
- Modify: `apps/api/src/modules/scores/scores.service.ts`

- [ ] **Step 12.1: Inspect the existing daily-scores computation**

Open the file, find where existing actions are scored. Identify the function that computes `daily_scores` for a field agent on a given day.

- [ ] **Step 12.2: Add sweep-closed + item-resolved counters**

Add a query block for the day:

```typescript
const sweepsClosed = await this.prisma.ownerSweep.count({
  where: { companyId, assigneeUserId: userId, status: 'closed', closedAt: { gte: dayStart, lt: dayEnd } },
});
const itemsResolved = await this.prisma.ownerSweepItem.count({
  where: {
    sweep: { companyId, assigneeUserId: userId, status: 'closed', closedAt: { gte: dayStart, lt: dayEnd } },
    availability: { in: ['available', 'rented', 'price_changed'] },
  },
});
score += sweepsClosed + itemsResolved;
```

Match the field name (`score`, `sweep_score`, etc.) the existing code uses.

- [ ] **Step 12.3: Commit**

```bash
git add apps/api/src/modules/scores/
git commit -m "feat(api): score sweep close + item resolved"
```

---

## Task 13: Deprecation banners + tab cleanup

**Files:**
- Modify: `apps/mobile/app/(tabs)/availability.tsx`
- Modify: `apps/mobile/app/(tabs)/property-details.tsx`

- [ ] **Step 13.1: Add banner at top of each old screen**

```tsx
<View style={{ backgroundColor: '#FEF3C7', padding: 12, borderRadius: 8, marginBottom: 12 }}>
  <Text style={{ color: '#92400E', fontSize: 13, fontWeight: '600' }}>
    This view is deprecated — use the Owners tab.
  </Text>
</View>
```

These screens stay on disk for one release; the tab navigation no longer surfaces them (handled in Task 8.1). Existing push notifications that deep-link to `/availability/:id` keep working until the follow-up cleanup PR.

- [ ] **Step 13.2: Commit**

```bash
git add apps/mobile/app/(tabs)/
git commit -m "feat(mobile): deprecation banner on legacy availability + property-details screens"
```

---

## Task 14: Rollback flag end-to-end test

**Files:** no code changes — runtime verification.

- [ ] **Step 14.1: With `OWNER_SWEEP_ENABLED=false`**

Restart the API. Verify:
- `POST /owner-sweeps/cron/run-once` → returns `{ companies: 0, owners: 0, created: 0 }` (cron path short-circuited).
- The posting hook in Task 7 must also short-circuit. Update `ensureOpenSweepIncludes` to early-return when the flag is false:

```typescript
async ensureOpenSweepIncludes(...) {
  if (process.env.OWNER_SWEEP_ENABLED === 'false') return { sweepId: '', created: false };
  // ...
}
```

Re-commit this small adjustment in the same task.

- [ ] **Step 14.2: With the flag unset (default behavior)**

Verify everything works normally end-to-end.

- [ ] **Step 14.3: Commit**

```bash
git add apps/api/src/modules/owner-sweeps/owner-sweeps.service.ts
git commit -m "feat(api): OWNER_SWEEP_ENABLED=false short-circuits ensureOpenSweepIncludes"
```

---

## Task 15: Deploy + smoke

- [ ] **Step 15.1: Backend deploy** — follow the repo's deploy script (`bash deploy.sh` per repo convention; check `rentflow-agent/deploy/` for the actual command).

- [ ] **Step 15.2: Mobile bundle**

```bash
cd apps/mobile
eas update --branch production
```

- [ ] **Step 15.3: Smoke checklist**

- A new fast-post publish creates / appends to a sweep for the property's owner (verify via Postgres query).
- Field agent opens the mobile `Owners` tab, sees the sweep, taps `Send WA link`, WhatsApp opens with the right text.
- Field agent marks an item Available → property's `availabilityConfirmedAt` updates.
- Field agent fills FAQ → `Property.details` merges correctly.
- Field agent closes the sweep with one item untouched → that item becomes `no_answer`.
- Admin `/owner-sweeps` page lists the sweep.

---

## Out of scope (do NOT do in this plan)

- Anything touching the fast-post publish gating (photos/details required at publish). Carlos confirmed out of scope.
- Removing legacy schedulers' files (deferred 30 days after stable production).
- WhatsApp template registration with Meta (offline flow — no template needed).
- Modifying `OwnerReplyParser` heuristics.
