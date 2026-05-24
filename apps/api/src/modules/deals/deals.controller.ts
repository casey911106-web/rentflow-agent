import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { DealsService } from './deals.service';

@ApiTags('deals')
@Controller('deals')
@Roles('super_admin', 'ops_manager')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.deals.list(user.companyId);
  }

  @Get(':id')
  detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.deals.findById(user.companyId, id);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      leadId: string;
      rentAmount?: number;
      depositAmount?: number;
      commissionAmount?: number;
      commissionPaidBy?: string;
      moveInDate?: string;
      rentalDurationMonths?: number;
    },
  ) {
    return this.deals.create(user.companyId, body);
  }

  @Post(':id/mark-won')
  markWon(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.deals.markWon(user.companyId, id);
  }

  @Post(':id/mark-lost')
  markLost(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: { reason: string }) {
    return this.deals.markLost(user.companyId, id, body.reason);
  }

  @Post(':id/commission')
  commission(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status?: string; expectedAmount?: number; invoicedAmount?: number; collectedAmount?: number; notes?: string },
  ) {
    return this.deals.upsertCommission(user.companyId, id, body);
  }

  @Post(':id/splits')
  splits(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { splits: Array<{ recipientUserId?: string | null; label: string; percent: number; notes?: string }> },
  ) {
    return this.deals.replaceSplits(user.companyId, id, body.splits);
  }
}
