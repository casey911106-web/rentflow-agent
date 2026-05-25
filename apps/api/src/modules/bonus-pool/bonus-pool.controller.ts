import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { BonusPoolService } from './bonus-pool.service';

@ApiTags('bonus-pool')
@Controller('bonus-pool')
@Roles('super_admin', 'ops_manager')
export class BonusPoolController {
  constructor(private readonly bonus: BonusPoolService) {}

  /** Standings for a given month — used by the merged /analytics page to
   *  show "who is currently in line for each bucket" before the month ends. */
  @Get('standings')
  async standings(
    @CurrentUser() user: JwtPayload,
    @Query('year') yearStr?: string,
    @Query('month') monthStr?: string,
  ) {
    const now = new Date();
    const year = yearStr ? Number(yearStr) : now.getUTCFullYear();
    const month = monthStr ? Number(monthStr) : now.getUTCMonth() + 1;
    const [performance, sourcing] = await Promise.all([
      this.bonus.monthlyPerformance(user.companyId, year, month),
      this.bonus.monthlySourcing(user.companyId, year, month),
    ]);
    return {
      year,
      month,
      performance,
      sourcing,
      topPerformer: performance[0] ?? null,
      topSourcer: sourcing[0] ?? null,
    };
  }
}
