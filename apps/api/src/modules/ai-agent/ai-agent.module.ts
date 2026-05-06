import { Module, forwardRef } from '@nestjs/common';
import { AiProviderRef } from './ai-provider.ref';
import { SuggestionEngineService } from './suggestion-engine.service';
import { SuggestionsService } from './suggestions.service';
import { SuggestionsController } from './suggestions.controller';
import { OperatorNotifierService } from './operator-notifier.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [forwardRef(() => WhatsAppModule)],
  controllers: [SuggestionsController],
  providers: [AiProviderRef, SuggestionEngineService, SuggestionsService, OperatorNotifierService],
  exports: [AiProviderRef, SuggestionEngineService, SuggestionsService, OperatorNotifierService],
})
export class AIAgentModule {}
