import { Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { LeadFollowupScheduler } from './lead-followup.scheduler';
import { OwnerAvailabilityScheduler } from './owner-availability.scheduler';

@ApiTags('automation')
@Controller('automation')
@Roles('super_admin')
export class AutomationController {
  constructor(
    private readonly leadFollowup: LeadFollowupScheduler,
    private readonly ownerAvailability: OwnerAvailabilityScheduler,
  ) {}

  @Post('run-followup-sweep')
  runFollowupSweep() {
    return this.leadFollowup.runManually();
  }

  @Post('run-owner-availability-sweep')
  runOwnerAvailabilitySweep() {
    return this.ownerAvailability.runManually();
  }
}
