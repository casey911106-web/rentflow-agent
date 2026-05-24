import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../notifications/push.service';
import { WhatsAppAdapterProvider } from '../whatsapp/adapter.provider';

const MAX_ACTIVE_PER_PUBLISHER = 3; // cap inflight tasks per person
/** Tasks must be completed within this window after assignment, otherwise
 *  the cron marks them `expired` and the package goes back to the pool.
 *  1h is tight by design — keeps coverage moving across publishers and
 *  prevents a single AFK agent from blocking a property all day. */
const ASSIGNMENT_TTL_HOURS = 1;
/** Pacing throttle: even if a publisher has capacity (active < cap), don't
 *  give them another task until this many hours have passed since their
 *  last assignment. Keeps the rhythm digestible — they get one task,
 *  publish it, then a new one shows up. */
const MIN_INTERVAL_BETWEEN_ASSIGNMENTS_HOURS = 1;
const ELIGIBLE_PUBLISHER_ROLES = ['super_admin', 'ops_manager', 'field_agent'];
/** Statuses the round-robin scheduler considers "ready to assign to
 *  publishers". Tightened from the previous laxer set — auto-generated
 *  packages (`generated`, `pending_approval`) used to be treated as in
 *  rotation, which surprised ops who hadn't reviewed them yet. Now an
 *  explicit Approve click is required before publishers see the task. */
const ACTIVE_PACKAGE_STATUSES = ['approved', 'published'];
/** How many placements a single stale day "neutralises" in the priority sort.
 *  Without staleness weight, a package that accidentally accumulates many
 *  placements early stays at the back of the queue forever — the scheduler
 *  keeps picking newer packages that have fewer placements. With this weight,
 *  a package untouched for ~10 days bubbles back even if it has 20 placements. */
const STALENESS_WEIGHT_PER_DAY = 2;
/** Cap so a package that was never assigned doesn't get unbounded priority. */
const MAX_STALENESS_DAYS = 14;

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
    private readonly push: PushService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'placements-round-robin' })
  async tick(): Promise<void> {
    if (this.running) return;
    // Dubai working hours: 9am–10pm local (UTC+4, no DST). We never want
    // to wake up a publisher at 3am with a posting task, even if they
    // technically have an idle slot. Expiry still runs so overdue
    // assignments get marked expired even outside hours.
    const dubaiHour = (new Date().getUTCHours() + 4) % 24;
    const inDubaiWindow = dubaiHour >= 9 && dubaiHour < 22;
    this.running = true;
    try {
      await this.expireOld();
      if (!inDubaiWindow) {
        return;
      }
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
          kind: true,
          growthTargetLabel: true,
          property: { select: { code: true, name: true } },
          _count: { select: { placements: true } },
        },
      });
      if (candidatePackages.length === 0) continue;

      // Per-package last assignment (used by the priority score below — keeps
      // long-untouched packages from being permanently outranked by newer
      // packages with fewer placements).
      const lastAssignedByPackageRows = await this.prisma.postAssignment.groupBy({
        by: ['postPackageId'],
        where: { companyId: company.id },
        _max: { assignedAt: true },
      });
      const lastAssignedByPackage = new Map<string, Date>();
      for (const r of lastAssignedByPackageRows) {
        if (r._max.assignedAt) lastAssignedByPackage.set(r.postPackageId, r._max.assignedAt);
      }

      const nowTs = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      function priorityScore(p: { id: string; _count: { placements: number } }): number {
        const last = lastAssignedByPackage.get(p.id);
        const days = last ? Math.min(MAX_STALENESS_DAYS, (nowTs - last.getTime()) / dayMs) : MAX_STALENESS_DAYS;
        // Lower score = picked first. Placements push the score up; staleness pulls it down.
        return p._count.placements - STALENESS_WEIGHT_PER_DAY * days;
      }

      // Sort: lowest score (fewest placements relative to staleness) first.
      candidatePackages.sort((a, b) => priorityScore(a) - priorityScore(b));

      // Build a map of (publisher → set of package ids assigned in last 24h)
      const cutoff = new Date(nowTs - 24 * 60 * 60 * 1000);
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

      // Fill every publisher up to MAX_ACTIVE_PER_PUBLISHER in a single tick.
      // We iterate publishers round-robin style: outer loop = pass, inner
      // loop = each publisher gets +1 task per pass until they hit the cap
      // or run out of eligible packages.
      const minIntervalMs = MIN_INTERVAL_BETWEEN_ASSIGNMENTS_HOURS * 60 * 60 * 1000;
      let assignedThisPass: number;
      do {
        assignedThisPass = 0;
        for (const pub of publishers) {
          const active = activeMap.get(pub.id) ?? 0;
          if (active >= MAX_ACTIVE_PER_PUBLISHER) continue;

          // Pacing: don't stack assignments on the same publisher in quick
          // succession. Even with capacity, hold off until the previous
          // assignment is at least MIN_INTERVAL_BETWEEN_ASSIGNMENTS_HOURS
          // old, so they can actually publish each one before the next.
          const lastAt = lastAssignedMap.get(pub.id);
          if (lastAt && Date.now() - lastAt.getTime() < minIntervalMs) continue;

          const recent = recentMap.get(pub.id) ?? new Set<string>();
          const target = candidatePackages.find((p) => !recent.has(p.id));
          if (!target) continue;

        const assignment = await this.prisma.postAssignment.create({
          data: {
            companyId: company.id,
            postPackageId: target.id,
            assigneeUserId: pub.id,
            status: 'pending',
            expiresAt,
          },
        });

        const isGrowth = target.kind === 'channel_growth';
        const propCode = target.property?.code ?? '?';
        const propName = target.property?.name ?? target.title ?? '';
        const notifTitle = isGrowth
          ? `Grow channel — ${target.growthTargetLabel ?? target.title ?? 'our channel'}`
          : `Publish task — ${propCode}`;
        const notifBody = isGrowth
          ? `Post the channel-growth promo on as many groups as you can to drive followers to ${target.growthTargetLabel ?? 'our channel'}. 24h to log placements.`
          : `Post ${propCode} ${propName} on as many groups as you can. You have 24h to log placements.`;
        await this.prisma.notification.create({
          data: {
            companyId: company.id,
            userId: pub.id,
            kind: 'info',
            title: notifTitle,
            body: notifBody,
            link: `/posting/${target.id}`,
          },
        });
        // Push to mobile so the agent doesn't have to open the app to find out.
        this.push.notifyPublishingTaskAssigned(pub.id, {
          propertyCode: isGrowth ? 'GROW' : propCode,
          propertyName: isGrowth ? (target.growthTargetLabel ?? target.title ?? 'channel growth') : propName,
          assignmentId: assignment.id,
        });

        // Optional WhatsApp ping — only if 24h window is open with this user.
        if (pub.phoneE164) {
          const windowOpen = await this.has24hWindow(company.id, pub.phoneE164);
          if (windowOpen) {
            const waBody = isGrowth
              ? `📣 New channel-growth task: ${target.growthTargetLabel ?? target.title}. Post in your groups to grow followers. 24h.`
              : `📌 New publish task: ${propCode} (${propName}). You have 24h. Log every group/page you post on so we can score your reach.`;
            try {
              await this.waAdapter.adapter.sendText({
                to: pub.phoneE164,
                body: waBody,
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
          // Mark this publisher as just-assigned so the next pass in the
          // same tick respects the pacing window and skips them.
          lastAssignedMap.set(pub.id, new Date());
          // Bump placement count + mark this package as just-assigned so the
          // priority sort stays accurate across passes in the same tick.
          target._count.placements++;
          lastAssignedByPackage.set(target.id, new Date());
          candidatePackages.sort((a, b) => priorityScore(a) - priorityScore(b));

          assigned++;
          assignedThisPass++;
        }
      } while (assignedThisPass > 0);
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
