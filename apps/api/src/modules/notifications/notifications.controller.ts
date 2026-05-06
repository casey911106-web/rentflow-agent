import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Query('unreadOnly') unreadOnly?: string) {
    return this.prisma.notification.findMany({
      where: {
        companyId: user.companyId,
        userId: user.sub,
        ...(unreadOnly === 'true' ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: JwtPayload) {
    const count = await this.prisma.notification.count({
      where: { companyId: user.companyId, userId: user.sub, readAt: null },
    });
    return { count };
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.prisma.notification.updateMany({
      where: { id, companyId: user.companyId, userId: user.sub },
      data: { readAt: new Date() },
    });
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.prisma.notification.updateMany({
      where: { companyId: user.companyId, userId: user.sub, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
