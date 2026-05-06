import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { FilesService } from './files.service';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Authenticated file streaming. Tenant-scoped. */
  @Get(':id')
  async stream(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    try {
      const { file, buffer } = await this.files.read(user.companyId, id);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${file.originalName ?? id}"`,
      );
      res.end(buffer);
    } catch {
      throw new NotFoundException('File not found');
    }
  }
}
