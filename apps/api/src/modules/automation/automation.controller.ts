import { Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LeadFollowupScheduler } from './lead-followup.scheduler';
import { OwnerAvailabilityScheduler } from './owner-availability.scheduler';

@ApiTags('automation')
@Controller('automation')
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
