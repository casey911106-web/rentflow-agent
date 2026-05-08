import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CostsScheduler } from './costs.scheduler';
import { CostsService } from './costs.service';

@ApiTags('costs')
@Controller('admin/costs')
@UseGuards(RolesGuard)
@Roles('super_admin', 'ops_manager')
export class CostsController {
  constructor(
    private readonly costs: CostsService,
    private readonly scheduler: CostsScheduler,
  ) {}

  @Get('summary')
  summary(@CurrentUser() user: JwtPayload) {
    return this.costs.summary(user.companyId);
  }

  @Get('entries')
  list(
    @CurrentUser() user: JwtPayload,
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
  ) {
    return this.costs.list(user.companyId, { kind, limit: limit ? Number(limit) : undefined });
  }

  @Post('entries')
  createEntry(
    @CurrentUser() user: JwtPayload,
    @Body() body: { kind: string; label: string; amountAed: number; amountUsd?: number; incurredAt?: string; metadata?: Record<string, unknown> },
  ) {
    return this.costs.createManualEntry(user.companyId, body);
  }

  @Delete('entries/:id')
  removeEntry(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.costs.deleteEntry(user.companyId, id);
  }

  @Get('subscriptions')
  listSubs(@CurrentUser() user: JwtPayload) {
    return this.costs.listSubscriptions(user.companyId);
  }

  @Post('subscriptions')
  createSub(
    @CurrentUser() user: JwtPayload,
    @Body() body: { label: string; kind?: string; amountAed: number; cadence: 'monthly' | 'yearly'; startsAt: string; endsAt?: string; notes?: string },
  ) {
    return this.costs.createSubscription(user.companyId, body);
  }

  @Post('subscriptions/:id/toggle')
  toggleSub(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { active: boolean },
  ) {
    return this.costs.toggleSubscription(user.companyId, id, body.active);
  }

  @Post('rollup/run')
  @Roles('super_admin')
  runRollup(@Body() body: { day?: string }) {
    return this.scheduler.runManually(body?.day);
  }
}
