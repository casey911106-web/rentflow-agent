import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { buildClickToChatUrl } from '@rentflow/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentService } from '../content/content.service';

const READINESS_GATE = 60;

@Injectable()
export class PostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
  ) {}

  /** List the company's automated channels (Telegram, IG, FB pages, etc). */
  listAutomatedChannels(companyId: string) {
    return this.content.listChannels(companyId);
  }

  /**
   * Ask the AI for a draft caption tailored to the channel. Operator reviews
   * and edits before calling autoPublish — this never publishes by itself.
   */
  async draftAutoCaption(
    companyId: string,
    packageId: string,
    channelId: string,
  ) {
    const pkg = await this.findById(companyId, packageId);
    if (!pkg.propertyId) {
      throw new BadRequestException('Auto-caption is only available for property listings');
    }
    return this.content.generateCaption({ propertyId: pkg.propertyId, channelId });
  }

  /**
   * Publish a package to one of the company's automated channels. The
   * resulting PostPlacement carries `automated=true` and a tracking slug so
   * we can attribute clicks/leads back to this exact post.
   */
  async autoPublish(
    companyId: string,
    packageId: string,
    userId: string,
    args: { channelId: string; caption: string },
  ) {
    const pkg = await this.findById(companyId, packageId);
    if (!args.caption?.trim()) {
      throw new BadRequestException('caption is required');
    }
    if (!pkg.propertyId) {
      throw new BadRequestException('Auto-publish via owned channels is only available for property listings');
    }
    const placement = await this.content.publish({
      propertyId: pkg.propertyId,
      channelId: args.channelId,
      caption: args.caption.trim(),
      publisherUserId: userId,
    });
    if (placement.companyId !== companyId) {
      throw new BadRequestException('Cross-company publish blocked');
    }
    // Reflect on the package so the existing UI's "published" badge lights up.
    if (pkg.status !== 'published') {
      await this.prisma.postPackage.update({
        where: { id: pkg.id },
        data: {
          status: 'published',
          publishedById: userId,
          publishedAt: new Date(),
          publishedUrl: placement.externalUrl ?? undefined,
        },
      });
    }
    return placement;
  }

  list(companyId: string) {
    return this.prisma.postPackage.findMany({
      // Fast Posting Studio is for property listings only — channel-growth
      // campaigns live in their own admin page (/admin/growth-campaigns)
      // and have property=null which would crash this UI's pkg.property.code.
      where: { companyId, deletedAt: null, kind: 'property_listing' },
      include: {
        property: {
          select: {
            id: true,
            code: true,
            name: true,
            area: true,
            status: true,
            media: {
              orderBy: { position: 'asc' },
              take: 1,
              select: { id: true, kind: true, file: { select: { id: true, mimeType: true } } },
            },
          },
        },
        channel: true,
        trackingLink: true,
        _count: { select: { leads: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async findById(companyId: string, id: string) {
    const pkg = await this.prisma.postPackage.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        property: {
          include: {
            media: {
              orderBy: { position: 'asc' },
              include: {
                file: { select: { id: true, mimeType: true, originalName: true } },
              },
            },
          },
        },
        channel: true,
        trackingLink: true,
        publishedBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
    });
    if (!pkg) throw new NotFoundException('PostPackage not found');
    return pkg;
  }

  async generate(companyId: string, body: { propertyId: string; campaignId?: string; channelId?: string }) {
    const property = await this.prisma.property.findFirst({
      where: { id: body.propertyId, companyId, deletedAt: null },
    });
    if (!property) throw new NotFoundException('Property not found');
    if (property.readinessScore < READINESS_GATE) {
      throw new ConflictException({
        code: 'readiness_too_low',
        message: `Property readiness ${property.readinessScore} is below the threshold ${READINESS_GATE}.`,
      });
    }

    const setting = await this.prisma.appSetting.findFirst({
      where: { companyId, key: 'whatsapp.business_number' },
    });
    const waBase =
      (setting?.value as { waMeBase?: string } | undefined)?.waMeBase ??
      process.env.WHATSAPP_BUSINESS_WA_ME_BASE_URL ??
      'https://wa.me/971585063316';
    const waLocal =
      (setting?.value as { local?: string } | undefined)?.local ??
      process.env.WHATSAPP_BUSINESS_PHONE_LOCAL ??
      '0585063316';

    const sourceCode = property.code;
    const postCode = await this.uniquePostCode();
    const whatsappUrl = buildClickToChatUrl({ propertyCode: sourceCode, postCode, waMeBaseUrl: waBase });

    const captions = this.buildCaptions({
      propertyName: property.name,
      propertyArea: property.area,
      propertyCode: sourceCode,
      priceAed: property.priceAed ? property.priceAed.toString() : null,
      isAvailable: property.status === 'available',
      whatsappUrl,
      waLocal,
    });
    const { priceLine, availabilityLine, shortCaption, longCaption, whatsappCaption, facebookCaption } = captions;

    const pkg = await this.prisma.postPackage.create({
      data: {
        companyId,
        propertyId: body.propertyId,
        campaignId: body.campaignId,
        channelId: body.channelId,
        status: 'generated',
        title: property.name,
        shortCaption,
        longCaption,
        whatsappCaption,
        facebookCaption,
        priceLine,
        availabilityLine,
        features: ['Wifi', 'AC', 'Cleaning', 'Near Metro'],
        trackingLink: {
          create: {
            companyId,
            sourceCode,
            postCode,
            shortUrl: `${process.env.TRACKING_BASE_URL ?? 'http://localhost:3001/t'}/${postCode}`,
            whatsappUrl,
          },
        },
      },
      include: { trackingLink: true, property: true },
    });

    return pkg;
  }

  async update(
    companyId: string,
    id: string,
    body: Partial<{
      title: string;
      shortCaption: string;
      longCaption: string;
      whatsappCaption: string;
      facebookCaption: string;
      priceLine: string;
      availabilityLine: string;
      features: string[];
    }>,
  ) {
    await this.findById(companyId, id);
    return this.prisma.postPackage.update({
      where: { id },
      data: body,
      include: { property: true, channel: true, trackingLink: true },
    });
  }

  async pause(companyId: string, id: string) {
    await this.findById(companyId, id);
    return this.prisma.postPackage.update({
      where: { id },
      data: { status: 'paused', pausedAt: new Date() },
    });
  }

  async approve(companyId: string, id: string, userId: string) {
    await this.findById(companyId, id);
    return this.prisma.postPackage.update({
      where: { id },
      data: { status: 'approved', approvedById: userId, approvedAt: new Date() },
    });
  }

  async markPublished(
    companyId: string,
    id: string,
    userId: string,
    body: { channelId?: string; channelName?: string; url?: string },
  ) {
    await this.findById(companyId, id);
    let channelId = body.channelId;
    if (!channelId && body.channelName) {
      const ch = await this.prisma.postChannel.upsert({
        where: { companyId_platform_name: { companyId, platform: 'other', name: body.channelName } },
        update: {},
        create: { companyId, name: body.channelName, platform: 'other', kind: 'unknown' },
      });
      channelId = ch.id;
    }
    return this.prisma.postPackage.update({
      where: { id },
      data: {
        status: 'published',
        channelId,
        channelName: body.channelName,
        publishedUrl: body.url,
        publishedById: userId,
        publishedAt: new Date(),
      },
    });
  }

  /** Rebuild captions for every active PostPackage tied to a Property
   *  whenever its source data (price, name, area, status) changes. Skips
   *  packages the user explicitly froze (paused/archived) so manual edits
   *  aren't clobbered. Returns the count of packages updated. */
  async regenerateForProperty(companyId: string, propertyId: string): Promise<number> {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, companyId, deletedAt: null },
    });
    if (!property) return 0;

    const packages = await this.prisma.postPackage.findMany({
      where: {
        companyId,
        propertyId,
        deletedAt: null,
        status: { notIn: ['archived', 'paused'] },
      },
      include: { trackingLink: { select: { postCode: true } } },
    });
    if (packages.length === 0) return 0;

    const setting = await this.prisma.appSetting.findFirst({
      where: { companyId, key: 'whatsapp.business_number' },
    });
    const waBase =
      (setting?.value as { waMeBase?: string } | undefined)?.waMeBase ??
      process.env.WHATSAPP_BUSINESS_WA_ME_BASE_URL ??
      'https://wa.me/971585063316';
    const waLocal =
      (setting?.value as { local?: string } | undefined)?.local ??
      process.env.WHATSAPP_BUSINESS_PHONE_LOCAL ??
      '0585063316';

    let updated = 0;
    for (const pkg of packages) {
      if (!pkg.trackingLink) continue;
      const whatsappUrl = buildClickToChatUrl({
        propertyCode: property.code,
        postCode: pkg.trackingLink.postCode,
        waMeBaseUrl: waBase,
      });
      const captions = this.buildCaptions({
        propertyName: property.name,
        propertyArea: property.area,
        propertyCode: property.code,
        priceAed: property.priceAed ? property.priceAed.toString() : null,
        isAvailable: property.status === 'available',
        whatsappUrl,
        waLocal,
      });
      await this.prisma.postPackage.update({
        where: { id: pkg.id },
        data: {
          title: property.name,
          shortCaption: captions.shortCaption,
          longCaption: captions.longCaption,
          whatsappCaption: captions.whatsappCaption,
          facebookCaption: captions.facebookCaption,
          priceLine: captions.priceLine,
          availabilityLine: captions.availabilityLine,
        },
      });
      updated++;
    }
    return updated;
  }

  private buildCaptions(input: {
    propertyName: string;
    propertyArea: string | null;
    propertyCode: string;
    priceAed: string | null;
    isAvailable: boolean;
    whatsappUrl: string;
    waLocal: string;
  }) {
    const priceLine = input.priceAed ? `AED ${input.priceAed} / month` : '';
    const availabilityLine = input.isAvailable ? 'Available now' : 'Availability TBC';
    const shortCaption = `${input.propertyName} — ${priceLine}. ${availabilityLine}.`;
    const longCaption =
      `${input.propertyName} in ${input.propertyArea ?? 'Dubai'}. ${priceLine}. ${availabilityLine}. ` +
      `Wifi, AC, cleaning. Walking distance to Metro. WhatsApp ${input.waLocal} for viewing.`;
    const whatsappCaption = `🏠 ${input.propertyName}\n${priceLine}\n📍 ${input.propertyArea ?? '—'}\nWA: ${input.waLocal}\nCode: ${input.propertyCode}`;
    const facebookCaption =
      `${input.propertyName}\n${input.propertyArea ?? '—'} | ${priceLine}\nFurnished, wifi included.\nMessage on WhatsApp: ${input.whatsappUrl}`;
    return { priceLine, availabilityLine, shortCaption, longCaption, whatsappCaption, facebookCaption };
  }

  // ===========================================================================
  // CHANNEL GROWTH — promote our own channels (Telegram / FB page / IG / etc.)
  // ===========================================================================

  /** Create a channel-growth PostPackage. No Property is involved; the
   *  tracking link redirects directly to `targetUrl` (the channel join URL).
   *  Once created the package enters the same round-robin pool as property
   *  listings so field agents post it in their groups. */
  async createGrowthCampaign(
    companyId: string,
    body: {
      title: string;
      caption: string;
      targetUrl: string;
      targetLabel: string;
      targetKind?: string; // 'telegram' | 'facebook_page' | 'instagram' | 'whatsapp_community' | 'other'
    },
  ) {
    if (!body.title?.trim()) throw new BadRequestException('title is required');
    if (!body.caption?.trim()) throw new BadRequestException('caption is required');
    if (!body.targetUrl?.trim()) throw new BadRequestException('targetUrl is required');
    if (!body.targetLabel?.trim()) throw new BadRequestException('targetLabel is required');
    try {
      // eslint-disable-next-line no-new
      new URL(body.targetUrl);
    } catch {
      throw new BadRequestException('targetUrl must be a valid URL');
    }

    const sourceCode = `GROW-${this.randomBase32(5)}`;
    const postCode = await this.uniquePostCode();

    const pkg = await this.prisma.postPackage.create({
      data: {
        companyId,
        kind: 'channel_growth',
        // Skip readiness/approval flow — the post is hand-crafted by ops.
        status: 'approved',
        title: body.title.trim(),
        // Same caption fields the mobile already reads (shortCaption /
        // whatsappCaption / facebookCaption). We surface the same string
        // everywhere so the agent sees the exact text to publish.
        shortCaption: body.caption.trim(),
        whatsappCaption: body.caption.trim(),
        facebookCaption: body.caption.trim(),
        longCaption: body.caption.trim(),
        growthTargetUrl: body.targetUrl.trim(),
        growthTargetLabel: body.targetLabel.trim(),
        growthTargetKind: body.targetKind?.trim() || 'other',
        approvedAt: new Date(),
        trackingLink: {
          create: {
            companyId,
            sourceCode,
            postCode,
            shortUrl: `${process.env.TRACKING_BASE_URL ?? 'http://localhost:3001/t'}/${postCode}`,
            // For growth packages whatsappUrl is the redirect target —
            // tracking controller routes here when kind=channel_growth.
            whatsappUrl: body.targetUrl.trim(),
          },
        },
      },
      include: { trackingLink: true },
    });

    return pkg;
  }

  /** All non-archived growth campaigns with click totals. */
  async listGrowthCampaigns(companyId: string) {
    return this.prisma.postPackage.findMany({
      where: {
        companyId,
        kind: 'channel_growth',
        deletedAt: null,
        status: { not: 'archived' },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        trackingLink: { select: { shortUrl: true, postCode: true, clicks: true } },
        _count: { select: { placements: true, assignments: true } },
      },
    });
  }

  /** AI-drafted promo caption for a channel-growth campaign — operator
   *  reviews and edits before saving. The tracking URL is NOT embedded in
   *  the output (mobile shows it separately and the Share sheet sends a
   *  unique per-placement URL). */
  async draftGrowthCaption(body: {
    targetKind: string;
    targetLabel: string;
    extraContext?: string;
  }) {
    if (!body.targetLabel?.trim()) {
      throw new BadRequestException('targetLabel is required');
    }
    return this.content.generateGrowthCaption({
      targetKind: body.targetKind ?? 'other',
      targetLabel: body.targetLabel.trim(),
      extraContext: body.extraContext?.trim() || undefined,
    });
  }

  /** Archive a growth campaign — pulls it out of the round-robin pool. */
  async archiveGrowthCampaign(companyId: string, packageId: string) {
    const pkg = await this.prisma.postPackage.findFirst({
      where: { id: packageId, companyId, kind: 'channel_growth', deletedAt: null },
    });
    if (!pkg) throw new NotFoundException('Growth campaign not found');
    return this.prisma.postPackage.update({
      where: { id: packageId },
      data: { status: 'archived', archivedAt: new Date() },
    });
  }

  // ===========================================================================

  private async uniquePostCode(): Promise<string> {
    const prefix = process.env.POST_CODE_PREFIX ?? 'POST';
    for (let i = 0; i < 8; i++) {
      const code = `${prefix}-${this.randomBase32(4)}`;
      const exists = await this.prisma.trackingLink.findUnique({ where: { postCode: code } });
      if (!exists) return code;
    }
    throw new Error('Failed to generate unique post code after 8 tries');
  }

  private randomBase32(len: number): string {
    const chars = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
    let out = '';
    for (let i = 0; i < len; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }
}
