import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AIAgentModule } from '../ai-agent/ai-agent.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { LeadFollowupScheduler } from './lead-followup.scheduler';
import { OwnerAvailabilityScheduler } from './owner-availability.scheduler';
import { OwnerReplyParser } from './owner-reply.parser';
import { AutomationController } from './automation.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    forwardRef(() => AIAgentModule),
    forwardRef(() => WhatsAppModule),
  ],
  controllers: [AutomationController],
  providers: [LeadFollowupScheduler, OwnerAvailabilityScheduler, OwnerReplyParser],
  exports: [LeadFollowupScheduler, OwnerAvailabilityScheduler, OwnerReplyParser],
})
export class AutomationModule {}
