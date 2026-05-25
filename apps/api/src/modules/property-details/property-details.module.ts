import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from '../notifications/notifications.module';
import { PropertyDetailsController } from './property-details.controller';
import { PropertyDetailsScheduler } from './property-details.scheduler';
import { PropertyDetailsService } from './property-details.service';

@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule],
  controllers: [PropertyDetailsController],
  providers: [PropertyDetailsService, PropertyDetailsScheduler],
  exports: [PropertyDetailsService],
})
export class PropertyDetailsModule {}
