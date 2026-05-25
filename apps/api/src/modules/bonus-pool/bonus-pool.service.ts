import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlacementsService } from '../placements/placements.service';

/** Date this commission split algorithm starts applying. Deals closed before
 *  this date keep whatever splits they were given manually (or none) — we
 *  don't retroactively rewrite history. */
export const COMMISSION_SPLIT_EFFECTIVE_FROM = new Date(Date.UTC(2026, 5, 1)); // June 1, 2026

/** Weights on the three monthly performance metrics. Must sum to 1.0.
 *  Leads matter most (real conversions), clicks proxy content quality,
 *  completion guards against agents who hoard tasks but don't post. */
export const PERFORMANCE_WEIGHTS = {
  leads: 0.60,
  clicks: 0.25,
  completion: 0.15,
} as const;

/** Bucket percentages — must sum to FIELD_AGENT_BUCKET (50). The rest (50)
 *  stays with the platform. */
export const SPLIT_PERCENTS = {
  closer: 30,
  performance: 10,
  sourcing: 10,
} as const;

export interface SplitInput {
  recipientUserId: string | null;
  label: string;
  percent: number;
  notes?: string | null;
}

export interface PerformanceRow {
  userId: string;
  fullName: string | null;
  leads: number;
  clicks: number;
  completionRate: number;
  score: number;
}

export interface SourcingRow {
  userId: string;
  fullName: string | null;
  sourcedCount: number;
}

@Injectable()
export class BonusPoolService {
  private readonly logger = new Logger(BonusPoolService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly placements: PlacementsService,
  ) {}

  // -------------------------------------------------------------------------
  // Public leaderboards (used by /analytics monthly bonus pool section)
  // -------------------------------------------------------------------------

  /** Performance leaderboard for a calendar month, sorted by composite score
   *  (60% leads + 25% clicks + 15% completion%). Each raw metric is
   *  normalised to 0..1 against that month's max so the score is comparable
   *  month-over-month regardless of absolute volume. */
  async monthlyPerformance(
    companyId: string,
    year: number,
    month: number,
  ): Promise<PerformanceRow[]> {
    const rows = await this.placements.monthlyLeaderboard(companyId, year, month);
    const maxLeads = Math.max(0, ...rows.map((r) => r.attributedLeads));
    const maxClicks = Math.max(0, ...rows.map((r) => r.totalClicks));
    const norm = (v: number, max: number) => (max > 0 ? v / max : 0);

    return rows
      .map((r) => {
        const score =
          PERFORMANCE_WEIGHTS.leads * norm(r.attributedLeads, maxLeads) +
          PERFORMANCE_WEIGHTS.clicks * norm(r.totalClicks, maxClicks) +
          PERFORMANCE_WEIGHTS.completion * r.completionRate;
        return {
          userId: r.user?.id ?? '',
          fullName: r.user?.fullName ?? null,
          leads: r.attributedLeads,
          clicks: r.totalClicks,
          completionRate: r.completionRate,
          score,
        };
      })
      .filter((r) => r.userId)
      .sort((a, b) => b.score - a.score);
  }

  /** Sourcing leaderboard for a calendar month — counts properties created
   *  in the month whose sourcedByFieldAgentId is set. Used to award the
   *  10% sourcing bucket. */
  async monthlySourcing(
    companyId: string,
    year: number,
    month: number,
  ): Promise<SourcingRow[]> {
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));
    const grouped = await this.prisma.property.groupBy({
      by: ['sourcedByFieldAgentId'],
      where: {
        companyId,
        deletedAt: null,
        createdAt: { gte: monthStart, lt: monthEnd },
        sourcedByFieldAgentId: { not: null },
      },
      _count: { _all: true },
    });
    if (grouped.length === 0) return [];
    const userIds = grouped.map((g) => g.sourcedByFieldAgentId!).filter(Boolean);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    return grouped
      .map((g) => ({
        userId: g.sourcedByFieldAgentId!,
        fullName: userMap.get(g.sourcedByFieldAgentId!)?.fullName ?? null,
        sourcedCount: g._count._all,
      }))
      .sort((a, b) => b.sourcedCount - a.sourcedCount);
  }

  // -------------------------------------------------------------------------
  // Commission split policy
  // -------------------------------------------------------------------------

  /** Compute the default CommissionSplit rows for a deal that just closed.
   *  Algorithm (from June 2026):
   *    30% → Property.assignedFieldAgentId at close (the closer)
   *    10% → top performer of the close month (composite 60/25/15 score)
   *    10% → Property.sourcedByFieldAgentId, OR equal split across all active
   *           field agents when the property has no sourcer set
   *    50% → Platform (label "Platform")
   *  Returns an empty array if the deal closed before the effective date —
   *  caller should leave existing manual splits untouched in that case. */
  async buildDealSplits(dealId: string): Promise<SplitInput[]> {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      select: {
        id: true,
        companyId: true,
        closedAt: true,
        property: {
          select: {
            assignedFieldAgentId: true,
            sourcedByFieldAgentId: true,
          },
        },
      },
    });
    if (!deal || !deal.closedAt) return [];
    if (deal.closedAt < COMMISSION_SPLIT_EFFECTIVE_FROM) return [];

    const year = deal.closedAt.getUTCFullYear();
    const month = deal.closedAt.getUTCMonth() + 1;

    const splits: SplitInput[] = [];

    // --- 30% closer -------------------------------------------------------
    const closerId = deal.property.assignedFieldAgentId ?? null;
    if (closerId) {
      splits.push({
        recipientUserId: closerId,
        label: `Closer (assigned field agent at close)`,
        percent: SPLIT_PERCENTS.closer,
      });
    } else {
      // No closer = closer bucket stays with the platform, surfaced as a
      // distinct row so ops can see the gap (and assign one retroactively
      // if they want to override).
      splits.push({
        recipientUserId: null,
        label: 'Closer bucket (unassigned)',
        percent: SPLIT_PERCENTS.closer,
      });
    }

    // --- 10% top performer ------------------------------------------------
    const performance = await this.monthlyPerformance(deal.companyId, year, month);
    const topPerformer = performance[0];
    if (topPerformer && topPerformer.score > 0) {
      splits.push({
        recipientUserId: topPerformer.userId,
        label: `Top performer ${year}-${String(month).padStart(2, '0')} (score ${topPerformer.score.toFixed(3)})`,
        percent: SPLIT_PERCENTS.performance,
      });
    } else {
      splits.push({
        recipientUserId: null,
        label: 'Top performer bucket (no qualifying activity)',
        percent: SPLIT_PERCENTS.performance,
      });
    }

    // --- 10% sourcing -----------------------------------------------------
    const sourcerId = deal.property.sourcedByFieldAgentId ?? null;
    if (sourcerId) {
      splits.push({
        recipientUserId: sourcerId,
        label: 'Property sourcer',
        percent: SPLIT_PERCENTS.sourcing,
      });
    } else {
      // Bucket redistributes equally across all active field agents.
      const fieldAgents = await this.prisma.user.findMany({
        where: {
          companyId: deal.companyId,
          deletedAt: null,
          status: 'active',
          roles: { has: 'field_agent' as never },
        },
        select: { id: true },
      });
      if (fieldAgents.length === 0) {
        splits.push({
          recipientUserId: null,
          label: 'Sourcing bucket (no field agents)',
          percent: SPLIT_PERCENTS.sourcing,
        });
      } else {
        // Each gets sourcing% / N. Two decimal places — round so the total
        // still hits 10 exactly (last agent absorbs the rounding remainder).
        const each = round2(SPLIT_PERCENTS.sourcing / fieldAgents.length);
        let allocated = 0;
        fieldAgents.forEach((agent, i) => {
          const isLast = i === fieldAgents.length - 1;
          const pct = isLast ? round2(SPLIT_PERCENTS.sourcing - allocated) : each;
          allocated = round2(allocated + each);
          splits.push({
            recipientUserId: agent.id,
            label: 'Sourcing bucket — even split (no sourcer assigned)',
            percent: pct,
          });
        });
      }
    }

    // --- 50% platform ------------------------------------------------------
    const fieldAgentTotal = splits.reduce((s, r) => s + Number(r.percent), 0);
    const platformPct = round2(100 - fieldAgentTotal);
    splits.push({
      recipientUserId: null,
      label: 'Platform',
      percent: platformPct,
    });

    return splits;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
