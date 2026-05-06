import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('funnel')
  async funnel(@CurrentUser() user: JwtPayload) {
    const [posts, leads, qualified, viewings, dealsWon, commissionRows] = await Promise.all([
      this.prisma.postPackage.count({ where: { companyId: user.companyId, status: { in: ['published', 'paused'] } } }),
      this.prisma.lead.count({ where: { companyId: user.companyId, deletedAt: null } }),
      this.prisma.lead.count({
        where: {
          companyId: user.companyId,
          deletedAt: null,
          status: { in: ['qualified', 'options_sent', 'viewing_requested', 'viewing_scheduled', 'viewing_completed', 'negotiating', 'won'] },
        },
      }),
      this.prisma.viewing.count({ where: { companyId: user.companyId, status: { in: ['confirmed', 'completed', 'converted'] } } }),
      this.prisma.deal.count({ where: { companyId: user.companyId, status: 'won', deletedAt: null } }),
      this.prisma.commission.aggregate({
        _sum: { collectedAmount: true, expectedAmount: true },
        where: { deal: { companyId: user.companyId } },
      }),
    ]);

    return {
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
