import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PropertyDetailQuestionType } from '@rentflow/database';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { PropertyDetailsService } from './property-details.service';

@ApiTags('property-details')
@Controller('property-details')
export class PropertyDetailsController {
  constructor(private readonly svc: PropertyDetailsService) {}

  // -- Field agent endpoints (mobile) --------------------------------------

  /** Active question catalogue — what the mobile form renders. */
  @Get('questions')
  @Roles('super_admin', 'ops_manager', 'field_agent')
  listQuestions(@CurrentUser() user: JwtPayload) {
    return this.svc.listActiveQuestions(user.companyId);
  }

  /** Pending tasks assigned to the current field agent. */
  @Get('my')
  @Roles('super_admin', 'ops_manager', 'field_agent')
  listMy(@CurrentUser() user: JwtPayload) {
    return this.svc.listMyTasks(user.companyId, user.sub);
  }

  /** Submit answers for an assigned task. */
  @Post(':id/submit')
  @Roles('super_admin', 'ops_manager', 'field_agent')
  submit(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { answers: Record<string, unknown> },
  ) {
    return this.svc.submit(user.companyId, user.sub, id, body.answers ?? {});
  }

  // -- Admin endpoints (web) -----------------------------------------------

  /** All questions including inactive — admin sees the full catalogue. */
  @Get('admin/questions')
  @Roles('super_admin', 'ops_manager')
  listAll(@CurrentUser() user: JwtPayload) {
    return this.svc.listAllQuestions(user.companyId);
  }

  @Post('admin/questions')
  @Roles('super_admin', 'ops_manager')
  create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      key: string;
      label: string;
      helperText?: string;
      type: PropertyDetailQuestionType;
      options?: string[];
      isRequired?: boolean;
      position?: number;
    },
  ) {
    return this.svc.createQuestion(user.companyId, body);
  }

  @Patch('admin/questions/:id')
  @Roles('super_admin', 'ops_manager')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: Partial<{
      label: string;
      helperText: string | null;
      type: PropertyDetailQuestionType;
      options: string[] | null;
      isRequired: boolean;
      isActive: boolean;
      position: number;
    }>,
  ) {
    return this.svc.updateQuestion(user.companyId, id, body);
  }

  @Delete('admin/questions/:id')
  @Roles('super_admin', 'ops_manager')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.deleteQuestion(user.companyId, id);
  }

  /** Coverage stats — used by the merged /analytics page. */
  @Get('coverage')
  @Roles('super_admin', 'ops_manager')
  coverage(@CurrentUser() user: JwtPayload) {
    return this.svc.coverage(user.companyId);
  }
}
