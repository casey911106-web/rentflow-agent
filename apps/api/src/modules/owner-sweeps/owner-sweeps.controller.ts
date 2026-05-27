import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  OwnerSweepItemAvailability,
  OwnerSweepStatus,
} from '@rentflow/database';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { OwnerSweepsScheduler } from './owner-sweeps.scheduler';
import { OwnerSweepsService } from './owner-sweeps.service';

const ADMIN_OPS = ['super_admin', 'ops_manager'] as const;

@ApiTags('owner-sweeps')
@Controller('owner-sweeps')
export class OwnerSweepsController {
  constructor(
    private readonly sweeps: OwnerSweepsService,
    private readonly scheduler: OwnerSweepsScheduler,
  ) {}

  // Field agent
  @Get('my')
  my(@CurrentUser() user: JwtPayload) {
    return this.sweeps.listMySweeps(user.companyId, user.sub);
  }

  // Ops / admin — listed BEFORE :id route so /coverage isn't captured as an id
  @Get('coverage')
  @Roles(...ADMIN_OPS)
  coverage(@CurrentUser() user: JwtPayload) {
    return this.sweeps.coverage(user.companyId);
  }

  @Post('cron/run-once')
  @Roles(...ADMIN_OPS)
  runCron() {
    return this.scheduler.runManually();
  }

  @Get()
  @Roles(...ADMIN_OPS)
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: OwnerSweepStatus,
    @Query('assigneeUserId') assigneeUserId?: string,
    @Query('ownerId') ownerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.sweeps.listAdmin(user.companyId, {
      status,
      assigneeUserId,
      ownerId,
      from,
      to,
      cursor,
    });
  }

  @Get(':id')
  detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sweeps.detail(user.companyId, id);
  }

  @Post()
  @Roles(...ADMIN_OPS)
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { ownerId: string; assigneeUserId?: string },
  ) {
    return this.sweeps.manualCreate(
      user.companyId,
      body.ownerId,
      body.assigneeUserId ?? null,
    );
  }

  @Post(':id/reassign')
  @Roles(...ADMIN_OPS)
  reassign(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { assigneeUserId: string },
  ) {
    return this.sweeps.reassign(user.companyId, id, body.assigneeUserId);
  }

  @Post(':id/close')
  close(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.sweeps.close(id, user.sub);
  }

  @Post(':id/items/:itemId/share')
  share(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.sweeps.share(id, itemId, user.sub);
  }

  @Post(':id/items/:itemId/availability')
  availability(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body()
    body: {
      outcome: OwnerSweepItemAvailability;
      rentedUntil?: string;
      newPriceAed?: number;
      notes?: string;
    },
  ) {
    return this.sweeps.setAvailability(id, itemId, user.sub, body);
  }

  @Post(':id/items/:itemId/faq')
  faq(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { answers: Record<string, unknown> },
  ) {
    return this.sweeps.setFaq(id, itemId, user.sub, body.answers);
  }
}
