import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { ViewingStatus } from '@rentflow/database';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { ViewingsService } from './viewings.service';

const ADMIN_OPS = ['super_admin', 'ops_manager'] as const;

@ApiTags('viewings')
@Controller('viewings')
export class ViewingsController {
  constructor(private readonly viewings: ViewingsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('date') date?: string,
    @Query('status') status?: ViewingStatus,
    @Query('agentId') agentId?: string,
    @Query('propertyId') propertyId?: string,
  ) {
    return this.viewings.list(user, { date, status, agentId, propertyId });
  }

  @Get(':id')
  detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.viewings.findById(user, id);
  }

  @Post()
  @Roles(...ADMIN_OPS)
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { leadId: string; propertyId: string; scheduledAt: string; durationMinutes?: number; fieldAgentId?: string },
  ) {
    return this.viewings.create(user.companyId, body);
  }

  @Patch(':id/status')
  status(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status: ViewingStatus; notes?: string },
  ) {
    return this.viewings.updateStatus(user, id, body.status, body.notes);
  }

  @Post(':id/assign-agent')
  @Roles(...ADMIN_OPS)
  assign(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { fieldAgentId: string },
  ) {
    return this.viewings.assignAgent(user.companyId, id, body.fieldAgentId);
  }

  @Post(':id/feedback')
  feedback(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { rating?: number; comments?: string; bookingIntent?: string },
  ) {
    return this.viewings.addFeedback(user, id, body);
  }
}
