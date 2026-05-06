import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { SuggestionsService } from './suggestions.service';

@ApiTags('suggestions')
@Controller('suggestions')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.suggestions.list(user.companyId, status);
  }

  @Get('count-pending')
  countPending(@CurrentUser() user: JwtPayload) {
    return this.suggestions.countPending(user.companyId).then((count) => ({ count }));
  }

  @Get('training-examples')
  trainingExamples(@CurrentUser() user: JwtPayload) {
    return this.suggestions.listTrainingExamples(user.companyId);
  }

  @Get(':id')
  detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.suggestions.findById(user.companyId, id);
  }

  @Post(':id/approve')
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.suggestions.approve(user.companyId, id, user.sub);
  }

  @Post(':id/edit')
  edit(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { editedReply: string },
  ) {
    return this.suggestions.edit(user.companyId, id, user.sub, body.editedReply);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.suggestions.cancel(user.companyId, id, user.sub);
  }

  @Patch('training-examples/:id')
  updateTrainingExample(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { enabled?: boolean; pinned?: boolean },
  ) {
    if (typeof body.enabled === 'boolean') {
      return this.suggestions.toggleTrainingExample(user.companyId, id, body.enabled);
    }
    if (typeof body.pinned === 'boolean') {
      return this.suggestions.pinTrainingExample(user.companyId, id, body.pinned);
    }
    return null;
  }
}
