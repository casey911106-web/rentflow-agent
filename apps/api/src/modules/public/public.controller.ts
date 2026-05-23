import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Public marketplace endpoints — no auth required.
 *
 * The marketplace shows the inventory to leads (and the AI agent links to
 * /p/<code> when answering inbound). Only properties with status='available'
 * and at least one photo are returned.
 */
@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  @Public()
  @Get('properties')
  async list(
    @Query('area') area?: string,
    @Query('type') type?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('bedrooms') bedrooms?: string,
    @Query('availableNow') availableNow?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
  ) {
    // Marketplace surface = properties with at least one active Fast Posting
    // package (operator deliberately listed them) AND status='available'.
    // 'paused' / 'failed' / 'draft' post packages don't qualify — they're WIP
    // or de-listed.
    const where: Record<string, unknown> = {
      deletedAt: null,
      status: 'available',
      postPackages: {
        some: {
          deletedAt: null,
          status: { in: ['generated', 'scheduled', 'pending_approval', 'approved', 'published'] },
        },
      },
    };
    if (area) where.area = area;
    if (type) where.type = type;
    if (minPrice || maxPrice) {
      where.priceAed = {};
      if (minPrice) (where.priceAed as Record<string, unknown>).gte = Number(minPrice);
      if (maxPrice) (where.priceAed as Record<string, unknown>).lte = Number(maxPrice);
    }
    if (q) where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { area: { contains: q, mode: 'insensitive' } },
      { code: { contains: q, mode: 'insensitive' } },
    ];

    let orderBy: Record<string, 'asc' | 'desc'> = { availabilityConfirmedAt: 'desc' };
    if (sort === 'price_asc') orderBy = { priceAed: 'asc' };
    else if (sort === 'price_desc') orderBy = { priceAed: 'desc' };
    else if (sort === 'newest') orderBy = { createdAt: 'desc' };

    const all = await this.prisma.property.findMany({
      where,
      orderBy,
      take: 200,
      select: {
        id: true,
        code: true,
        name: true,
        area: true,
        type: true,
        priceAed: true,
        occupancyMax: true,
        availabilityConfirmedAt: true,
        latitude: true,
        longitude: true,
        media: {
          orderBy: { position: 'asc' },
          take: 1,
          select: { file: { select: { id: true, mimeType: true } } },
        },
      },
    });

    let properties = all.filter((p) => p.media.length > 0);

    if (availableNow === 'true') {
      const now = new Date();
      const blocks = await this.prisma.propertyAvailabilityBlock.findMany({
        where: {
          propertyId: { in: properties.map((p) => p.id) },
          startsAt: { lte: now },
          endsAt: { gte: now },
        },
        select: { propertyId: true },
      });
      const blockedIds = new Set(blocks.map((b) => b.propertyId));
      properties = properties.filter((p) => !blockedIds.has(p.id));
    }

    return properties;
  }

  @Public()
  @Get('properties/:code')
  async detail(@Param('code') code: string) {
    const company = await this.prisma.company.findFirst();
    if (!company) throw new NotFoundException();

    const property = await this.prisma.property.findFirst({
      where: {
        companyId: company.id,
        code,
        deletedAt: null,
        status: 'available',
        // Mirror the list endpoint gate: a public detail page should only
        // exist while the operator has an active Fast Posting package. Once
        // every package is paused/archived/failed the listing falls off the
        // marketplace and the deep link 404s — matches operator intent.
        postPackages: {
          some: {
            deletedAt: null,
            status: { in: ['generated', 'scheduled', 'pending_approval', 'approved', 'published'] },
          },
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
        area: true,
        addressLine: true,
        type: true,
        priceAed: true,
        description: true,
        occupancyMax: true,
        latitude: true,
        longitude: true,
        availabilityConfirmedAt: true,
        media: {
          orderBy: { position: 'asc' },
          select: { file: { select: { id: true, mimeType: true } }, caption: true },
        },
        availabilityBlocks: {
          where: { endsAt: { gte: new Date() } },
          orderBy: { startsAt: 'asc' },
          take: 5,
          select: { startsAt: true, endsAt: true },
        },
      },
    });
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  @Public()
  @Get('files/:id')
  async streamFile(@Param('id') id: string, @Res() res: Response) {
    // Allowlist of publicly serveable FileUploads:
    //   1) Anything linked to PropertyMedia (marketplace photos)
    //   2) FileUploads tagged with ownerEntityType='CarouselSlide' — the
    //      hook/CTA overlay renders the carousel renderer generates, which
    //      Instagram Graph API needs to fetch by public URL.
    // Anything else (contracts, audit attachments) stays auth-gated.
    let companyId: string | null = null;
    const isPublicPhoto = await this.prisma.propertyMedia.findFirst({
      where: { fileUploadId: id },
      select: { id: true, file: { select: { companyId: true } } },
    });
    if (isPublicPhoto?.file) {
      companyId = isPublicPhoto.file.companyId;
    } else {
      const carouselFile = await this.prisma.fileUpload.findFirst({
        where: { id, ownerEntityType: 'CarouselSlide' },
        select: { companyId: true },
      });
      if (carouselFile) {
        companyId = carouselFile.companyId;
      }
    }
    if (!companyId) throw new NotFoundException();

    try {
      const { file, buffer } = await this.files.read(companyId, id);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.end(buffer);
    } catch {
      throw new NotFoundException('File not found');
    }
  }

  /**
   * Beacon endpoint hit by the marketplace page when a visitor lands via a
   * tracked link (`/p/<CODE>?s=<SLUG>`). Best-effort — we never throw, and
   * an unknown slug returns 204 like a known one. Keeps probing cheap.
   */
  @Get('track/click/:slug')
  async trackClick(@Param('slug') slug: string, @Res() res: Response) {
    const safe = (slug ?? '').replace(/[^A-Z0-9]/gi, '').slice(0, 16);
    if (safe) {
      try {
        await this.prisma.postPlacement.updateMany({
          where: { trackingSlug: safe },
          data: { clicks: { increment: 1 }, lastClickAt: new Date() },
        });
      } catch {
        // intentionally swallow — public beacon
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(204).end();
  }
}
