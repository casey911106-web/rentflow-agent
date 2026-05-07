import { Controller, Get, Param } from '@nestjs/common';
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

  /** Mobile: today's viewings for the current user (if they're a field agent). */
  @Get('me/today')
  async myToday(@CurrentUser() user: JwtPayload) {
    const fa = await this.prisma.fieldAgent.findUnique({ where: { userId: user.sub } });
    if (!fa) return [];
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCHours(23, 59, 59, 999);
    return this.prisma.viewing.findMany({
      where: { fieldAgentId: fa.id, scheduledAt: { gte: start, lte: end } },
      include: { property: true, lead: true },
      orderBy: { scheduledAt: 'asc' },
    });
  }
}
