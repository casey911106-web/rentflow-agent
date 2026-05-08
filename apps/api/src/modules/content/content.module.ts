import { Module } from '@nestjs/common';
import { AIAgentModule } from '../ai-agent/ai-agent.module';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { TelegramAdapter } from './telegram.adapter';

@Module({
  imports: [AIAgentModule],
  controllers: [ContentController],
  providers: [ContentService, TelegramAdapter],
  exports: [ContentService, TelegramAdapter],
})
export class ContentModule {}
