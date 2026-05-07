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

  @Post(':id/mark-published')
  @Roles('super_admin', 'ops_manager', 'field_agent')
  markPublished(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { channelId?: string; channelName?: string; url?: string },
  ) {
    return this.posting.markPublished(user.companyId, id, user.sub, body);
  }
}
