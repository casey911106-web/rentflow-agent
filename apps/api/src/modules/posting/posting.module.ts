import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { OwnerSweepsModule } from '../owner-sweeps/owner-sweeps.module';
import { PropertyDetailsModule } from '../property-details/property-details.module';
import { GrowthCampaignsController } from './growth-campaigns.controller';
import { PostingController } from './posting.controller';
import { PostingService } from './posting.service';
import { ScheduledChannelPostsScheduler } from './scheduled-channel-posts.scheduler';

@Module({
  imports: [ContentModule, PropertyDetailsModule, OwnerSweepsModule],
  controllers: [PostingController, GrowthCampaignsController],
  providers: [PostingService, ScheduledChannelPostsScheduler],
  exports: [PostingService],
})
export class PostingModule {}
