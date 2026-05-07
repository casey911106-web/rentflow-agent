import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';
import { ViewingReminderScheduler } from './viewing-reminder.scheduler';

@Module({
  imports: [WhatsAppModule],
  controllers: [SchedulerController],
  providers: [SchedulerService, ViewingReminderScheduler],
  exports: [SchedulerService],
})
export class SchedulerModule {}
