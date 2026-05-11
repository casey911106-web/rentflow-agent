import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PostingService } from './posting.service';

interface CreateGrowthCampaignBody {
  title: string;
  caption: string;
  targetUrl: string;
  targetLabel: string;
  targetKind?: string;
}

interface DraftCaptionBody {
  targetKind: string;
  targetLabel: string;
  extraContext?: string;
  /** When regenerating, hint to vary the hook from the prior pick. */
  differentAngle?: string;
}

@ApiTags('admin/growth-campaigns')
@Controller('admin/growth-campaigns')
@UseGuards(RolesGuard)
@Roles('super_admin', 'ops_manager')
export class GrowthCampaignsController {
  constructor(private readonly posting: PostingService) {}

  /** Create a channel-growth PostPackage that field agents will post in
   *  their FB/WA groups to drive followers to our owned channels. */
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: CreateGrowthCampaignBody) {
    return this.posting.createGrowthCampaign(user.companyId, body);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.posting.listGrowthCampaigns(user.companyId);
  }

  /** AI-drafted caption — operator reviews + edits before saving. */
  @Post('draft-caption')
  draftCaption(@Body() body: DraftCaptionBody) {
    return this.posting.draftGrowthCaption(body);
  }

  /** Pull a campaign out of the round-robin pool. */
  @Post(':id/archive')
  archive(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.posting.archiveGrowthCampaign(user.companyId, id);
  }
}
