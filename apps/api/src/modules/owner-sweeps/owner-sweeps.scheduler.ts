import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AVAILABILITY_STALE_DAYS,
  FAQ_STALE_DAYS,
  OwnerSweepsService,
} from './owner-sweeps.service';

const OWNER_TICK_CAP = 50;

/**
 * Daily cron at 09:00 Asia/Dubai (05:00 UTC). For every owner with at least
 * one stale property AND no open sweep, creates a sweep including all their
 * stale properties. Round-robin assigns to the field-agent with the oldest
 * `assignedAt`.
 *
 * Set OWNER_SWEEP_ENABLED=false to disable in prod (also short-circuits the
 * posting hook in OwnerSweepsService.ensureOpenSweepIncludes).
 */
@Injectable()
export class OwnerSweepsScheduler {
  private readonly logger = new Logger(OwnerSweepsScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweeps: OwnerSweepsService,
  ) {}

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
      this.logger.log(
        `Owner-sweep cron: companies=${result.companies} owners=${result.owners} created=${result.created} reassigned=${result.reassigned}`,
      );
    } catch (err) {
      this.logger.error(
        `Owner-sweep cron failed: ${(err as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }

  async runManually() {
    return this.runOnce();
  }

  /** Adopt orphan open sweeps (assigneeUserId IS NULL) created during a
   *  window when no active field_agent existed. Round-robin to the agent
   *  with the oldest `assignedAt`. Without this, a momentarily-empty agent
   *  pool permanently strands sweeps because nothing else reassigns them. */
  private async reassignOrphans(companyId: string): Promise<number> {
    const orphans = await this.prisma.ownerSweep.findMany({
      where: {
        companyId,
        status: { in: ['pending', 'in_progress'] },
        assigneeUserId: null,
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (orphans.length === 0) return 0;

    const agents = await this.prisma.user.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'active',
        roles: { has: 'field_agent' as never },
      },
      select: { id: true },
    });
    if (agents.length === 0) return 0;

    const groups = await this.prisma.ownerSweep.groupBy({
      by: ['assigneeUserId'],
      where: { companyId, assigneeUserId: { not: null } },
      _max: { assignedAt: true },
    });
    const lastByAgent = new Map<string, number>();
    for (const g of groups) {
      if (g.assigneeUserId && g._max.assignedAt) {
        lastByAgent.set(g.assigneeUserId, g._max.assignedAt.getTime());
      }
    }
    const queue = agents
      .map((a) => ({ id: a.id, last: lastByAgent.get(a.id) ?? 0 }))
      .sort((a, b) => a.last - b.last);

    const now = new Date();
    let reassigned = 0;
    for (const o of orphans) {
      const pick = queue[0]!;
      await this.prisma.ownerSweep.update({
        where: { id: o.id },
        data: { assigneeUserId: pick.id, assignedAt: now },
      });
      reassigned++;
      pick.last = now.getTime();
      queue.sort((a, b) => a.last - b.last);
    }
    return reassigned;
  }

  private async runOnce() {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    let owners = 0;
    let created = 0;
    let reassigned = 0;
    const availabilityCutoff = new Date(
      Date.now() - AVAILABILITY_STALE_DAYS * 24 * 60 * 60 * 1000,
    );
    const faqCutoff = new Date(Date.now() - FAQ_STALE_DAYS * 24 * 60 * 60 * 1000);

    for (const c of companies) {
      reassigned += await this.reassignOrphans(c.id);
      const candidates = await this.prisma.owner.findMany({
        where: {
          companyId: c.id,
          deletedAt: null,
          ownerSweeps: {
            none: { status: { in: ['pending', 'in_progress'] } },
          },
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
          await this.sweeps.manualCreate(c.id, owner.id, null);
          created++;
        } catch {
          // BadRequest from race or no-stale — fine, skip.
        }
        owners++;
      }
    }
    return { companies: companies.length, owners, created, reassigned };
  }
}
