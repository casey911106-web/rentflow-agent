import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('tracking')
@Controller('t')
export class TrackingController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /t/:postCode[?s=<placementSlug>] → records the click and
   *  302-redirects to the public marketplace property page. When `?s=` is
   *  present, it forwards to `/p/<code>?via=<postCode>&s=<slug>` so the
   *  per-placement beacon also fires and the click is attributed to the
   *  specific channel/group the field agent posted in. */
  @Public()
  @Get(':postCode')
  async redirect(
    @Param('postCode') postCode: string,
    @Query('s') rawSlug: string | undefined,
    @Res() res: Response,
  ) {
    const link = await this.prisma.trackingLink.findUnique({
      where: { postCode },
      include: {
        postPackage: {
          select: {
            kind: true,
            growthTargetUrl: true,
            property: { select: { code: true } },
          },
        },
      },
    });
    if (!link) throw new NotFoundException('Unknown tracking link');
    await this.prisma.trackingLink.update({
      where: { id: link.id },
      data: { clicks: { increment: 1 }, lastClickAt: new Date() },
    });

    const slug = (rawSlug ?? '').replace(/[^A-Z0-9]/gi, '').slice(0, 16);

    // Channel-growth packages redirect straight to the channel join URL.
    // No marketplace page in between, so the per-placement click beacon
    // (/track/click/:slug) never fires — we attribute the slug click here.
    if (link.postPackage?.kind === 'channel_growth') {
      if (slug) {
        await this.prisma.postPlacement.updateMany({
          where: { trackingSlug: slug },
          data: { clicks: { increment: 1 }, lastClickAt: new Date() },
        });
      }
      const target = link.postPackage.growthTargetUrl ?? link.whatsappUrl;
      return res.redirect(302, target);
    }

    const marketplaceBase =
      process.env.MARKETPLACE_BASE_URL ?? 'https://app.rentalho.com';
    const propertyCode = link.postPackage?.property?.code;
    if (!propertyCode) {
      return res.redirect(302, link.whatsappUrl);
    }
    const target = slug
      ? `${marketplaceBase}/p/${propertyCode}?via=${postCode}&s=${slug}`
      : `${marketplaceBase}/p/${propertyCode}?via=${postCode}`;
    return res.redirect(302, target);
  }
}
