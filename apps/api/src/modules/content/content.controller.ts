import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentService } from './content.service';

interface AuthRequest extends Request {
  user?: { id: string; companyId: string; roles: string[] };
}

@Controller('admin/content')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'ops_manager')
export class ContentController {
  constructor(
    private readonly content: ContentService,
    private readonly prisma: PrismaService,
  ) {}

  /** List automated channels available for posting. */
  @Get('channels')
  async channels(@Req() req: AuthRequest) {
    const companyId = requireCompanyId(req);
    return this.content.listChannels(companyId);
  }

  /** Generate an AI caption for (property, channel). Operator can edit before publishing. */
  @Post('generate')
  async generate(
    @Req() req: AuthRequest,
    @Body() body: { propertyId?: string; channelId?: string },
  ) {
    requireCompanyId(req);
    if (!body.propertyId || !body.channelId) {
      throw new BadRequestException('propertyId and channelId are required');
    }
    return this.content.generateCaption({
      propertyId: body.propertyId,
      channelId: body.channelId,
    });
  }

  /** Publish a (property, channel, caption) tuple immediately. */
  @Post('publish')
  async publish(
    @Req() req: AuthRequest,
    @Body() body: { propertyId?: string; channelId?: string; caption?: string },
  ) {
    const companyId = requireCompanyId(req);
    const userId = req.user!.id;
    if (!body.propertyId || !body.channelId || !body.caption?.trim()) {
      throw new BadRequestException('propertyId, channelId and caption are required');
    }
    const placement = await this.content.publish({
      propertyId: body.propertyId,
      channelId: body.channelId,
      caption: body.caption.trim(),
      publisherUserId: userId,
    });
    if (placement.companyId !== companyId) {
      throw new BadRequestException('Cross-company publish is not allowed');
    }
    return placement;
  }

  /** Recent placements with click + lead counts for the analytics tile. */
  @Get('placements')
  async placements(
    @Req() req: AuthRequest,
    @Query('limit') limitRaw?: string,
  ) {
    const companyId = requireCompanyId(req);
    const limit = Math.min(Number(limitRaw) || 50, 200);
    const rows = await this.prisma.postPlacement.findMany({
      where: { companyId, automated: true },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      include: {
        postPackage: { select: { property: { select: { code: true, name: true } } } },
        _count: { select: { attributedLeads: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      channelName: r.channelName,
      channelKind: r.channelKind,
      caption: r.caption,
      externalUrl: r.externalUrl,
      trackingSlug: r.trackingSlug,
      clicks: r.clicks,
      leadsAttributed: r._count.attributedLeads,
      publishedAt: r.publishedAt,
      property: r.postPackage?.property
        ? { code: r.postPackage.property.code, name: r.postPackage.property.name }
        : null,
    }));
  }

  /** KPI summary by channel + by attribution source. */
  @Get('analytics')
  async analytics(@Req() req: AuthRequest) {
    const companyId = requireCompanyId(req);
    const [byChannel, leadsBySource, totals] = await Promise.all([
      this.prisma.postPlacement.groupBy({
        by: ['channelName'],
        where: { companyId, automated: true },
        _count: { _all: true },
        _sum: { clicks: true },
      }),
      this.prisma.lead.groupBy({
        by: ['attributionSource'],
        where: { companyId, attributionSource: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.postPlacement.aggregate({
        where: { companyId, automated: true },
        _count: { _all: true },
        _sum: { clicks: true },
      }),
    ]);
    return {
      totals: {
        placements: totals._count._all,
        clicks: totals._sum.clicks ?? 0,
      },
      byChannel: byChannel.map((b) => ({
        channelName: b.channelName,
        placements: b._count._all,
        clicks: b._sum.clicks ?? 0,
      })),
      leadsBySource: leadsBySource.map((l) => ({
        source: l.attributionSource,
        leads: l._count._all,
      })),
    };
  }
}

function requireCompanyId(req: AuthRequest): string {
  const id = req.user?.companyId;
  if (!id) throw new BadRequestException('Missing company context');
  return id;
}
