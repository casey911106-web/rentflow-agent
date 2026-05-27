import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertyDetailsService, DETAILS_CHECK_TTL_HOURS } from './property-details.service';

/**
 * Property-details sweep — keeps the rotation moving when assignees go
 * silent. Two passes every hour:
 *   1. Expire any pending check past TTL (status → expired).
 *   2. Re-create a fresh pending check for each property whose latest task
 *      expired or whose details became stale. The service.ensureCheck call
 *      picks the next field agent via round-robin (oldest-assigned first),
 *      so no one publisher hoards the task indefinitely.
 *
 * This is the "asignación indistinta hasta que esté lleno el formulario"
 * loop the product owner asked for.
 */
@Injectable()
export class PropertyDetailsScheduler {
  private readonly logger = new Logger(PropertyDetailsScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly details: PropertyDetailsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'property-details-sweep' })
  async tick(): Promise<void> {
    // Replaced by OwnerSweepsScheduler — kept available behind a flag for
    // rollback. Default off in prod.
    if (process.env.PROPERTY_DETAILS_LEGACY_SWEEP_ENABLED !== 'true') {
      this.logger.debug('Legacy property-details sweep disabled by env flag');
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.runOnce();
      if (result.expired > 0 || result.recreated > 0) {
        this.logger.log(
          `Property-details sweep: expired=${result.expired} recreated=${result.recreated}`,
        );
      }
    } catch (err) {
      this.logger.error(`Property-details sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Manual trigger for ops debugging. */
  async runManually() {
    return this.runOnce();
  }

  private async runOnce(): Promise<{ expired: number; recreated: number }> {
    const now = new Date();

    // 1) Expire stale pending checks.
    const stale = await this.prisma.propertyDetailsCheck.findMany({
      where: { status: 'pending', expiresAt: { lte: now } },
      select: { id: true, companyId: true, propertyId: true },
      take: 200,
    });
    if (stale.length > 0) {
      await this.prisma.propertyDetailsCheck.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { status: 'expired' },
      });
    }

    // 2) For each affected property, ensure a new check exists so the
    //    rotation moves forward. ensureCheck handles assignee selection.
    let recreated = 0;
    const seen = new Set<string>();
    for (const s of stale) {
      const key = `${s.companyId}:${s.propertyId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { created } = await this.details.ensureCheck(s.companyId, s.propertyId, null);
      if (created) recreated++;
    }

    // 3) Also create checks for any active property that's been published
    //    (approved/published packages) but has no live check AND no fresh
    //    details. Covers the case where a property was published before
    //    this feature shipped, or details aged out.
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    for (const company of companies) {
      const candidates = await this.prisma.property.findMany({
        where: {
          companyId: company.id,
          deletedAt: null,
          status: 'available',
          postPackages: { some: { status: { in: ['approved', 'published'] } } },
          OR: [{ detailsCompletedAt: null }, { detailsCompletedAt: { lt: staleCutoff() } }],
          detailsChecks: { none: { status: 'pending', expiresAt: { gt: now } } },
        },
        select: { id: true },
        take: 25,
      });
      for (const c of candidates) {
        const { created } = await this.details.ensureCheck(company.id, c.id, null);
        if (created) recreated++;
      }
    }

    return { expired: stale.length, recreated };
  }
}

function staleCutoff(): Date {
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
}

// Re-export TTL for callers that want to surface it to the UI.
export { DETAILS_CHECK_TTL_HOURS };
