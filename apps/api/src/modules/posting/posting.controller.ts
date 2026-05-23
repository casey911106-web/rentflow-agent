import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { PostingService } from './posting.service';

@ApiTags('posting')
@Controller('post-packages')
@Roles('super_admin', 'ops_manager')
export class PostingController {
  constructor(private readonly posting: PostingService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.posting.list(user.companyId);
  }

  @Get(':id')
  detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.posting.findById(user.companyId, id);
  }

  @Post('generate')
  generate(
    @CurrentUser() user: JwtPayload,
    @Body() body: { propertyId: string; campaignId?: string; channelId?: string },
  ) {
    return this.posting.generate(user.companyId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: Partial<{
      title: string;
      shortCaption: string;
      longCaption: string;
      whatsappCaption: string;
      facebookCaption: string;
      priceLine: string;
      availabilityLine: string;
      features: string[];
    }>,
  ) {
    return this.posting.update(user.companyId, id, body);
  }

  @Post(':id/approve')
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.posting.approve(user.companyId, id, user.sub);
  }

  @Post(':id/pause')
  pause(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.posting.pause(user.companyId, id);
  }

  @Post(':id/resume')
  resume(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.posting.resume(user.companyId, id);
  }

  @Post(':id/mark-published')
  @Roles('super_admin', 'ops_manager', 'field_agent')
  markPublished(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { channelId?: string; channelName?: string; url?: string },
  ) {
    return this.posting.markPublished(user.companyId, id, user.sub, body);
  }

  /** List automated owned-channels (Telegram, IG, FB pages) for the auto-publish picker. */
  @Get('automated-channels/list')
  automatedChannels(@CurrentUser() user: JwtPayload) {
    return this.posting.listAutomatedChannels(user.companyId);
  }

  /** Regenerate the WhatsApp / Facebook / classifieds captions on a package
   *  with a fresh AI pass. Pass `{ differentAngle: "more urgent" }` to nudge
   *  the model away from whatever hook it picked last time. */
  @Post(':id/regenerate-captions')
  regenerateCaptions(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { differentAngle?: string },
  ) {
    return this.posting.regenerateCaptions(user.companyId, id, body);
  }

  /** Generate an AI caption tailored to one automated channel. Returns text only — does not publish. */
  @Post(':id/draft-auto-caption')
  draftAutoCaption(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { channelId: string },
  ) {
    return this.posting.draftAutoCaption(user.companyId, id, body.channelId);
  }

  /** Publish the package to an automated channel right now (Telegram for now). */
  @Post(':id/auto-publish')
  autoPublish(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { channelId: string; caption: string },
  ) {
    return this.posting.autoPublish(user.companyId, id, user.sub, body);
  }

  /** Schedule an auto-publish for a future Dubai-local time. The frontend
   *  converts to UTC ISO before sending. A 1-min cron fires the actual
   *  publish at the right moment. */
  @Post(':id/schedule-auto-publish')
  schedulePost(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { channelId: string; caption: string; scheduledFor: string },
  ) {
    return this.posting.schedulePost(user.companyId, user.sub, id, body);
  }

  /** List scheduled posts for this package (pending, done, failed, cancelled). */
  @Get(':id/scheduled-posts')
  listScheduled(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.posting.listScheduledPosts(user.companyId, id);
  }

  /** Cancel a pending scheduled post. */
  @Post(':id/scheduled-posts/:scheduledId/cancel')
  cancelScheduled(
    @CurrentUser() user: JwtPayload,
    @Param('scheduledId') scheduledId: string,
  ) {
    return this.posting.cancelScheduledPost(user.companyId, scheduledId);
  }
}
