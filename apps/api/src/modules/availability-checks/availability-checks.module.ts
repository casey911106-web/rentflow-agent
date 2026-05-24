import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from '../notifications/notifications.module';
import { AvailabilityChecksController } from './availability-checks.controller';
import { AvailabilityChecksScheduler } from './availability-checks.scheduler';
import { AvailabilityChecksService } from './availability-checks.service';

@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule],
  controllers: [AvailabilityChecksController],
  providers: [AvailabilityChecksService, AvailabilityChecksScheduler],
  exports: [AvailabilityChecksService],
})
export class AvailabilityChecksModule {}
