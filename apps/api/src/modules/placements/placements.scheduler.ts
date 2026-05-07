import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppAdapterProvider } from '../whatsapp/adapter.provider';

const MAX_ACTIVE_PER_PUBLISHER = 3; // cap inflight tasks per person
const ASSIGNMENT_TTL_HOURS = 24;
const ELIGIBLE_PUBLISHER_ROLES = ['super_admin', 'ops_manager', 'field_agent'];
const ACTIVE_PACKAGE_STATUSES = ['generated', 'scheduled', 'pending_approval', 'approved', 'published'];

/**
 * Round-robin Fast Posting scheduler.
 *
 * Every hour at minute 0:
 *  - Finds publishers in least-recently-active order.
 *  - For each publisher with < MAX_ACTIVE_PER_PUBLISHER pending assignments,
 *    picks the PostPackage they haven't been assigned in the last 24h that
 *    has the FEWEST placements overall (so we spread effort).
 *  - Creates a PostAssignment + an in-app Notification.
 *  - If the publisher has an open 24h WhatsApp window with us, ALSO sends a
 *    plain-text WhatsApp ping (free). If not, we skip WhatsApp — we don't
 *    want to spend on UTILITY templates for internal notifications until
 *    the business has revenue justifying it.
 *
 * Assignments expire after ASSIGNMENT_TTL_HOURS regardless of fulfilment.
 */
@Injectable()
export class PlacementsScheduler {
  private readonly logger = new Logger(PlacementsScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly waAdapter: WhatsAppAdapterProvider,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'placements-round-robin' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.expireOld();
      const result = await this.assignNext();
      if (result.assigned > 0) {
        this.logger.log(
          `Round-robin: assigned=${result.assigned} (${result.notifiedViaWhatsApp} via WA, ${result.assigned - result.notifiedViaWhatsApp} in-app only)`,
        );
      }
    } catch (err) {
      this.logger.error(`Round-robin failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Manual trigger for ops debugging. */
  async runManually() {
    await this.expireOld();
    return this.assignNext();
  }

  private async expireOld(): Promise<void> {
    await this.prisma.postAssignment.updateMany({
      where: { status: 'pending', expiresAt: { lt: new Date() } },
      data: { status: 'expired' },
    });
  }

  private async assignNext(): Promise<{ assigned: number; notifiedViaWhatsApp: number }> {
    let assigned = 0;
    let notifiedViaWhatsApp = 0;

    // Tenant by tenant. Single-tenant today but futureproof.
    const companies = await this.prisma.company.findMany({ where: { deletedAt: null } });

    for (const company of companies) {
      const publishers = await this.prisma.user.findMany({
        where: {
          companyId: company.id,
          deletedAt: null,
          status: 'active',
          roles: { hasSome: ELIGIBLE_PUBLISHER_ROLES as never[] },
        },
        select: { id: true, fullName: true, phoneE164: true },
      });
      if (publishers.length === 0) continue;

      const candidatePackages = await this.prisma.postPackage.findMany({
        where: {
          companyId: company.id,
          deletedAt: null,
          status: { in: ACTIVE_PACKAGE_STATUSES as never[] },
        },
        select: {
          id: true,
          title: true,
          property: { select: { code: true, name: true } },
          _count: { select: { placements: true } },
        },
      });
      if (candidatePackages.length === 0) continue;

      // Sort packages by fewest placements first → distribute coverage.
      candidatePackages.sort((a, b) => a._count.placements - b._count.placements);

      // Build a map of (publisher → set of package ids assigned in last 24h)
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentAssignments = await this.prisma.postAssignment.findMany({
        where: { companyId: company.id, assignedAt: { gte: cutoff } },
        select: { assigneeUserId: true, postPackageId: true },
      });
      const recentMap = new Map<string, Set<string>>();
      for (const a of recentAssignments) {
        if (!recentMap.has(a.assigneeUserId)) recentMap.set(a.assigneeUserId, new Set());
        recentMap.get(a.assigneeUserId)!.add(a.postPackageId);
      }

      // Active counts per publisher
      const activeCounts = await this.prisma.postAssignment.groupBy({
        by: ['assigneeUserId'],
        where: { companyId: company.id, status: 'pending' },
        _count: { _all: true },
      });
      const activeMap = new Map(activeCounts.map((c) => [c.assigneeUserId, c._count._all]));

      // Fairness: sort publishers by their last assignment time (oldest first;
      // never-assigned wins). Pull last assignment for each.
      const lastAssignedRows = await this.prisma.postAssignment.groupBy({
        by: ['assigneeUserId'],
        where: { companyId: company.id },
        _max: { assignedAt: true },
      });
      const lastAssignedMap = new Map(lastAssignedRows.map((r) => [r.assigneeUserId, r._max.assignedAt]));
      publishers.sort((a, b) => {
        const ta = lastAssignedMap.get(a.id)?.getTime() ?? 0;
        const tb = lastAssignedMap.get(b.id)?.getTime() ?? 0;
        return ta - tb;
      });

      const expiresAt = new Date(Date.now() + ASSIGNMENT_TTL_HOURS * 60 * 60 * 1000);

      for (const pub of publishers) {
        const active = activeMap.get(pub.id) ?? 0;
        if (active >= MAX_ACTIVE_PER_PUBLISHER) continue;

        const recent = recentMap.get(pub.id) ?? new Set<string>();
        const target = candidatePackages.find((p) => !recent.has(p.id));
        if (!target) continue;

        await this.prisma.postAssignment.create({
          data: {
            companyId: company.id,
            postPackageId: target.id,
            assigneeUserId: pub.id,
            status: 'pending',
            expiresAt,
          },
        });

        const propCode = target.property?.code ?? '?';
        const propName = target.property?.name ?? target.title ?? '';
        await this.prisma.notification.create({
          data: {
            companyId: company.id,
            userId: pub.id,
            kind: 'info',
            title: `Publish task — ${propCode}`,
            body: `Post ${propCode} ${propName} on as many groups as you can. You have 24h to log placements.`,
            link: `/posting/${target.id}`,
          },
        });

        // Optional WhatsApp ping — only if 24h window is open with this user.
        if (pub.phoneE164) {
          const windowOpen = await this.has24hWindow(company.id, pub.phoneE164);
          if (windowOpen) {
            try {
              await this.waAdapter.adapter.sendText({
                to: pub.phoneE164,
                body: `📌 New publish task: ${propCode} (${propName}). You have 24h. Log every group/page you post on so we can score your reach.`,
                conversationId: `internal:${pub.id}`,
              });
              notifiedViaWhatsApp++;
            } catch (err) {
              this.logger.warn(`WA ping to ${pub.phoneE164} failed: ${(err as Error).message}`);
            }
          }
        }

        // Update tracking maps for next iteration in same tick
        recent.add(target.id);
        recentMap.set(pub.id, recent);
        activeMap.set(pub.id, active + 1);
        // Bump that package's placement count synthetically so the sort still
        // spreads work if multiple publishers exist
        target._count.placements++;
        candidatePackages.sort((a, b) => a._count.placements - b._count.placements);

        assigned++;
      }
    }

    return { assigned, notifiedViaWhatsApp };
  }

  private async has24hWindow(companyId: string, phoneE164: string): Promise<boolean> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const inbound = await this.prisma.whatsAppMessage.findFirst({
      where: {
        companyId,
        direction: 'inbound',
        createdAt: { gte: since },
        conversation: { leadPhoneE164: phoneE164 },
      },
      select: { id: true },
    });
    return !!inbound;
  }
}
