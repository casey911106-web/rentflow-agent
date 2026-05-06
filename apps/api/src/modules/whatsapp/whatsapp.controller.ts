import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { WhatsAppService } from './whatsapp.service';

@ApiTags('whatsapp')
@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly wa: WhatsAppService) {}

  @Get('conversations')
  list(@CurrentUser() user: JwtPayload) {
    return this.wa.listConversations(user.companyId);
  }

  @Get('conversations/:id')
  detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.wa.findConversation(user.companyId, id);
  }

  @Post('conversations/:id/send')
  send(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { text: string },
  ) {
    return this.wa.send(user.companyId, id, body.text);
  }

  @Post('conversations/:id/human-takeover')
  takeover(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.wa.setMode(user.companyId, id, 'human_takeover');
  }

  @Post('conversations/:id/release-to-ai')
  release(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.wa.setMode(user.companyId, id, 'ai');
  }
}
