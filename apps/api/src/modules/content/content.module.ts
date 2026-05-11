import { Module } from '@nestjs/common';
import { AIAgentModule } from '../ai-agent/ai-agent.module';
import { FilesModule } from '../files/files.module';
import { CarouselRendererService } from './carousel-renderer.service';
import { ContentService } from './content.service';
import { MetaGraphAdapter } from './meta-graph.adapter';
import { TelegramAdapter } from './telegram.adapter';

/**
 * Internal infrastructure for posting to owned channels — Telegram, Facebook
 * Pages, Instagram Business. User-facing endpoints live in PostingModule;
 * this module just provides the adapters + the publish/generate service.
 */
@Module({
  imports: [AIAgentModule, FilesModule],
  providers: [ContentService, TelegramAdapter, MetaGraphAdapter, CarouselRendererService],
  exports: [ContentService, TelegramAdapter, MetaGraphAdapter, CarouselRendererService],
})
export class ContentModule {}
