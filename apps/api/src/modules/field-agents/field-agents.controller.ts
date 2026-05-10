import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

const ADMIN_OPS = ['super_admin', 'ops_manager'] as const;

@ApiTags('field-agents')
@Controller('field-agents')
export class FieldAgentsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles(...ADMIN_OPS)
  list(@CurrentUser() user: JwtPayload) {
    return this.prisma.fieldAgent.findMany({
      where: { companyId: user.companyId, active: true },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        _count: { select: { viewings: true } },
      },
      orderBy: { performanceScore: 'desc' },
    });
  }

  @Get(':id')
  @Roles(...ADMIN_OPS)
  detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.prisma.fieldAgent.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        user: true,
        availability: { orderBy: { startsAt: 'asc' } },
        performanceHistory: { orderBy: { createdAt: 'desc' }, take: 30 },
        viewings: { orderBy: { scheduledAt: 'desc' }, take: 50, include: { property: true, lead: true } },
      },
    });
  }

  /** Mobile: viewings for the current field agent. Default range is today;
   *  pass `?range=week` to get from today through end-of-week (Sunday 23:59
   *  Dubai time) so agents can plan ahead. */
  @Get('me/today')
  async myToday(
    @CurrentUser() user: JwtPayload,
    @Query('range') range?: string,
  ) {
    const fa = await this.prisma.fieldAgent.findUnique({ where: { userId: user.sub } });
    if (!fa) return [];

    // Dubai is UTC+4 year-round (no DST). Compute boundaries in Dubai
    // local time then convert back to UTC for the Prisma query.
    const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
    const nowDubai = new Date(Date.now() + DUBAI_OFFSET_MS);
    const dubaiTodayStart = new Date(nowDubai);
    dubaiTodayStart.setUTCHours(0, 0, 0, 0);
    const startUTC = new Date(dubaiTodayStart.getTime() - DUBAI_OFFSET_MS);

    let endUTC: Date;
    if (range === 'week') {
      // End of current Dubai week = Sunday 23:59:59.999 Dubai time. Mon=1
      // ... Sun=0 by JS getUTCDay convention, so days-to-sunday is
      // (7 - dow) % 7 (0 if today is Sunday).
      const dow = dubaiTodayStart.getUTCDay();
      const daysToSunday = (7 - dow) % 7;
      const dubaiWeekEnd = new Date(dubaiTodayStart);
      dubaiWeekEnd.setUTCDate(dubaiWeekEnd.getUTCDate() + daysToSunday);
      dubaiWeekEnd.setUTCHours(23, 59, 59, 999);
      endUTC = new Date(dubaiWeekEnd.getTime() - DUBAI_OFFSET_MS);
    } else {
      const dubaiTodayEnd = new Date(dubaiTodayStart);
      dubaiTodayEnd.setUTCHours(23, 59, 59, 999);
      endUTC = new Date(dubaiTodayEnd.getTime() - DUBAI_OFFSET_MS);
    }

    return this.prisma.viewing.findMany({
      where: { fieldAgentId: fa.id, scheduledAt: { gte: startUTC, lte: endUTC } },
      include: { property: true, lead: true },
      orderBy: { scheduledAt: 'asc' },
    });
  }
}
