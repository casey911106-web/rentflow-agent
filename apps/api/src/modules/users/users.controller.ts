import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UsersService } from './users.service';

class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(2) fullName!: string;
  @IsString() @MinLength(8) password!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) roles!: string[];
  @IsOptional() @IsString() phoneE164?: string;
  @IsOptional() @IsBoolean() createFieldAgent?: boolean;
}

class UpdateRolesDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) roles!: string[];
}

class UpdateStatusDto {
  @IsString() @IsIn(['active', 'suspended']) status!: 'active' | 'suspended';
}

class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @IsOptional() @IsString() phoneE164?: string;
  @IsOptional() @IsBoolean() isPartner?: boolean;
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.users.list(user.companyId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto) {
    return this.users.create(user.companyId, dto);
  }

  @Patch(':id/roles')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  updateRoles(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateRolesDto,
  ) {
    return this.users.updateRoles(user.companyId, id, dto.roles);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.users.updateStatus(user.companyId, user.sub, id, dto.status);
  }

  /** Edit fullName / phoneE164 / isPartner. Only super_admin. */
  @Patch(':id/profile')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.users.updateProfile(user.companyId, id, dto);
  }
}
