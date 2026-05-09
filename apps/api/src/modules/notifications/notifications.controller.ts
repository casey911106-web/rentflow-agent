import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Put, Query } from '@nestjs/common';
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

  /**
   * Register / refresh the caller's Expo push token. Called by the mobile
   * app on login + on every cold start. Idempotent — same token is
   * deduped, multiple devices coexist.
   */
  @Put('push-token')
  async registerPushToken(
    @CurrentUser() user: JwtPayload,
    @Body() body: { token?: string; platform?: 'ios' | 'android' },
  ) {
    const token = (body.token ?? '').trim();
    if (!token.startsWith('ExponentPushToken[') || !token.endsWith(']')) {
      throw new BadRequestException('Invalid Expo push token shape');
    }
    const u = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { expoPushTokens: true },
    });
    if (!u) throw new BadRequestException('User not found');
    if (u.expoPushTokens.includes(token)) return { ok: true, deduped: true };
    const next = [...u.expoPushTokens, token].slice(-5); // cap at last 5 devices per user
    await this.prisma.user.update({
      where: { id: user.sub },
      data: { expoPushTokens: next },
    });
    return { ok: true, deduped: false };
  }

  /** Remove the caller's push token (logout / opt-out). */
  @Delete('push-token')
  async removePushToken(
    @CurrentUser() user: JwtPayload,
    @Body() body: { token?: string },
  ) {
    const token = (body.token ?? '').trim();
    if (!token) throw new BadRequestException('token is required');
    const u = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { expoPushTokens: true },
    });
    if (!u) return { ok: true };
    await this.prisma.user.update({
      where: { id: user.sub },
      data: { expoPushTokens: u.expoPushTokens.filter((t) => t !== token) },
    });
    return { ok: true };
  }
}
