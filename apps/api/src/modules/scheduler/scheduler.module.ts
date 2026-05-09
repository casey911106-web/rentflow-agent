import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';
import { ViewingReminderScheduler } from './viewing-reminder.scheduler';

@Module({
  imports: [forwardRef(() => WhatsAppModule), NotificationsModule],
  controllers: [SchedulerController],
  providers: [SchedulerService, ViewingReminderScheduler],
  exports: [SchedulerService],
})
export class SchedulerModule {}
