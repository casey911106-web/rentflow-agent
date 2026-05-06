import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { LeadsService } from './leads.service';
import type { LeadStatus, LeadTemperature } from '@rentflow/database';

@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: LeadStatus,
    @Query('temperature') temperature?: LeadTemperature,
    @Query('propertyId') propertyId?: string,
    @Query('postPackageId') postPackageId?: string,
  ) {
    return this.leads.list(user.companyId, { status, temperature, propertyId, postPackageId });
  }

  @Get(':id')
  detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.leads.findById(user.companyId, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.leads.update(user.companyId, id, body);
  }

  @Patch(':id/status')
  updateStatus(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: { status: LeadStatus }) {
    return this.leads.updateStatus(user.companyId, id, body.status);
  }
}
