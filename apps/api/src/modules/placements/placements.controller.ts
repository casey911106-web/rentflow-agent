import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PlacementsScheduler } from './placements.scheduler';
import { PlacementsService } from './placements.service';

interface CreateBody {
  channelName: string;
  channelKind?: string;
  externalUrl?: string;
  groupSize?: number;
  notes?: string;
}

interface ConfirmBody {
  channelName: string;
  channelKind?: string;
  externalUrl?: string;
  groupSize?: number;
  notes?: string;
}

@ApiTags('placements')
@Controller()
export class PlacementsController {
  constructor(
    private readonly placements: PlacementsService,
    private readonly scheduler: PlacementsScheduler,
  ) {}

  /** Trigger the round-robin assignment cycle now (super_admin only). */
  @Post('admin/publishing/round-robin/run')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  triggerRoundRobin() {
    return this.scheduler.runManually();
  }

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

  /** Pre-generate a unique tracking slug for a Fast Posting *before* the
   *  agent posts in a Facebook group. Returns the trackingUrl so they can
   *  copy it to clipboard, paste it in their post, and confirm later. */
  @Post('post-packages/:id/placements/draft')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'ops_manager', 'field_agent')
  draft(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.placements.createDraft(user.companyId, user.sub, id);
  }

  /** Confirm a draft placement: agent fills in channel name and any
   *  optional details. From this moment on the placement counts toward
   *  the 3-placement minimum and triggers the package's published bump. */
  @Post('placements/:id/confirm')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'ops_manager', 'field_agent')
  confirm(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: ConfirmBody,
  ) {
    return this.placements.confirmDraft(user.companyId, user.sub, id, body);
  }

  /** List all placements of a Fast Posting (admin / ops view). */
  @Get('post-packages/:id/placements')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'ops_manager')
  listForPackage(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.placements.listForPackage(user.companyId, id);
  }

  /** Caller's placements on a specific Fast Posting — used by mobile to gate
   *  the 'Mark complete' button until 3+ placements logged. */
  @Get('post-packages/:id/placements/mine')
  myForPackage(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.placements.listMyForPackage(user.companyId, user.sub, id);
  }

  /** Mark an assignment as fulfilled. Requires 3+ placements by this user. */
  @Post('post-assignments/:id/complete')
  completeAssignment(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.placements.completeAssignment(user.companyId, user.sub, id);
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
