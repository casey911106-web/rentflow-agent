import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { HostawayAvailabilityScheduler } from './hostaway-availability.scheduler';

@ApiTags('integrations')
@Controller('integrations/hostaway')
export class HostawayController {
  constructor(private readonly availability: HostawayAvailabilityScheduler) {}

  /** Force a Hostaway availability sweep now (super_admin only). */
  @Post('availability/sync')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  syncAvailability() {
    return this.availability.runManually();
  }
}
