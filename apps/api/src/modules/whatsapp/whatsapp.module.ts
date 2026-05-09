import { Module, forwardRef } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WebhookController } from './webhook.controller';
import { WhatsAppService } from './whatsapp.service';
import { InboundRouter } from './inbound.router';
import { WhatsAppAdapterProvider } from './adapter.provider';
import { LeadWorkflowRunner } from './lead-workflow.runner';
import { InboundDebouncer } from './inbound-debouncer.service';
import { OperatorInboundHandler } from './operator-inbound.handler';
import { AIAgentModule } from '../ai-agent/ai-agent.module';
import { AutomationModule } from '../automation/automation.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [forwardRef(() => AIAgentModule), forwardRef(() => AutomationModule), forwardRef(() => IngestionModule), NotificationsModule],
  controllers: [WhatsAppController, WebhookController],
  providers: [
    WhatsAppService,
    InboundRouter,
    WhatsAppAdapterProvider,
    LeadWorkflowRunner,
    InboundDebouncer,
    OperatorInboundHandler,
  ],
  exports: [WhatsAppService, WhatsAppAdapterProvider, LeadWorkflowRunner],
})
export class WhatsAppModule {}
