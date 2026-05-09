import { Module } from '@nestjs/common';
import { AIAgentModule } from '../ai-agent/ai-agent.module';
import { ContentService } from './content.service';
import { MetaGraphAdapter } from './meta-graph.adapter';
import { TelegramAdapter } from './telegram.adapter';

/**
 * Internal infrastructure for posting to owned channels — Telegram, Facebook
 * Pages, Instagram Business. User-facing endpoints live in PostingModule;
 * this module just provides the adapters + the publish/generate service.
 */
@Module({
  imports: [AIAgentModule],
  providers: [ContentService, TelegramAdapter, MetaGraphAdapter],
  exports: [ContentService, TelegramAdapter, MetaGraphAdapter],
})
export class ContentModule {}
