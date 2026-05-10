import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { GrowthCampaignsController } from './growth-campaigns.controller';
import { PostingController } from './posting.controller';
import { PostingService } from './posting.service';

@Module({
  imports: [ContentModule],
  controllers: [PostingController, GrowthCampaignsController],
  providers: [PostingService],
  exports: [PostingService],
})
export class PostingModule {}
