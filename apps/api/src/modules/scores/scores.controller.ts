import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ScoresService } from './scores.service';

@ApiTags('scores')
@Controller('properties/:id')
export class ScoresController {
  constructor(private readonly scores: ScoresService) {}

  @Post('recalculate-scores')
  recompute(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.scores.recomputeReadiness(user.companyId, id);
  }

  @Get('scores')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.scores.getProperty(user.companyId, id);
  }
}
