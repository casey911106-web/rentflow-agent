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
