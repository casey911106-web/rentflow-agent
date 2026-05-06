import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AIAgentModule } from '../ai-agent/ai-agent.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { LeadFollowupScheduler } from './lead-followup.scheduler';
import { OwnerAvailabilityScheduler } from './owner-availability.scheduler';
import { OwnerReplyParser } from './owner-reply.parser';
import { SuggestionExpiryScheduler } from './suggestion-expiry.scheduler';
import { AutomationController } from './automation.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    forwardRef(() => AIAgentModule),
    forwardRef(() => WhatsAppModule),
  ],
  controllers: [AutomationController],
  providers: [LeadFollowupScheduler, OwnerAvailabilityScheduler, OwnerReplyParser, SuggestionExpiryScheduler],
  exports: [LeadFollowupScheduler, OwnerAvailabilityScheduler, OwnerReplyParser, SuggestionExpiryScheduler],
})
export class AutomationModule {}
