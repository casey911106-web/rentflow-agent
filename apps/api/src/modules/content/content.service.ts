import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviderRef } from '../ai-agent/ai-provider.ref';
import { MetaGraphAdapter } from './meta-graph.adapter';
import { TelegramAdapter } from './telegram.adapter';

const SLUG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SLUG_LENGTH = 8;

const MARKETPLACE_BASE = process.env.MARKETPLACE_BASE_URL ?? 'https://rentflow-agent.vercel.app';
const PUBLIC_API_BASE = process.env.PUBLIC_API_URL ?? 'https://rentflow-api.rentalho.com';

const TG_CAPTION_MAX = 1024; // sendPhoto/sendMediaGroup caption limit
const TG_TEXT_MAX = 4096; // sendMessage limit

interface GenerateCaptionInput {
  propertyId: string;
  /** PostChannel.id — drives language + tone hint via the channel name. */
  channelId: string;
  /** Optional human override for the generated caption. */
  manualOverride?: string;
}

interface PublishInput {
  propertyId: string;
  channelId: string;
  caption: string;
  publisherUserId: string;
}

/**
 * Generates and publishes property content to owned channels (Telegram now,
 * Instagram/Facebook later). One PostPlacement row per published post — the
 * tracking slug stamped on the marketplace link is what we attribute leads
 * back to.
 */
@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiRef: AiProviderRef,
    private readonly telegram: TelegramAdapter,
    private readonly meta: MetaGraphAdapter,
  ) {}

  async listChannels(companyId: string) {
    return this.prisma.postChannel.findMany({
      where: { companyId, automated: true, active: true },
      orderBy: [{ platform: 'asc' }, { name: 'asc' }],
    });
  }

  /** Ask Claude for a channel-appropriate caption. Operator can edit before publishing. */
  async generateCaption(input: GenerateCaptionInput): Promise<{ caption: string; modelId: string }> {
    const [property, channel] = await Promise.all([
      this.prisma.property.findUnique({
        where: { id: input.propertyId },
        select: {
          code: true,
          name: true,
          type: true,
          area: true,
          priceAed: true,
          occupancyMax: true,
          description: true,
          amenities: true,
          status: true,
        },
      }),
      this.prisma.postChannel.findUnique({ where: { id: input.channelId } }),
    ]);
    if (!property) throw new NotFoundException(`Property ${input.propertyId} not found`);
    if (!channel) throw new NotFoundException(`Channel ${input.channelId} not found`);

    const language = inferLanguageFromChannelName(channel.name);
    const platformLabel = channel.platform; // 'telegram' | 'instagram' | ...

    const systemPrompt = buildSystemPrompt(platformLabel, language);
    const userPrompt = buildUserPrompt(property, language);

    const provider = this.aiRef.provider;
    const modelId = process.env.AI_MODEL ?? 'claude-sonnet-4-6';

    const response = await provider.complete({
      systemBlocks: [{ text: systemPrompt }],
      userPrompt,
      maxTokens: 500,
      model: modelId,
    });

    const caption = (response.text ?? '').trim();
    if (!caption) {
      throw new BadRequestException('AI returned empty caption');
    }
    return { caption, modelId: response.model ?? modelId };
  }

  /**
   * Publish one piece of content to one channel. Creates a PostPlacement,
   * mints a tracking slug, posts via the platform adapter, then stamps the
   * placement with externalPostId + externalUrl.
   */
  async publish(input: PublishInput) {
    const [property, channel] = await Promise.all([
      this.prisma.property.findUnique({
        where: { id: input.propertyId },
        select: {
          id: true,
          companyId: true,
          code: true,
          name: true,
          media: {
            orderBy: { position: 'asc' },
            take: 10,
            select: { file: { select: { id: true, mimeType: true } } },
          },
        },
      }),
      this.prisma.postChannel.findUnique({ where: { id: input.channelId } }),
    ]);
    if (!property) throw new NotFoundException(`Property ${input.propertyId} not found`);
    if (!channel) throw new NotFoundException(`Channel ${input.channelId} not found`);
    if (!channel.automated || !channel.externalId) {
      throw new BadRequestException(`Channel ${channel.name} is not configured for automation`);
    }
    if (channel.companyId !== property.companyId) {
      throw new BadRequestException('Channel and property belong to different companies');
    }

    // Need a PostPackage to satisfy the existing FK on PostPlacement.
    // Reuse the latest if one exists for this property; create a stub otherwise.
    const postPackage = await this.ensurePostPackage(property.id, property.companyId);

    const trackingSlug = this.generateSlug();
    const trackingUrl = `${MARKETPLACE_BASE}/p/${property.code}?s=${trackingSlug}`;

    const captionWithLink = this.appendTrackingLink(input.caption, trackingUrl, channel.platform);

    // Pick adapter by platform.
    let result: { externalPostId: string; externalUrl: string | null };
    if (channel.platform === 'telegram') {
      const tg = await this.publishTelegram(channel, property, captionWithLink);
      result = { externalPostId: String(tg.messageId), externalUrl: tg.externalUrl };
    } else if (channel.platform === 'facebook') {
      result = await this.publishFacebookPage(channel, property, captionWithLink);
    } else if (channel.platform === 'instagram') {
      result = await this.publishInstagram(channel, property, captionWithLink);
    } else {
      throw new BadRequestException(`Platform ${channel.platform} not yet supported`);
    }

    const placement = await this.prisma.postPlacement.create({
      data: {
        companyId: property.companyId,
        postPackageId: postPackage.id,
        publisherUserId: input.publisherUserId,
        channelName: channel.name,
        channelKind: channel.platform,
        externalUrl: result.externalUrl,
        externalPostId: result.externalPostId,
        caption: captionWithLink,
        trackingSlug,
        automated: true,
      },
    });

    return placement;
  }

  /** Increment click counter and timestamp for a tracking slug. Returns the placement (or null). */
  async recordClick(slug: string) {
    const updated = await this.prisma.postPlacement.updateMany({
      where: { trackingSlug: slug },
      data: { clicks: { increment: 1 }, lastClickAt: new Date() },
    });
    if (updated.count === 0) return null;
    return this.prisma.postPlacement.findUnique({ where: { trackingSlug: slug } });
  }

  // ------------------------------------------------------------------------
  // privates
  // ------------------------------------------------------------------------

  private async publishTelegram(
    channel: { externalId: string | null; name: string },
    property: {
      code: string;
      media: { file: { id: string; mimeType: string } }[];
    },
    caption: string,
  ) {
    const chatId = channel.externalId!;
    // Telegram supports the channel @username as chat_id too; the externalUrl
    // builder needs the username (without `@`) — derive from the channel name
    // if it follows our convention: "Dubai Rentals (@RentFlowDubai)" — fall
    // back to numeric chat id which still works for posts but not for URL.
    const channelUsername = extractUsername(channel.name) ?? extractUsername(chatId);

    const photos = property.media.filter((m) => m.file.mimeType.startsWith('image/'));
    const photoUrls = photos.map((m) => `${PUBLIC_API_BASE}/public/files/${m.file.id}`);

    const truncCaption = truncate(caption, TG_CAPTION_MAX);
    if (photoUrls.length >= 2) {
      return this.telegram.sendMediaGroup({
        chatId,
        media: photoUrls.map((url) => ({ url, type: 'photo' as const })),
        caption: truncCaption,
        channelUsername,
      });
    }
    if (photoUrls.length === 1) {
      return this.telegram.sendPhoto({
        chatId,
        photoUrl: photoUrls[0]!,
        caption: truncCaption,
        channelUsername,
      });
    }
    // No photos → plain text (full 4096-char budget)
    return this.telegram.sendMessage({
      chatId,
      text: truncate(caption, TG_TEXT_MAX),
      channelUsername,
      disableWebPagePreview: false,
    });
  }

  private async publishFacebookPage(
    channel: { externalId: string | null; name: string },
    property: {
      code: string;
      media: { file: { id: string; mimeType: string } }[];
    },
    caption: string,
  ) {
    const pageId = channel.externalId!;
    const photos = property.media.filter((m) => m.file.mimeType.startsWith('image/'));
    const photoUrls = photos.map((m) => `${PUBLIC_API_BASE}/public/files/${m.file.id}`);
    if (photoUrls.length >= 2) {
      return this.meta.postFacebookPageMultiPhoto({
        pageId,
        photoUrls,
        caption,
      });
    }
    if (photoUrls.length === 1) {
      return this.meta.postFacebookPagePhoto({
        pageId,
        photoUrl: photoUrls[0]!,
        caption,
      });
    }
    return this.meta.postFacebookPageText({ pageId, text: caption });
  }

  private async publishInstagram(
    channel: { externalId: string | null; name: string },
    property: {
      code: string;
      media: { file: { id: string; mimeType: string } }[];
    },
    caption: string,
  ) {
    const igUserId = channel.externalId!;
    const photos = property.media.filter((m) => m.file.mimeType.startsWith('image/'));
    const photoUrls = photos.map((m) => `${PUBLIC_API_BASE}/public/files/${m.file.id}`);
    if (photoUrls.length === 0) {
      throw new Error(
        `Instagram requires at least one image for property ${property.code} — none on file`,
      );
    }
    if (photoUrls.length === 1) {
      return this.meta.postInstagramSingle({
        igUserId,
        photoUrl: photoUrls[0]!,
        caption,
      });
    }
    return this.meta.postInstagramCarousel({
      igUserId,
      photoUrls,
      caption,
    });
  }

  private appendTrackingLink(caption: string, url: string, platform: string): string {
    if (caption.includes(url)) return caption;
    // Telegram renders a clean link preview if the URL is on its own line.
    const sep = platform === 'telegram' ? '\n\n' : '\n';
    return `${caption.trimEnd()}${sep}${url}`;
  }

  private async ensurePostPackage(propertyId: string, companyId: string) {
    const existing = await this.prisma.postPackage.findFirst({
      where: { propertyId, companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing;
    return this.prisma.postPackage.create({
      data: { propertyId, companyId, status: 'draft' },
    });
  }

  private generateSlug(): string {
    let s = '';
    for (let i = 0; i < SLUG_LENGTH; i++) {
      s += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
    }
    return s;
  }
}

// ---------------------------------------------------------------------------
// prompt builders
// ---------------------------------------------------------------------------

function buildSystemPrompt(platform: string, language: 'en' | 'es' | 'ar'): string {
  const langLine = {
    en: 'Write in clear, concise English.',
    es: 'Escribe en español neutro y natural.',
    ar: 'اكتب بالعربية الفصيحة الواضحة.',
  }[language];

  const platformGuide = {
    telegram: `Telegram channel post — 200 to 400 characters. Use 1-3 emojis sparingly to draw the eye. Lead with the strongest hook (location + standout perk). Then the price. Then a one-line CTA pushing the lead to view photos and message us. Keep paragraphs short for mobile reading.`,
    instagram: `Instagram caption — 100 to 200 characters. Hook in first 8 words. Use 5-10 hashtags at the end (location + property type).`,
    facebook: `Facebook page post — 150 to 300 characters. Conversational tone. No hashtags.`,
  }[platform as 'telegram' | 'instagram' | 'facebook'] ?? 'Generic property post.';

  return `You are a real-estate marketing copywriter for RentFlow Dubai. Generate a short post for the platform below from the property data the user provides.

${langLine}

${platformGuide}

HARD RULES:
- Always include the monthly rent (AED).
- Never mention deposit or commission — those go on the marketplace page.
- Never invent features the property data does not list.
- Never use ALL CAPS, exclamation spam, or marketing buzzwords ("AMAZING!!", "DREAM HOME!!").
- Output ONLY the post text. No labels, no quotes, no preamble like "Here's your post:".
- Do NOT include any URL — the system appends the marketplace link automatically.`;
}

function buildUserPrompt(
  p: {
    code: string;
    name: string;
    type: string;
    area: string | null;
    priceAed: unknown;
    occupancyMax: number | null;
    description: string | null;
    amenities: unknown;
    status: string;
  },
  language: string,
): string {
  const rent = p.priceAed ? `AED ${String(p.priceAed)}/month` : 'price on request';
  const sleeps = p.occupancyMax ? `, sleeps ${p.occupancyMax}` : '';
  const typeLabel = humanType(p.type) ?? p.type;
  const where = p.area ?? 'Dubai';
  const desc = p.description ? `Description: ${p.description}` : '';
  const amenities = Array.isArray(p.amenities) && p.amenities.length
    ? `Amenities: ${(p.amenities as string[]).slice(0, 6).join(', ')}`
    : '';

  return `Property
Title: ${p.name}
Code: ${p.code}
Type: ${typeLabel}${sleeps}
Location: ${where}
Rent: ${rent}
${desc}
${amenities}

Write the post now. Language: ${language}. Output the post text only.`.trim();
}

function humanType(t: string): string | null {
  switch (t) {
    case 'studio': return 'studio';
    case 'one_bedroom': return '1 bedroom';
    case 'two_bedroom': return '2 bedrooms';
    case 'three_bedroom': return '3 bedrooms';
    case 'villa': return 'villa';
    case 'master_room': return 'master bedroom';
    case 'shared_room': return 'shared room';
    case 'partition': return 'partition';
    case 'bed_space': return 'bed space';
    default: return null;
  }
}

function inferLanguageFromChannelName(name: string): 'en' | 'es' | 'ar' {
  const n = name.toLowerCase();
  if (/\b(es|esp|español|spanish|latinos|hispano|rentas|dubái)\b/.test(n)) return 'es';
  if (/\b(ar|arabic|عربي|عربية)\b/.test(n)) return 'ar';
  return 'en';
}

function extractUsername(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/@([A-Za-z0-9_]{3,})/);
  return m?.[1] ?? null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}
