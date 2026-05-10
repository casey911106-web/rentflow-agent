import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { buildClickToChatUrl } from '@rentflow/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentService } from '../content/content.service';

/** Minimum readiness score before a Fast Posting package can be generated.
 *  Lowered from 60 to 50 so small data gaps (no video, no commission policy
 *  set yet) don't block listing — but properties with only a name still
 *  fail. The error response now lists exactly which factors are missing
 *  and their point values so ops can fix the right things instead of
 *  guessing. */
const READINESS_GATE = 50;

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

  async list(companyId: string) {
    const packages = await this.prisma.postPackage.findMany({
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
        _count: { select: { leads: true, placements: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    // Augment with how many publishers are currently working on each
    // package — the operational signal of "is this in active rotation
    // right now" vs "just sitting there". Done as a single grouped query
    // so we don't N+1 across 200 packages.
    if (packages.length === 0) return packages;

    const pendingByPackage = await this.prisma.postAssignment.groupBy({
      by: ['postPackageId'],
      where: {
        companyId,
        status: 'pending',
        postPackageId: { in: packages.map((p) => p.id) },
      },
      _count: { _all: true },
    });
    const pendingMap = new Map(pendingByPackage.map((r) => [r.postPackageId, r._count._all]));

    return packages.map((p) => ({
      ...p,
      pendingAssignmentsCount: pendingMap.get(p.id) ?? 0,
    }));
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
      include: { media: true },
    });
    if (!property) throw new NotFoundException('Property not found');
    if (property.readinessScore < READINESS_GATE) {
      const missing = describeMissingReadinessFactors(property);
      const lines = [
        `Readiness ${property.readinessScore}/100 (mínimo ${READINESS_GATE} para publicar).`,
        '',
        'Lo que falta para llegar al mínimo:',
        ...missing.map((m) => `  • +${m.points}  ${m.label}`),
      ];
      throw new ConflictException({
        code: 'readiness_too_low',
        message: lines.join('\n'),
        readinessScore: property.readinessScore,
        threshold: READINESS_GATE,
        missing,
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

/** Mirrors the factor list inside ScoresService.recomputeReadiness. Kept
 *  inline rather than imported so this module doesn't need a hard
 *  dependency on ScoresService just to format an error. If you change
 *  the weights or factors there, update the labels here too. */
function describeMissingReadinessFactors(property: {
  availabilityConfirmedAt: Date | null;
  priceConfirmedAt: Date | null;
  ownerId: string | null;
  description: string | null;
  commissionPolicy: string | null;
  depositAed: { toString(): string } | null;
  moveInDate: Date | null;
  occupancyMax: number | null;
  viewingAccess: string | null;
  media: Array<{ kind: string }>;
}): Array<{ key: string; points: number; label: string }> {
  const within = (date: Date | null, days: number) =>
    date ? Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000 : false;

  const photos = property.media.filter((m) => m.kind !== 'video').length;
  const hasVideo = property.media.some((m) => m.kind === 'video');

  const missing: Array<{ key: string; points: number; label: string }> = [];
  if (!within(property.availabilityConfirmedAt, 7)) {
    missing.push({ key: 'availabilityFresh', points: 20, label: 'Confirmar disponibilidad reciente (toca "Confirmar disponibilidad" — vence cada 7 días)' });
  }
  if (!within(property.priceConfirmedAt, 14)) {
    missing.push({ key: 'priceConfirmedFresh', points: 15, label: 'Confirmar precio reciente (toca "Confirmar precio" — vence cada 14 días)' });
  }
  if (photos < 3) {
    missing.push({
      key: 'hasPhotos',
      points: photos === 0 ? 15 : 7,
      label: photos === 0 ? 'Subir mínimo 3 fotos (0 actualmente)' : `Subir más fotos hasta llegar a 3 (${photos} actualmente, parcial)`,
    });
  }
  if (!property.description) {
    missing.push({ key: 'descriptionReady', points: 10, label: 'Escribir descripción del apartamento' });
  }
  if (!property.ownerId) {
    missing.push({ key: 'ownerLinked', points: 10, label: 'Vincular Owner (dueño) en /owners' });
  }
  if (!hasVideo) {
    missing.push({ key: 'hasVideo', points: 5, label: 'Subir un video corto (recorrido del apto)' });
  }
  if (!property.depositAed) {
    missing.push({ key: 'depositClear', points: 5, label: 'Especificar el depósito reembolsable (AED)' });
  }
  if (!property.commissionPolicy) {
    missing.push({ key: 'commissionClear', points: 5, label: 'Definir política de comisión' });
  }
  if (!property.moveInDate) {
    missing.push({ key: 'moveInDateClear', points: 5, label: 'Indicar fecha de move-in disponible' });
  }
  if (!property.occupancyMax) {
    missing.push({ key: 'occupancyRulesClear', points: 5, label: 'Indicar capacidad máxima de personas' });
  }
  if (!property.viewingAccess) {
    missing.push({ key: 'viewingAccessConfirmed', points: 5, label: 'Confirmar cómo accede el field agent (llaves, lockbox, etc.)' });
  }

  // Sort by points descending so ops fixes the highest-value gaps first.
  missing.sort((a, b) => b.points - a.points);
  return missing;
}
