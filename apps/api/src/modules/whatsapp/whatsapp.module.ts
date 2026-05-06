import { Module, forwardRef } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WebhookController } from './webhook.controller';
import { WhatsAppService } from './whatsapp.service';
import { InboundRouter } from './inbound.router';
import { WhatsAppAdapterProvider } from './adapter.provider';
import { LeadWorkflowRunner } from './lead-workflow.runner';
import { OperatorInboundHandler } from './operator-inbound.handler';
import { AIAgentModule } from '../ai-agent/ai-agent.module';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [forwardRef(() => AIAgentModule), forwardRef(() => AutomationModule)],
  controllers: [WhatsAppController, WebhookController],
  providers: [
    WhatsAppService,
    InboundRouter,
    WhatsAppAdapterProvider,
    LeadWorkflowRunner,
    OperatorInboundHandler,
  ],
  exports: [WhatsAppService, WhatsAppAdapterProvider, LeadWorkflowRunner],
})
export class WhatsAppModule {}
