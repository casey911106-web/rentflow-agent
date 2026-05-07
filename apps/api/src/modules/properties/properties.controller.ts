import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { PropertiesService, type CreatePropertyInput } from './properties.service';
import type { PropertyStatus } from '@rentflow/database';

const ADMIN_OPS = ['super_admin', 'ops_manager'] as const;

@ApiTags('properties')
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: PropertyStatus,
    @Query('q') q?: string,
  ) {
    return this.properties.list(user.companyId, { status, q });
  }

  @Get('issues')
  listIssues(
    @CurrentUser() user: JwtPayload,
    @Query('resolved') resolved?: string,
    @Query('type') type?: string,
  ) {
    const resolvedBool =
      resolved === 'true' ? true : resolved === 'false' ? false : undefined;
    return this.properties.listIssues(user.companyId, { resolved: resolvedBool, type });
  }

  @Post('issues/:issueId/resolve')
  @Roles(...ADMIN_OPS)
  resolveIssue(@CurrentUser() user: JwtPayload, @Param('issueId') issueId: string) {
    return this.properties.resolveIssue(user.companyId, issueId);
  }

  @Get(':id')
  findById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.properties.findById(user.companyId, id);
  }

  @Post()
  @Roles(...ADMIN_OPS)
  create(@CurrentUser() user: JwtPayload, @Body() body: CreatePropertyInput) {
    return this.properties.create(user.companyId, body);
  }

  @Patch(':id')
  @Roles(...ADMIN_OPS)
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.properties.update(user.companyId, id, body);
  }

  @Delete(':id')
  @Roles(...ADMIN_OPS)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.properties.softDelete(user.companyId, id);
  }

  @Get(':id/calendar')
  calendar(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.properties.getCalendar(user.companyId, id);
  }

  @Post(':id/availability-blocks')
  @Roles(...ADMIN_OPS)
  block(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { startsAt: string; endsAt: string; reason: string },
  ) {
    return this.properties.addAvailabilityBlock(user.companyId, id, body);
  }

  @Post(':id/report-issue')
  reportIssue(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { type: string; description: string },
  ) {
    return this.properties.reportIssue(user.companyId, id, { ...body, reportedById: user.sub });
  }

  @Post(':id/media')
  @Roles(...ADMIN_OPS)
  @UseInterceptors(FileInterceptor('file'))
  uploadMedia(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { kind?: string; caption?: string; position?: string },
  ) {
    if (!file) throw new BadRequestException('Missing "file" field in multipart body');
    return this.properties.uploadMedia(user.companyId, id, user.sub, file, body);
  }
}
