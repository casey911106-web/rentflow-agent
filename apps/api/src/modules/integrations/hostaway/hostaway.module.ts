import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HostawayAvailabilityScheduler } from './hostaway-availability.scheduler';
import { HostawayController } from './hostaway.controller';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [HostawayController],
  providers: [HostawayAvailabilityScheduler],
  exports: [HostawayAvailabilityScheduler],
})
export class HostawayModule {}
