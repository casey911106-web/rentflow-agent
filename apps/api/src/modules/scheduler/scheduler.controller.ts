import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SchedulerService } from './scheduler.service';

@ApiTags('scheduler')
@Controller()
export class SchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}

  /** Operator/AI flow: ask the API for a token to send the lead. */
  @Post('viewings/scheduler/issue-booking-token')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'ops_manager')
  issueBooking(
    @CurrentUser() user: JwtPayload,
    @Body() body: { leadId: string; propertyCode: string },
  ) {
    return this.scheduler.issueBookingToken(user.companyId, body.leadId, body.propertyCode);
  }

  /** Operator/AI flow: token to let the lead reschedule an existing viewing. */
  @Post('viewings/:id/scheduler/issue-reschedule-token')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'ops_manager')
  issueReschedule(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.scheduler.issueRescheduleToken(user.companyId, id);
  }

  /** Public — what the scheduler page calls on load. */
  @Public()
  @Get('public/scheduler/:tokenId')
  view(@Param('tokenId') tokenId: string) {
    return this.scheduler.publicView(tokenId);
  }

  /** Public — lead picks a slot. Books or reschedules. */
  @Public()
  @Post('public/scheduler/:tokenId/book')
  book(
    @Param('tokenId') tokenId: string,
    @Body() body: { slotIso: string; leadName?: string },
  ) {
    if (!body?.slotIso) throw new NotFoundException();
    return this.scheduler.commit(tokenId, body.slotIso, body.leadName);
  }
}
