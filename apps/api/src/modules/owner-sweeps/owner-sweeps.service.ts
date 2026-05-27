import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OwnerSweepItemAvailability,
  OwnerSweepStatus,
  Prisma,
} from '@rentflow/database';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertyDetailsService } from '../property-details/property-details.service';

export const AVAILABILITY_STALE_DAYS = 7;
export const FAQ_STALE_DAYS = 90;

@Injectable()
export class OwnerSweepsService {
  private readonly logger = new Logger(OwnerSweepsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly details: PropertyDetailsService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Field-agent: list my sweeps
  // ─────────────────────────────────────────────────────────────────────────

  async listMySweeps(companyId: string, userId: string) {
    return this.prisma.ownerSweep.findMany({
      where: {
        companyId,
        assigneeUserId: userId,
        status: { in: ['pending', 'in_progress'] },
      },
      orderBy: { assignedAt: 'asc' },
      include: {
        owner: { select: { id: true, fullName: true, phoneE164: true } },
        items: {
          include: {
            property: {
              select: {
                id: true,
                code: true,
                name: true,
                area: true,
                priceAed: true,
                availabilityConfirmedAt: true,
                detailsCompletedAt: true,
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

  // ─────────────────────────────────────────────────────────────────────────
  // Field-agent: share, set availability, set FAQ, close
  // ─────────────────────────────────────────────────────────────────────────

  async share(sweepId: string, itemId: string, userId: string) {
    const item = await this.requireOwnedItem(sweepId, itemId, userId);
    const publicUrl = `${this.publicWebUrl}/p/${item.property.code}`;
    const firstName = this.firstName(item.sweep.owner.fullName);
    const prefilledText = `Hi ${firstName}, this is RentFlow Agent. Quick check — is this property still available? ${publicUrl}`;
    const phoneDigits = item.sweep.owner.phoneE164.replace(/[^0-9]/g, '');
    const waDeepLink = `whatsapp://send?phone=${phoneDigits}&text=${encodeURIComponent(prefilledText)}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.ownerSweepItem.update({
        where: { id: itemId },
        data: { sharedAt: new Date(), shareLinkUsed: publicUrl },
      });
      await this.markInProgress(tx, item.sweep.id, item.sweep.status);
    });

    return { waDeepLink, publicUrl, prefilledText };
  }

  async setAvailability(
    sweepId: string,
    itemId: string,
    userId: string,
    body: {
      outcome: OwnerSweepItemAvailability;
      rentedUntil?: string;
      newPriceAed?: number;
      notes?: string;
    },
  ) {
    const item = await this.requireOwnedItem(sweepId, itemId, userId);
    const now = new Date();
    const rentedUntil = body.rentedUntil ? new Date(body.rentedUntil) : null;
    const newPrice =
      body.newPriceAed != null ? new Prisma.Decimal(body.newPriceAed) : null;

    return this.prisma.$transaction(async (tx) => {
      await tx.ownerSweepItem.update({
        where: { id: itemId },
        data: {
          availability: body.outcome,
          rentedUntil,
          newPriceAed: newPrice,
          notes: body.notes ?? null,
          // no_answer is a deliberate "asked but no reply" state — resolvedAt
          // is only stamped when the sweep is closed (partial-close behavior).
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
          data: {
            status: 'rented',
            availabilityConfirmedAt: now,
            ...(rentedUntil ? { rentedUntil } : {}),
          },
        });
        await tx.postPackage.updateMany({
          where: {
            companyId: item.property.companyId,
            propertyId: item.property.id,
            status: { in: ['approved', 'published'] },
          },
          data: { status: 'paused', pausedAt: now },
        });
      } else if (body.outcome === 'price_changed') {
        await tx.property.update({
          where: { id: item.property.id },
          data: {
            ...(newPrice ? { priceAed: newPrice } : {}),
            priceConfirmedAt: now,
          },
        });
      }
      return tx.ownerSweepItem.findUnique({ where: { id: itemId } });
    });
  }

  async setFaq(
    sweepId: string,
    itemId: string,
    userId: string,
    answers: Record<string, unknown>,
  ) {
    const item = await this.requireOwnedItem(sweepId, itemId, userId);
    const companyId = item.sweep.companyId;
    const cleaned = await this.details.validateAnswersForCompany(companyId, answers);
    const questions = await this.details.listActiveQuestions(companyId);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const property = await tx.property.findUnique({
        where: { id: item.property.id },
        select: { details: true },
      });
      const merged: Record<string, unknown> = {
        ...((property?.details as Record<string, unknown> | null) ?? {}),
        ...cleaned,
      };
      const allRequired = questions
        .filter((q) => q.isRequired)
        .every((q) => isPresent(merged[q.key]));

      await tx.property.update({
        where: { id: item.property.id },
        data: {
          details: merged as Prisma.InputJsonValue,
          detailsCompletedAt: allRequired ? now : null,
        },
      });

      await tx.ownerSweepItem.update({
        where: { id: itemId },
        data: {
          faqAnswers: cleaned as Prisma.InputJsonValue,
          faqAllRequired: allRequired,
        },
      });

      await this.markInProgress(tx, item.sweep.id, item.sweep.status);
      return tx.ownerSweepItem.findUnique({ where: { id: itemId } });
    });
  }

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
        data: {
          status: 'closed',
          closedAt: now,
          closedBy: userId,
          startedAt: sweep.startedAt ?? now,
        },
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Posting-hook entrypoint + cron creation
  // ─────────────────────────────────────────────────────────────────────────

  /** Ensure there's an open OwnerSweep for the property's owner that includes
   *  this property as an item. Called from PostingService on publish and from
   *  the daily cron. Idempotent — unique([sweepId, propertyId]) makes the
   *  append a no-op when the property is already in an open sweep. */
  async ensureOpenSweepIncludes(
    companyId: string,
    propertyId: string,
    preferredAssigneeUserId: string | null,
  ): Promise<{ sweepId: string | null; created: boolean }> {
    if (process.env.OWNER_SWEEP_ENABLED === 'false') {
      return { sweepId: null, created: false };
    }

    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, companyId, deletedAt: null },
      select: { id: true, ownerId: true },
    });
    if (!property?.ownerId) return { sweepId: null, created: false };

    const existing = await this.prisma.ownerSweep.findFirst({
      where: {
        companyId,
        ownerId: property.ownerId,
        status: { in: ['pending', 'in_progress'] },
      },
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

  // ─────────────────────────────────────────────────────────────────────────
  // Admin
  // ─────────────────────────────────────────────────────────────────────────

  async listAdmin(
    companyId: string,
    filter: {
      status?: OwnerSweepStatus;
      assigneeUserId?: string;
      ownerId?: string;
      from?: string;
      to?: string;
      cursor?: string;
    },
  ) {
    const where: Prisma.OwnerSweepWhereInput = { companyId };
    if (filter.status) where.status = filter.status;
    if (filter.assigneeUserId) where.assigneeUserId = filter.assigneeUserId;
    if (filter.ownerId) where.ownerId = filter.ownerId;
    if (filter.from || filter.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filter.from) createdAt.gte = new Date(filter.from);
      if (filter.to) createdAt.lte = new Date(filter.to);
      where.createdAt = createdAt;
    }
    return this.prisma.ownerSweep.findMany({
      where,
      take: 50,
      orderBy: { createdAt: 'desc' },
      cursor: filter.cursor ? { id: filter.cursor } : undefined,
      skip: filter.cursor ? 1 : 0,
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
        owner: true,
        assignee: true,
        items: {
          include: {
            property: {
              select: {
                id: true,
                code: true,
                name: true,
                area: true,
                priceAed: true,
              },
            },
          },
        },
      },
    });
    if (!sweep) throw new NotFoundException('Sweep not found');
    return sweep;
  }

  async manualCreate(
    companyId: string,
    ownerId: string,
    assigneeUserId: string | null,
  ) {
    const owner = await this.prisma.owner.findFirst({
      where: { id: ownerId, companyId, deletedAt: null },
    });
    if (!owner) throw new NotFoundException('Owner not found');

    const existing = await this.prisma.ownerSweep.findFirst({
      where: { companyId, ownerId, status: { in: ['pending', 'in_progress'] } },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('Open sweep already exists for this owner');
    }

    const staleIds = await this.findStalePropertyIds(companyId, ownerId);
    if (staleIds.length === 0) {
      throw new BadRequestException('Owner has no stale properties');
    }
    const assignee = await this.pickAssignee(companyId, assigneeUserId);
    return this.prisma.ownerSweep.create({
      data: {
        companyId,
        ownerId,
        status: 'pending',
        assigneeUserId: assignee,
        assignedAt: assignee ? new Date() : null,
        items: { create: staleIds.map((id) => ({ propertyId: id })) },
      },
    });
  }

  async reassign(companyId: string, id: string, assigneeUserId: string) {
    const sweep = await this.prisma.ownerSweep.findFirst({
      where: { id, companyId },
    });
    if (!sweep) throw new NotFoundException('Sweep not found');
    if (sweep.status === 'closed') {
      throw new BadRequestException('Sweep already closed');
    }
    return this.prisma.ownerSweep.update({
      where: { id },
      data: { assigneeUserId, assignedAt: new Date() },
    });
  }

  async coverage(companyId: string) {
    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [openSweeps, openOver24h, closedLast7d, items] = await Promise.all([
      this.prisma.ownerSweep.count({
        where: { companyId, status: { in: ['pending', 'in_progress'] } },
      }),
      this.prisma.ownerSweep.count({
        where: {
          companyId,
          status: { in: ['pending', 'in_progress'] },
          assignedAt: { lt: cutoff24h },
        },
      }),
      this.prisma.ownerSweep.count({
        where: { companyId, status: 'closed', closedAt: { gte: cutoff7d } },
      }),
      this.prisma.ownerSweepItem.findMany({
        where: {
          sweep: { companyId, status: 'closed', closedAt: { gte: cutoff7d } },
        },
        select: { availability: true },
      }),
    ]);
    const resolved = items.filter(
      (i) => i.availability && i.availability !== 'no_answer',
    ).length;
    const total = items.length;
    return {
      openSweeps,
      openSweepsOver24h: openOver24h,
      closedLast7d,
      itemsResolvedRate: total === 0 ? 0 : resolved / total,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // privates
  // ─────────────────────────────────────────────────────────────────────────

  private get publicWebUrl(): string {
    const url = process.env.PUBLIC_WEB_URL;
    if (!url) throw new BadRequestException('PUBLIC_WEB_URL not configured');
    return url.replace(/\/$/, '');
  }

  private firstName(full: string | null): string {
    if (!full) return 'there';
    return full.split(/\s+/)[0] ?? full;
  }

  private async markInProgress(
    tx: Prisma.TransactionClient,
    sweepId: string,
    currentStatus: OwnerSweepStatus,
  ) {
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
        sweep: {
          select: {
            id: true,
            status: true,
            assigneeUserId: true,
            ownerId: true,
            companyId: true,
            owner: { select: { fullName: true, phoneE164: true } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Sweep item not found');
    if (item.sweep.assigneeUserId !== userId) {
      throw new ForbiddenException('Not your sweep');
    }
    if (item.sweep.status === 'closed') {
      throw new ForbiddenException('Sweep already closed');
    }
    return item;
  }

  async findStalePropertyIds(companyId: string, ownerId: string): Promise<string[]> {
    const availabilityCutoff = new Date(
      Date.now() - AVAILABILITY_STALE_DAYS * 24 * 60 * 60 * 1000,
    );
    const faqCutoff = new Date(Date.now() - FAQ_STALE_DAYS * 24 * 60 * 60 * 1000);
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

  private async pickAssignee(
    companyId: string,
    preferred: string | null,
  ): Promise<string | null> {
    if (preferred) {
      const ok = await this.prisma.user.findFirst({
        where: {
          id: preferred,
          companyId,
          deletedAt: null,
          status: 'active',
          roles: { has: 'field_agent' as never },
        },
        select: { id: true },
      });
      if (ok) return ok.id;
    }
    const agents = await this.prisma.user.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'active',
        roles: { has: 'field_agent' as never },
      },
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
      if (g.assigneeUserId && g._max.assignedAt) {
        lastByAgent.set(g.assigneeUserId, g._max.assignedAt);
      }
    }
    agents.sort(
      (a, b) =>
        (lastByAgent.get(a.id)?.getTime() ?? 0) -
        (lastByAgent.get(b.id)?.getTime() ?? 0),
    );
    return agents[0]?.id ?? null;
  }
}

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
