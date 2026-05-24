import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { AvailabilityChecksService } from './availability-checks.service';

@ApiTags('availability-checks')
@Controller('availability-checks')
@Roles('super_admin', 'ops_manager', 'field_agent')
export class AvailabilityChecksController {
  constructor(private readonly checks: AvailabilityChecksService) {}

  @Get('my')
  listMy(@CurrentUser() user: JwtPayload) {
    return this.checks.listMyAssignments(user.companyId, user.sub);
  }

  @Post(':id/available')
  markAvailable(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.checks.markAvailable(user.companyId, user.sub, id);
  }

  @Post(':id/unavailable')
  markUnavailable(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { availableFromDate?: string; notes?: string },
  ) {
    return this.checks.markUnavailable(user.companyId, user.sub, id, body);
  }
}
