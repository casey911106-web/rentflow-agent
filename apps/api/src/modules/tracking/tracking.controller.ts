import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('tracking')
@Controller('t')
export class TrackingController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /t/:postCode → records the click and 302-redirects to the public
   *  marketplace property page so the lead sees the full gallery + details
   *  before deciding to WhatsApp. The marketplace page has a prominent
   *  'Message on WhatsApp' button. */
  @Public()
  @Get(':postCode')
  async redirect(@Param('postCode') postCode: string, @Res() res: Response) {
    const link = await this.prisma.trackingLink.findUnique({
      where: { postCode },
      include: { postPackage: { select: { property: { select: { code: true } } } } },
    });
    if (!link) throw new NotFoundException('Unknown tracking link');
    await this.prisma.trackingLink.update({
      where: { id: link.id },
      data: { clicks: { increment: 1 }, lastClickAt: new Date() },
    });
    const marketplaceBase =
      process.env.MARKETPLACE_BASE_URL ?? 'https://rentflow-agent.vercel.app';
    const propertyCode = link.postPackage?.property?.code;
    const target = propertyCode
      ? `${marketplaceBase}/p/${propertyCode}?via=${postCode}`
      : link.whatsappUrl; // fallback to WA if no property attached
    return res.redirect(302, target);
  }
}
