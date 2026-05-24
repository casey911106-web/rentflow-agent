import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../notifications/push.service';

/** A property needs a fresh check if no Check (replied OR still within TTL)
 *  has been logged in this many days. Keeps the operational tempo: at most one
 *  check per property per week. */
const STALE_AFTER_DAYS = 7;
/** Each check is the agent's task for the next N hours. After that the next
 *  cron tick will create a new Check for the same property and reassign. */
const CHECK_TTL_HOURS = 24;
/** Cap inflight checks per agent so a slow responder doesn't hoard the queue. */
const MAX_ACTIVE_PER_AGENT = 5;

/**
 * Owner availability sweep — every 12h pick field agents in least-recently-
 * active order, hand each one a property whose owner we haven't pinged in 7+
 * days. The agent confirms available / unavailable from mobile; unavailable
 * auto-pauses that property's posting rotation.
 */
@Injectable()
export class AvailabilityChecksScheduler {
  private readonly logger = new Logger(AvailabilityChecksScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  @Cron(CronExpression.EVERY_12_HOURS, { name: 'availability-checks-sweep' })
  async tick(): Promise<void> {
    if (this.running) return;
    const dubaiHour = (new Date().getUTCHours() + 4) % 24;
    const inDubaiWindow = dubaiHour >= 9 && dubaiHour < 22;
    if (!inDubaiWindow) return;
    this.running = true;
    try {
      const result = await this.assignNext();
      if (result.assigned > 0) {
        this.logger.log(`Availability sweep: assigned=${result.assigned} checks across ${result.agents} agents`);
      }
    } catch (err) {
      this.logger.error(`Availability sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Manual trigger for ops debugging. */
  async runManually() {
    return this.assignNext();
  }

  private async assignNext(): Promise<{ assigned: number; agents: number }> {
    let assigned = 0;
    let agents = 0;

    const companies = await this.prisma.company.findMany({ where: { deletedAt: null } });

    for (const company of companies) {
      const fieldAgents = await this.prisma.user.findMany({
        where: {
          companyId: company.id,
          deletedAt: null,
          status: 'active',
          roles: { has: 'field_agent' as never },
        },
        select: { id: true, fullName: true },
      });
      if (fieldAgents.length === 0) continue;
      agents += fieldAgents.length;

      const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
      const now = new Date();

      // Properties that need a check: have an owner, are nominally available,
      // are actively being published (have an approved/published package), AND
      // have no recent valid check (replied within window OR still pending+not-expired).
      const candidateProperties = await this.prisma.property.findMany({
        where: {
          companyId: company.id,
          deletedAt: null,
          status: 'available',
          ownerId: { not: null },
          postPackages: { some: { status: { in: ['approved', 'published'] } } },
          ownerAvailabilityChecks: {
            none: {
              OR: [
                { repliedAt: { gte: staleCutoff } },
                { AND: [{ repliedAt: null }, { expiresAt: { gt: now } }] },
              ],
            },
          },
        },
        select: { id: true, ownerId: true, code: true, name: true },
        take: 50, // safety cap per tick
      });
      if (candidateProperties.length === 0) continue;

      // Active counts per agent (so we don't pile up).
      const activeCounts = await this.prisma.ownerAvailabilityCheck.groupBy({
        by: ['assigneeUserId'],
        where: { companyId: company.id, status: 'pending_response', expiresAt: { gt: now } },
        _count: { _all: true },
      });
      const activeMap = new Map<string, number>();
      for (const c of activeCounts) {
        if (c.assigneeUserId) activeMap.set(c.assigneeUserId, c._count._all);
      }

      // Fairness: oldest-assigned first.
      const lastAssignedRows = await this.prisma.ownerAvailabilityCheck.groupBy({
        by: ['assigneeUserId'],
        where: { companyId: company.id, assigneeUserId: { not: null } },
        _max: { assignedAt: true },
      });
      const lastAssignedMap = new Map<string, Date>();
      for (const r of lastAssignedRows) {
        if (r.assigneeUserId && r._max.assignedAt) {
          lastAssignedMap.set(r.assigneeUserId, r._max.assignedAt);
        }
      }
      fieldAgents.sort((a, b) => {
        const ta = lastAssignedMap.get(a.id)?.getTime() ?? 0;
        const tb = lastAssignedMap.get(b.id)?.getTime() ?? 0;
        return ta - tb;
      });

      const expiresAt = new Date(now.getTime() + CHECK_TTL_HOURS * 60 * 60 * 1000);
      let agentIdx = 0;

      for (const prop of candidateProperties) {
        if (!prop.ownerId) continue;
        let safety = 0;
        while (safety < fieldAgents.length) {
          const agent = fieldAgents[agentIdx % fieldAgents.length];
          agentIdx++;
          safety++;
          const active = activeMap.get(agent.id) ?? 0;
          if (active >= MAX_ACTIVE_PER_AGENT) continue;

          await this.prisma.ownerAvailabilityCheck.create({
            data: {
              companyId: company.id,
              ownerId: prop.ownerId,
              propertyId: prop.id,
              status: 'pending_response',
              assigneeUserId: agent.id,
              assignedAt: now,
              expiresAt,
            },
          });
          await this.prisma.notification.create({
            data: {
              companyId: company.id,
              userId: agent.id,
              kind: 'info',
              title: `Disponibilidad — ${prop.code}`,
              body: `Confirma con el dueño si ${prop.code} (${prop.name}) sigue disponible. 24h.`,
              link: '/availability',
            },
          });
          this.push.notifyAvailabilityCheckAssigned(agent.id, {
            propertyCode: prop.code,
            propertyName: prop.name,
          });

          activeMap.set(agent.id, active + 1);
          lastAssignedMap.set(agent.id, now);
          assigned++;
          break;
        }
      }
    }

    return { assigned, agents };
  }
}
