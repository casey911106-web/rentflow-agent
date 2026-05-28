import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/** Resolve the [startInclusive, endExclusive) UTC bounds for a calendar
 *  month. `year` is the full year (e.g. 2026), `month` is 1..12. Falls back
 *  to the current UTC month when args are missing. */
function monthBounds(yearStr?: string, monthStr?: string): { start: Date; end: Date; year: number; month: number } {
  const now = new Date();
  const year = yearStr ? Number(yearStr) : now.getUTCFullYear();
  const month = monthStr ? Number(monthStr) : now.getUTCMonth() + 1;
  return {
    year,
    month,
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

type SummaryPeriod = 'day' | 'week' | 'month';
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000; // UTC+4, no DST

/** Period-to-date windows in Dubai local time. Returns the current window
 *  [curStart, now] and an equal-length previous window [prevStart, prevEnd]
 *  so the comparison is apples-to-apples (e.g. May 1–28 vs Apr 1–28, not vs
 *  all of April). Both windows end at the same elapsed offset; previous is
 *  shifted back exactly one period. */
function summaryBounds(period: SummaryPeriod): {
  curStart: Date;
  curEnd: Date;
  prevStart: Date;
  prevEnd: Date;
} {
  const now = new Date();
  const nowDubai = new Date(now.getTime() + DUBAI_OFFSET_MS);

  let curStartDubai: Date;
  let prevStartDubai: Date;

  if (period === 'day') {
    curStartDubai = new Date(nowDubai);
    curStartDubai.setUTCHours(0, 0, 0, 0);
    prevStartDubai = new Date(curStartDubai.getTime() - 24 * 60 * 60 * 1000);
  } else if (period === 'week') {
    // Week starts Monday (Dubai local).
    curStartDubai = new Date(nowDubai);
    curStartDubai.setUTCHours(0, 0, 0, 0);
    const dow = (curStartDubai.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    curStartDubai = new Date(curStartDubai.getTime() - dow * 24 * 60 * 60 * 1000);
    prevStartDubai = new Date(curStartDubai.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    // month — calendar month in Dubai local time.
    curStartDubai = new Date(Date.UTC(nowDubai.getUTCFullYear(), nowDubai.getUTCMonth(), 1, 0, 0, 0));
    prevStartDubai = new Date(Date.UTC(nowDubai.getUTCFullYear(), nowDubai.getUTCMonth() - 1, 1, 0, 0, 0));
  }

  const curStart = new Date(curStartDubai.getTime() - DUBAI_OFFSET_MS);
  const elapsed = now.getTime() - curStart.getTime();
  const prevStart = new Date(prevStartDubai.getTime() - DUBAI_OFFSET_MS);
  const prevEnd = new Date(prevStart.getTime() + elapsed);

  return { curStart, curEnd: now, prevStart, prevEnd };
}

/** current/previous counts + signed % change. deltaPct is null when there's
 *  no baseline (previous = 0) so the UI renders "—" instead of a misleading
 *  +100% / ∞. */
function metric(current: number, previous: number): { current: number; previous: number; deltaPct: number | null } {
  const deltaPct = previous === 0 ? null : ((current - previous) / previous) * 100;
  return { current, previous, deltaPct };
}

@ApiTags('analytics')
@Controller('analytics')
@Roles('super_admin', 'ops_manager')
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Funnel snapshot for a calendar month. Membership rule per stage:
   *    posts → PostPackage createdAt in month
   *    leads → Lead createdAt in month
   *    qualified → Lead createdAt in month AND status reached qualified+
   *    viewingsCompleted → Viewing scheduledAt in month AND status completed
   *    dealsWon → Deal closedAt in month AND status=won
   *    commissionExpected/Collected → sum across deals whose closedAt is in
   *      the month (so a single deal contributes to exactly one month). */
  @Get('funnel')
  async funnel(
    @CurrentUser() user: JwtPayload,
    @Query('year') yearStr?: string,
    @Query('month') monthStr?: string,
  ) {
    const { start, end, year, month } = monthBounds(yearStr, monthStr);

    const [posts, leads, qualified, viewings, dealsWon, commissionRows] = await Promise.all([
      this.prisma.postPackage.count({
        where: {
          companyId: user.companyId,
          createdAt: { gte: start, lt: end },
          status: { in: ['published', 'paused'] },
        },
      }),
      this.prisma.lead.count({
        where: {
          companyId: user.companyId,
          deletedAt: null,
          createdAt: { gte: start, lt: end },
        },
      }),
      this.prisma.lead.count({
        where: {
          companyId: user.companyId,
          deletedAt: null,
          createdAt: { gte: start, lt: end },
          status: { in: ['qualified', 'options_sent', 'viewing_requested', 'viewing_scheduled', 'viewing_completed', 'negotiating', 'won'] },
        },
      }),
      this.prisma.viewing.count({
        where: {
          companyId: user.companyId,
          scheduledAt: { gte: start, lt: end },
          status: { in: ['confirmed', 'completed', 'converted'] },
        },
      }),
      this.prisma.deal.count({
        where: {
          companyId: user.companyId,
          deletedAt: null,
          status: 'won',
          closedAt: { gte: start, lt: end },
        },
      }),
      this.prisma.commission.aggregate({
        _sum: { collectedAmount: true, expectedAmount: true },
        where: {
          deal: {
            companyId: user.companyId,
            closedAt: { gte: start, lt: end },
          },
        },
      }),
    ]);

    return {
      year,
      month,
      posts,
      leads,
      qualified,
      viewingsCompleted: viewings,
      dealsWon,
      commissionExpected: commissionRows._sum.expectedAmount ?? 0,
      commissionCollected: commissionRows._sum.collectedAmount ?? 0,
    };
  }

  /** Period-to-date summary with prior-period comparison. Default period is
   *  'day'. Each metric returns { current, previous, deltaPct }. Drives the
   *  top dashboard cards with the up/down comparison arrows. */
  @Get('summary')
  async summary(
    @CurrentUser() user: JwtPayload,
    @Query('period') periodParam?: string,
  ) {
    const period: SummaryPeriod =
      periodParam === 'week' || periodParam === 'month' ? periodParam : 'day';
    const { curStart, curEnd, prevStart, prevEnd } = summaryBounds(period);
    const companyId = user.companyId;

    const countLeads = (gte: Date, lt: Date) =>
      this.prisma.lead.count({ where: { companyId, deletedAt: null, createdAt: { gte, lt } } });
    const countPosts = (gte: Date, lt: Date) =>
      this.prisma.postPlacement.count({ where: { companyId, removedAt: null, publishedAt: { gte, lt } } });
    const countTasksAssigned = (gte: Date, lt: Date) =>
      this.prisma.postAssignment.count({ where: { companyId, assignedAt: { gte, lt } } });
    const countTasksCompleted = (gte: Date, lt: Date) =>
      this.prisma.postAssignment.count({ where: { companyId, status: 'fulfilled', fulfilledAt: { gte, lt } } });
    const countViewings = (gte: Date, lt: Date) =>
      this.prisma.viewing.count({
        where: { companyId, scheduledAt: { gte, lt }, status: { in: ['completed', 'converted'] } },
      });
    const countDealsWon = (gte: Date, lt: Date) =>
      this.prisma.deal.count({ where: { companyId, deletedAt: null, status: 'won', closedAt: { gte, lt } } });

    const [
      leadsCur, leadsPrev,
      postsCur, postsPrev,
      assignedCur, assignedPrev,
      completedCur, completedPrev,
      viewingsCur, viewingsPrev,
      dealsCur, dealsPrev,
    ] = await Promise.all([
      countLeads(curStart, curEnd), countLeads(prevStart, prevEnd),
      countPosts(curStart, curEnd), countPosts(prevStart, prevEnd),
      countTasksAssigned(curStart, curEnd), countTasksAssigned(prevStart, prevEnd),
      countTasksCompleted(curStart, curEnd), countTasksCompleted(prevStart, prevEnd),
      countViewings(curStart, curEnd), countViewings(prevStart, prevEnd),
      countDealsWon(curStart, curEnd), countDealsWon(prevStart, prevEnd),
    ]);

    return {
      period,
      range: { from: curStart.toISOString(), to: curEnd.toISOString() },
      previousRange: { from: prevStart.toISOString(), to: prevEnd.toISOString() },
      metrics: {
        leads: metric(leadsCur, leadsPrev),
        postsPublished: metric(postsCur, postsPrev),
        tasksAssigned: metric(assignedCur, assignedPrev),
        tasksCompleted: metric(completedCur, completedPrev),
        viewingsCompleted: metric(viewingsCur, viewingsPrev),
        dealsWon: metric(dealsCur, dealsPrev),
      },
    };
  }

  /** Per-publisher breakdown for the same period as `summary`. Returns each
   *  publisher's placements + tasks assigned/completed in the current window
   *  (no comparison — the summary cards carry the trend). */
  @Get('publishers')
  async publishers(
    @CurrentUser() user: JwtPayload,
    @Query('period') periodParam?: string,
  ) {
    const period: SummaryPeriod =
      periodParam === 'week' || periodParam === 'month' ? periodParam : 'day';
    const { curStart, curEnd } = summaryBounds(period);
    const companyId = user.companyId;

    const [placements, assignments] = await Promise.all([
      this.prisma.postPlacement.findMany({
        where: { companyId, removedAt: null, publishedAt: { gte: curStart, lt: curEnd } },
        select: { publisherUserId: true, clicks: true, _count: { select: { attributedLeads: true } } },
      }),
      this.prisma.postAssignment.findMany({
        where: { companyId, assignedAt: { gte: curStart, lt: curEnd } },
        select: { assigneeUserId: true, status: true },
      }),
    ]);

    interface Bucket {
      placements: number;
      clicks: number;
      attributedLeads: number;
      assignedTotal: number;
      assignedFulfilled: number;
    }
    const acc = new Map<string, Bucket>();
    const blank = (): Bucket => ({ placements: 0, clicks: 0, attributedLeads: 0, assignedTotal: 0, assignedFulfilled: 0 });
    for (const p of placements) {
      const b = acc.get(p.publisherUserId) ?? blank();
      b.placements += 1;
      b.clicks += p.clicks;
      b.attributedLeads += p._count.attributedLeads;
      acc.set(p.publisherUserId, b);
    }
    for (const a of assignments) {
      const b = acc.get(a.assigneeUserId) ?? blank();
      b.assignedTotal += 1;
      if (a.status === 'fulfilled') b.assignedFulfilled += 1;
      acc.set(a.assigneeUserId, b);
    }
    if (acc.size === 0) return { period, publishers: [] };

    const ids = Array.from(acc.keys());
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const publishers = ids
      .map((id) => {
        const b = acc.get(id)!;
        return {
          user: userMap.get(id) ?? null,
          placements: b.placements,
          clicks: b.clicks,
          attributedLeads: b.attributedLeads,
          assignedTotal: b.assignedTotal,
          assignedFulfilled: b.assignedFulfilled,
          completionRate: b.assignedTotal > 0 ? b.assignedFulfilled / b.assignedTotal : 0,
        };
      })
      .sort((a, b) => b.placements - a.placements);

    return { period, publishers };
  }

  @Get('posts')
  postPerformance(@CurrentUser() user: JwtPayload) {
    return this.prisma.postPackage.findMany({
      where: { companyId: user.companyId },
      include: {
        property: { select: { code: true, name: true } },
        channel: true,
        trackingLink: true,
        _count: { select: { leads: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Get('agents')
  agents(@CurrentUser() user: JwtPayload) {
    return this.prisma.fieldAgent.findMany({
      where: { companyId: user.companyId, active: true },
      include: {
        user: { select: { fullName: true } },
        _count: { select: { viewings: true, deals: true } },
      },
      orderBy: { performanceScore: 'desc' },
    });
  }

  @Get('commissions')
  async commissions(@CurrentUser() user: JwtPayload) {
    const deals = await this.prisma.deal.findMany({
      where: { companyId: user.companyId, deletedAt: null },
      include: {
        commission: true,
        property: { select: { code: true, name: true } },
        fieldAgent: { include: { user: { select: { fullName: true } } } },
      },
    });
    return deals;
  }
}
