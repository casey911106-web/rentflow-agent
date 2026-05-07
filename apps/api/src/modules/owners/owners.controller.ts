import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { OwnersService } from './owners.service';

@ApiTags('owners')
@Controller('owners')
@Roles('super_admin', 'ops_manager')
export class OwnersController {
  constructor(private readonly owners: OwnersService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.owners.list(user.companyId);
  }

  @Get(':id')
  findById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.owners.findById(user.companyId, id);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { fullName: string; phoneE164: string; email?: string; notes?: string },
  ) {
    return this.owners.create(user.companyId, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.owners.update(user.companyId, id, body);
  }

  @Post(':id/check-availability')
  checkAvailability(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.owners.triggerAvailabilityCheck(user.companyId, id);
  }
}
