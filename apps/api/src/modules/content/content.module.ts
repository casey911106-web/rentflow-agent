import { Module } from '@nestjs/common';
import { AIAgentModule } from '../ai-agent/ai-agent.module';
import { ContentService } from './content.service';
import { TelegramAdapter } from './telegram.adapter';

/**
 * Internal infrastructure for posting to owned channels (Telegram now,
 * Instagram/Facebook later). User-facing endpoints live in `PostingModule` —
 * this module just provides the adapters + the publish/generate service.
 */
@Module({
  imports: [AIAgentModule],
  providers: [ContentService, TelegramAdapter],
  exports: [ContentService, TelegramAdapter],
})
export class ContentModule {}
