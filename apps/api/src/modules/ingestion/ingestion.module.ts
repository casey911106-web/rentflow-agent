import { Module, forwardRef } from '@nestjs/common';
import { AIAgentModule } from '../ai-agent/ai-agent.module';
import { FilesModule } from '../files/files.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { IngestionService } from './ingestion.service';
import { MediaDownloader } from './media-downloader';

/**
 * Partner-WhatsApp ingestion: external agents source properties via the
 * `/property` keyword. Wired into the WhatsApp inbound router so it
 * intercepts before the lead flow.
 */
@Module({
  imports: [forwardRef(() => WhatsAppModule), AIAgentModule, FilesModule],
  providers: [IngestionService, MediaDownloader],
  exports: [IngestionService],
})
export class IngestionModule {}
