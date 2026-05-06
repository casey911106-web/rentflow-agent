import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { ViewingStatus } from '@rentflow/database';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ViewingsService } from './viewings.service';

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
    return this.viewings.list(user.companyId, { date, status, agentId, propertyId });
  }

  @Get(':id')
  detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.viewings.findById(user.companyId, id);
  }

  @Post()
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
    return this.viewings.updateStatus(user.companyId, id, body.status, body.notes);
  }

  @Post(':id/assign-agent')
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
    return this.viewings.addFeedback(user.companyId, id, body);
  }
}
