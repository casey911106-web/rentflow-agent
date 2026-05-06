import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('tracking')
@Controller('t')
export class TrackingController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /t/:postCode → records the click and 302-redirects to whatsappUrl. */
  @Public()
  @Get(':postCode')
  async redirect(@Param('postCode') postCode: string, @Res() res: Response) {
    const link = await this.prisma.trackingLink.findUnique({ where: { postCode } });
    if (!link) throw new NotFoundException('Unknown tracking link');
    await this.prisma.trackingLink.update({
      where: { id: link.id },
      data: { clicks: { increment: 1 }, lastClickAt: new Date() },
    });
    return res.redirect(302, link.whatsappUrl);
  }
}
