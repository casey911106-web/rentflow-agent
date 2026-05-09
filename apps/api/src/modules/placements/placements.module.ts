import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { PlacementsController } from './placements.controller';
import { PlacementsScheduler } from './placements.scheduler';
import { PlacementsService } from './placements.service';

@Module({
  imports: [ScheduleModule.forRoot(), WhatsAppModule, NotificationsModule],
  controllers: [PlacementsController],
  providers: [PlacementsService, PlacementsScheduler],
  exports: [PlacementsService, PlacementsScheduler],
})
export class PlacementsModule {}
