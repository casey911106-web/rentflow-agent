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
      where: { companyId, deletedAt: null },
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

    const priceLine = property.priceAed ? `AED ${property.priceAed.toString()} / month` : '';
    const availabilityLine = property.status === 'available' ? 'Available now' : 'Availability TBC';
    const shortCaption = `${property.name} — ${priceLine}. ${availabilityLine}.`;
    const longCaption =
      `${property.name} in ${property.area ?? 'Dubai'}. ${priceLine}. ${availabilityLine}. ` +
      `Wifi, AC, cleaning. Walking distance to Metro. WhatsApp ${waLocal} for viewing.`;
    const whatsappCaption = `🏠 ${property.name}\n${priceLine}\n📍 ${property.area ?? '—'}\nWA: ${waLocal}\nCode: ${sourceCode}`;
    const facebookCaption =
      `${property.name}\n${property.area ?? '—'} | ${priceLine}\nFurnished, wifi included.\nMessage on WhatsApp: ${whatsappUrl}`;

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
