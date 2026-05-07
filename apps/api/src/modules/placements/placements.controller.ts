import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PlacementsService } from './placements.service';

interface CreateBody {
  channelName: string;
  channelKind?: string;
  externalUrl?: string;
  groupSize?: number;
  notes?: string;
}

@ApiTags('placements')
@Controller()
export class PlacementsController {
  constructor(private readonly placements: PlacementsService) {}

  /** Mobile + dashboard: list pending publishing tasks for me. */
  @Get('me/assigned-postings')
  myAssignments(@CurrentUser() user: JwtPayload) {
    return this.placements.listMyAssignments(user.sub, user.companyId);
  }

  /** Log a new external publication of a Fast Posting. */
  @Post('post-packages/:id/placements')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'ops_manager', 'field_agent')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: CreateBody,
  ) {
    return this.placements.create(user.companyId, user.sub, id, body);
  }

  /** List all placements of a Fast Posting (admin / ops view). */
  @Get('post-packages/:id/placements')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'ops_manager')
  listForPackage(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.placements.listForPackage(user.companyId, id);
  }

  /** Mark a placement as removed (taken down). Publisher self or admin only. */
  @Delete('placements/:id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const isAdmin = user.roles.includes('super_admin') || user.roles.includes('ops_manager');
    return this.placements.remove(user.companyId, user.sub, isAdmin, id);
  }

  /** Publisher leaderboard. */
  @Get('admin/publishing/leaderboard')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'ops_manager')
  leaderboard(
    @CurrentUser() user: JwtPayload,
    @Query('sinceDays') sinceDays?: string,
  ) {
    const days = sinceDays ? Number(sinceDays) : 30;
    return this.placements.leaderboard(user.companyId, days);
  }
}
