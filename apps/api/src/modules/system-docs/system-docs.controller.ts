import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { SystemDocsService } from './system-docs.service';
import type { SystemDocCategory } from './system-docs.types';

@ApiTags('system')
@Controller('system')
export class SystemDocsController {
  constructor(private readonly docs: SystemDocsService) {}

  @Get('docs')
  list(@Query('category') category?: SystemDocCategory) {
    return this.docs.list(category);
  }

  @Get('docs/:id')
  byId(@Param('id') id: string) {
    return this.docs.byId(id) ?? null;
  }

  @Public()
  @Get('build-info')
  buildInfo() {
    // SECURITY: nodeVersion omitted on purpose — it narrows the CVE
    // search space for any unauth scanner. Adapter labels stay because
    // ops needs them to verify which provider this deploy is wired to.
    return {
      version: process.env.npm_package_version ?? '0.1.0',
      bootedAt: process.env.BOOTED_AT ?? new Date().toISOString(),
      aiProvider: process.env.AI_PROVIDER ?? 'mock',
      whatsappAdapter: process.env.WHATSAPP_ADAPTER ?? 'mock',
    };
  }
}
