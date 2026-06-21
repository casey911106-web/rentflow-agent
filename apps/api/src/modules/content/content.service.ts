import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviderRef } from '../ai-agent/ai-provider.ref';
import { FilesService } from '../files/files.service';
import { CarouselRendererService } from './carousel-renderer.service';
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
    private readonly carouselRenderer: CarouselRendererService,
    private readonly files: FilesService,
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

  /** Ask Claude for the THREE Fast Posting captions a publisher will paste:
   *  one for WhatsApp groups, one for Facebook groups, one for classifieds
   *  (PropertyFinder/Dubizzle). Each caption follows a 4-part copywriter
   *  framework — Hook, What, Proof/Scarcity, CTA — with channel-specific
   *  length, tone, and emoji rules. Returns plain text per channel.
   *
   *  Pass `differentAngle` to regenerate with a hint to vary the hook from
   *  whatever was previously picked.
   */
  async generateFastPostingCaptions(input: {
    propertyId: string;
    /** Public marketplace URL for this property — gets embedded in Facebook/Classifieds variants. */
    marketplaceUrl: string;
    /** Click-to-chat WhatsApp URL — embedded in the WhatsApp variant. */
    whatsappUrl: string;
    /** Tracking link short URL (e.g. https://rentflow-api.../t/POST-XYZ) — used as the placement-trackable variant. */
    trackingShortUrl: string;
    /** Hint for regeneration to avoid repeating the prior hook. */
    differentAngle?: string;
  }): Promise<{ whatsapp: string; facebook: string; classifieds: string; modelId: string }> {
    const property = await this.prisma.property.findUnique({
      where: { id: input.propertyId },
      select: {
        code: true,
        name: true,
        type: true,
        area: true,
        addressLine: true,
        priceAed: true,
        depositAed: true,
        occupancyMax: true,
        rentalMinMonths: true,
        description: true,
        moveInDate: true,
      },
    });
    if (!property) throw new NotFoundException(`Property ${input.propertyId} not found`);

    const systemPrompt = `You are a senior real-estate copywriter for a Dubai rental agency. Field agents paste your captions into WhatsApp groups, Facebook rental groups, and classified sites. The goal is conversions — a renter messages within minutes of seeing the post.

Output THREE captions for the same property, one per channel: \`whatsapp\`, \`facebook\`, \`classifieds\`. Every caption MUST follow this 4-part structure:

1. HOOK (line 1) — make them stop scrolling. Use ONE of these patterns:
   • Specific number ("AED 8,000/month with a panoramic balcony — 2km from Burj Al Arab")
   • Provocative question ("Tired of overpriced studios in Dubai Marina?")
   • Sensory image ("Your morning coffee with a full Marina view")
   • Scarcity with a CONCRETE fact ("3 units left at this price, viewings start tomorrow")
   • Social proof ("3 people asked about this one today, one left")
   FORBIDDEN hooks — these read like a bot, NEVER use them: "Available now" alone, "Hello everyone", "Check this out", "Amazing apartment", "won't last", "won't last the weekend", "moving in under 48 hours", "Here is exactly why", "you won't believe", and any vague urgency that has no concrete number or fact behind it.

2. WHAT (2-3 lines) — translate features into BENEFITS, not specs:
   • "Private balcony" → "your morning coffee with a harbour view"
   • "Walking distance to Metro" is OK only if explicitly in data
   • Don't invent features not in the property data

3. PROOF / SCARCITY (1 line, optional but encouraged) — pick one:
   • "Direct from owner, no agency fees through us"
   • "Furnished, includes wifi + housekeeping"
   • "Last unit at this price"
   • "Move-in this week"

4. CTA + LINK (1-2 lines) — one clear next step. Put the clickable link HIGH — within the first 2 lines, above the platform's "See more"/"Read more" fold — so the reader can tap it WITHOUT expanding the post. You may repeat it once at the very end too.
   • whatsapp variant uses the WhatsApp URL provided.
   • facebook + classifieds variants use the marketplace URL.

NO PLACEHOLDERS — every value must be concrete and taken from the property data below. NEVER output a bracketed or templated placeholder such as [Area], [Price], [X], {{area}}, or <area>, and never write a fill-in-the-blank sentence. If a value is missing from the data, OMIT that line entirely — do not leave a placeholder and do not guess.

CHANNEL-SPECIFIC RULES — strict:

\`whatsapp\`: 4-6 lines max. Direct, urgent. Max 2 emojis. Put the WhatsApp click-to-chat URL on its own line near the TOP — line 2, right after the hook — so it's tappable before any "See more" fold. Do NOT bury it at the end. Do NOT include rent/deposit/commission as a labeled list — weave them into prose because WA users skim.

\`facebook\`: 8-12 lines. Open with community phrasing ("Hi everyone", "For whoever was looking…"). Put the marketplace URL on its own line within the first 2 lines (right after the hook) so it's clickable above the "See more" fold; you may repeat it at the end. More breathing room with line breaks. Include rent + deposit + commission EXPLICITLY (one number per line).

\`classifieds\`: 12-20 lines, formal, factual. NO emojis. NO informal hook — first line is a clean property title (e.g. "1BR Furnished Apartment — Madinat Jumeirah Living"). Use ALL-CAPS section headers (INTERIOR, BUILDING, TERMS). Under TERMS, list the three numbers explicitly:
  • Rent: AED X / month
  • Refundable deposit: AED Y
  • Commission (one-time, on deal close): AED Z
End with marketplace URL + "Agent WhatsApp: <local number> — quote code <code>".

LANGUAGE — English ONLY. RentFlow's audience is Dubai expats and the
business publishes to English-speaking groups, pages and channels.
Avoid "amazing", "super luxurious", "stunning" without proof — let the
photo + the price say it. Proofread before output — zero typos, correct
spelling (e.g. "high floor", not "higth"), thousands separators on prices.

NEVER LIE — if a feature isn't in the property data, don't invent it. If the description mentions amenities, you can use them. The 3 mandatory numbers (rent / deposit / commission) come from the data; commission is calculated by bedroom count: studio/1BR = AED 1,000; 2-3BR = AED 2,000; 4+/villa = AED 3,000.

OUTPUT — JSON object only, no other text:
{
  "whatsapp": "...",
  "facebook": "...",
  "classifieds": "..."
}`;

    const bedrooms =
      property.type === 'studio'
        ? 0
        : property.type === 'one_bedroom'
        ? 1
        : property.type === 'two_bedroom'
        ? 2
        : property.type === 'three_bedroom'
        ? 3
        : property.type === 'villa'
        ? 4
        : 1;
    const commission = bedrooms <= 1 ? 1000 : bedrooms <= 3 ? 2000 : 3000;
    const priceLine = property.priceAed
      ? `AED ${Number(property.priceAed).toLocaleString()} / month`
      : 'TBC';
    const depositLine = property.depositAed
      ? `AED ${Number(property.depositAed).toLocaleString()} (refundable)`
      : 'TBC';

    // Rotate the hook angle on every generation so consecutive posts (across
    // properties and re-runs) don't all open with the same pattern — this is
    // what stops the captions reading as one repetitive template. An explicit
    // `differentAngle` (operator pressed "regenerate") always takes priority.
    const HOOK_ANGLES = [
      'Open with a SPECIFIC-NUMBER hook: the price plus one concrete standout feature from the data.',
      "Open with a PROVOCATIVE QUESTION hook aimed at a renter's real frustration (price, location, agency fees).",
      'Open with a SENSORY-IMAGE hook: what daily life in this exact unit feels like.',
      'Open with a CONCRETE-SCARCITY hook: a real, specific fact only — never vague urgency.',
      'Open with a SOCIAL-PROOF hook: genuine interest or demand, stated concretely.',
    ];
    const rotatedAngle = HOOK_ANGLES[Math.floor(Math.random() * HOOK_ANGLES.length)];
    const angleHint = input.differentAngle ?? rotatedAngle;

    const userPrompt = `Property data:
- Code: ${property.code}
- Name: ${property.name}
- Type: ${property.type.replace(/_/g, ' ')}
- Area: ${property.area ?? 'Dubai'}${property.addressLine ? ` (${property.addressLine})` : ''}
- Rent: ${priceLine}
- Refundable deposit: ${depositLine}
- Commission (one-time, on close): AED ${commission.toLocaleString()}
- Occupancy max: ${property.occupancyMax ?? 'not set'}
- Min stay: ${property.rentalMinMonths ?? 1} month(s)
- Move-in date: ${property.moveInDate ? property.moveInDate.toISOString().slice(0, 10) : 'flexible'}
- Description (use as source for features, do not copy verbatim):
${(property.description ?? '(no description provided)').slice(0, 1500)}

URLs to embed:
- Marketplace (use in facebook + classifieds): ${input.marketplaceUrl}
- WhatsApp click-to-chat (use in whatsapp): ${input.whatsappUrl}

HOOK ANGLE FOR THIS GENERATION (apply to the whatsapp + facebook hooks): ${angleHint}${input.differentAngle ? '\nThis is a REGENERATION — make it fundamentally different from the previous version: different emotional register, different framing.' : ''}

Generate the JSON now.`;

    const provider = this.aiRef.provider;
    const modelId = process.env.AI_MODEL ?? 'claude-sonnet-4-6';
    const response = await provider.complete({
      systemBlocks: [{ text: systemPrompt }],
      userPrompt,
      maxTokens: 2000,
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['whatsapp', 'facebook', 'classifieds'],
        properties: {
          whatsapp: { type: 'string' },
          facebook: { type: 'string' },
          classifieds: { type: 'string' },
        },
      },
      model: modelId,
    });

    const parsed = (response.parsedJson ?? {}) as { whatsapp?: string; facebook?: string; classifieds?: string };
    if (!parsed.whatsapp || !parsed.facebook || !parsed.classifieds) {
      throw new BadRequestException('AI did not return all three captions');
    }
    return {
      whatsapp: parsed.whatsapp.trim(),
      facebook: parsed.facebook.trim(),
      classifieds: parsed.classifieds.trim(),
      modelId: response.model ?? modelId,
    };
  }

  /** Ask Claude for a channel-growth promo caption. The caption gets posted
   *  in FB/WA rental groups to drive followers to one of our owned channels
   *  (Telegram, FB page, IG profile). The tracking URL is NOT embedded —
   *  the mobile UI shows it separately and the Share sheet sends a unique
   *  per-placement URL. */
  async generateGrowthCaption(input: {
    targetKind: string;
    targetLabel: string;
    extraContext?: string;
    /** Hint for regeneration to vary the hook from whatever was previously picked. */
    differentAngle?: string;
  }): Promise<{ caption: string; modelId: string }> {
    const platformLabel = describeGrowthPlatform(input.targetKind);
    const systemPrompt = `You are a senior copywriter for a Dubai rental agency. Field agents paste your post into OTHER rental-related Facebook/WhatsApp groups to drive followers to one of our owned channels (Telegram channel, FB page, IG profile, WhatsApp community). The job: a renter sees this in a noisy group and STOPS scrolling.

Every caption follows this 4-part structure:

1. HOOK (line 1) — the reason they stop. Pick ONE pattern:
   • Specific value with number ("5 unidades nuevas hoy en Marina antes de PropertyFinder")
   • Provocative question ("¿Cansado de ver el mismo listing recycled en 10 grupos?")
   • Sensory image ("La foto que el broker no quiere que veas")
   • Insider angle ("Direct from owners — los listings que llegan antes a las agencias")
   FORBIDDEN: "Follow our channel", "Join us", "Hello everyone", a lone emoji.

2. VALUE PROP (1-2 lines) — concretely WHY follow. Forbidden generics:
   ❌ "Daily new listings" alone — too vague
   ❌ "Best deals in Dubai" — empty
   ✓ "Listings nuevos cada día antes que salgan a PropertyFinder"
   ✓ "Direct from owners — sin agency fees"
   ✓ "3 viewings agendadas en lo que va de hoy"
   ✓ "Studios en Marina desde AED 4,500 — el grupo donde se postean primero"

3. PROOF / SCARCITY (1 line, optional) — why now:
   • "Hoy se publicaron 5"
   • "El grupo creció 200 personas esta semana"
   • "El último listing se rentó en 4 horas"

4. CTA (1 line) — frame as a "no te pierdas" not a "follow":
   ✓ "Únete para no perderte el de mañana"
   ✓ "Síguenos antes que el grupo se cierre"
   ✗ "Follow us" / "Join now"

CRITICAL RULES:
- DO NOT include any URL or "{LINK}" placeholder — the unique tracking
  link is appended automatically by the system after the caption.
- Total: 4-7 lines, line breaks for breathing room.
- Max 2 emojis total. No emoji on every line.
- English only — RentFlow's audience is Dubai expats.
- No hashtags, no markdown, no quotes around the output.

Output ONLY the caption text itself, no commentary.`;

    const userPrompt = `Generate a promo caption for our ${platformLabel}. Channel name: "${input.targetLabel}".${
      input.extraContext ? `\n\nExtra context: ${input.extraContext}` : ''
    }${input.differentAngle ? `\n\nREGENERATION HINT: ${input.differentAngle}\nPick a fundamentally different hook angle — different emotional register, different framing.` : ''}`;

    const provider = this.aiRef.provider;
    const modelId = process.env.AI_MODEL ?? 'claude-sonnet-4-6';

    const response = await provider.complete({
      systemBlocks: [{ text: systemPrompt }],
      userPrompt,
      maxTokens: 350,
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
          type: true,
          area: true,
          priceAed: true,
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

    // Idempotency guard — Instagram carousel publishes can take 60-90s,
    // longer than the browser's fetch timeout. If the operator sees
    // "Failed to fetch" and clicks again, we'd double-post. We claim a
    // pending placement row first; a duplicate request inside 5 minutes
    // for the same (package, channel) is rejected as a 409.
    const FIVE_MIN_MS = 5 * 60 * 1000;
    const recent = await this.prisma.postPlacement.findFirst({
      where: {
        companyId: property.companyId,
        postPackageId: postPackage.id,
        channelName: channel.name,
        automated: true,
        publishedAt: { gte: new Date(Date.now() - FIVE_MIN_MS) },
        removedAt: null,
      },
      orderBy: { publishedAt: 'desc' },
    });
    if (recent) {
      const seconds = Math.round((Date.now() - recent.publishedAt.getTime()) / 1000);
      const isPending = recent.externalPostId === 'pending';
      throw new BadRequestException(
        isPending
          ? `A publish to ${channel.name} is already in progress (started ${seconds}s ago). Refresh the page in a moment to see the result.`
          : `Already published to ${channel.name} ${seconds}s ago. Wait 5 minutes to publish again.`,
      );
    }

    const trackingSlug = this.generateSlug();
    const trackingUrl = `${MARKETPLACE_BASE}/p/${property.code}?s=${trackingSlug}`;
    const captionWithLink = this.appendTrackingLink(input.caption, trackingUrl, channel.platform);

    // Claim the row up-front with externalPostId='pending' so subsequent
    // duplicate clicks see it via the guard above.
    const placement = await this.prisma.postPlacement.create({
      data: {
        companyId: property.companyId,
        postPackageId: postPackage.id,
        publisherUserId: input.publisherUserId,
        channelName: channel.name,
        channelKind: channel.platform,
        externalPostId: 'pending',
        caption: captionWithLink,
        trackingSlug,
        automated: true,
      },
    });

    // Pick adapter by platform — actually publish.
    let result: { externalPostId: string; externalUrl: string | null };
    try {
      if (channel.platform === 'telegram') {
        const tg = await this.publishTelegram(channel, property, captionWithLink);
        result = { externalPostId: String(tg.messageId), externalUrl: tg.externalUrl };
      } else if (channel.platform === 'facebook') {
        result = await this.publishFacebookPage(channel, property, captionWithLink);
      } else if (channel.platform === 'instagram') {
        result = await this.publishInstagram(channel, property, captionWithLink, {
          companyId: property.companyId,
          postPackageId: postPackage.id,
          publisherUserId: input.publisherUserId,
          placementId: placement.id,
        });
      } else {
        throw new BadRequestException(`Platform ${channel.platform} not yet supported`);
      }
    } catch (err) {
      // Roll back the claim so the operator can retry without hitting the guard.
      await this.prisma.postPlacement.delete({ where: { id: placement.id } }).catch(() => {});
      throw err;
    }

    // Finalise the placement with the real provider ids.
    return this.prisma.postPlacement.update({
      where: { id: placement.id },
      data: {
        externalPostId: result.externalPostId,
        externalUrl: result.externalUrl,
      },
    });
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
      type?: string;
      area?: string | null;
      priceAed?: { toString(): string } | null;
      companyId: string;
      media: { file: { id: string; mimeType: string } }[];
    },
    caption: string,
    ctx: {
      companyId: string;
      postPackageId: string;
      publisherUserId: string;
      placementId: string;
    },
  ): Promise<{ externalPostId: string; externalUrl: string | null }> {
    const igUserId = channel.externalId!;
    const photos = property.media.filter((m) => m.file.mimeType.startsWith('image/'));
    if (photos.length === 0) {
      throw new Error(
        `Instagram requires at least one image for property ${property.code} — none on file`,
      );
    }

    // Build the base photo URLs in the operator's order (no auto-reorder).
    const photoUrls = photos.map((m) => `${PUBLIC_API_BASE}/public/files/${m.file.id}`);

    // Pick the carousel variant for this publish by counting prior
    // IG-channel placements for this package. Rotation = count % 4 so
    // consecutive publishes for the same property always look different.
    const priorIgCount = await this.prisma.postPlacement.count({
      where: {
        postPackageId: ctx.postPackageId,
        channelKind: 'instagram',
        externalPostId: { not: 'pending' },
      },
    });
    const variantIndex = priorIgCount % this.carouselRenderer.variantCount;

    // Single-photo IG posts don't render as a carousel — fall back to a
    // simple post but still apply the hook overlay so the photo lands.
    if (photoUrls.length === 1 && property.priceAed && property.area && property.type) {
      const hookBuffer = await this.fetchBuffer(photoUrls[0]!);
      const rendered = await this.carouselRenderer.renderAndStoreSlides({
        companyId: ctx.companyId,
        uploadedById: ctx.publisherUserId,
        postPackageId: ctx.postPackageId,
        variantIndex,
        hookPhoto: hookBuffer,
        ctaPhoto: hookBuffer, // unused on the single path but the API needs both
        overlay: {
          priceAed: Number(property.priceAed),
          type: property.type,
          area: property.area,
        },
        publicBaseUrl: PUBLIC_API_BASE,
      });
      await this.prisma.postPlacement.update({
        where: { id: ctx.placementId },
        data: { carouselVariant: rendered.variantIndex },
      });
      return this.meta.postInstagramSingle({
        igUserId,
        photoUrl: rendered.hookUrl,
        caption,
      });
    }

    // True carousel — slide 1 = rendered hook, slides 2..N-1 = originals,
    // slide N = rendered CTA. Cap at 10 (IG limit).
    if (property.priceAed && property.area && property.type) {
      const slideCount = Math.min(photoUrls.length, 10);
      const slidesUrls = photoUrls.slice(0, slideCount);
      const hookBuf = await this.fetchBuffer(slidesUrls[0]!);
      const ctaBuf = await this.fetchBuffer(slidesUrls[slideCount - 1]!);
      const rendered = await this.carouselRenderer.renderAndStoreSlides({
        companyId: ctx.companyId,
        uploadedById: ctx.publisherUserId,
        postPackageId: ctx.postPackageId,
        variantIndex,
        hookPhoto: hookBuf,
        ctaPhoto: ctaBuf,
        overlay: {
          priceAed: Number(property.priceAed),
          type: property.type,
          area: property.area,
        },
        publicBaseUrl: PUBLIC_API_BASE,
      });
      // Replace first + last URLs with rendered overlays.
      const finalUrls = [rendered.hookUrl, ...slidesUrls.slice(1, -1), rendered.ctaUrl];
      await this.prisma.postPlacement.update({
        where: { id: ctx.placementId },
        data: { carouselVariant: rendered.variantIndex },
      });
      return this.meta.postInstagramCarousel({
        igUserId,
        photoUrls: finalUrls,
        caption,
      });
    }

    // Missing price/area/type — fall back to the legacy un-overlayed
    // carousel so the publish doesn't fail just because overlay data is
    // incomplete. The caption still works.
    this.logger.warn(
      `Skipping carousel overlay for ${property.code}: missing priceAed/area/type. Publishing photos as-is.`,
    );
    return this.meta.postInstagramCarousel({ igUserId, photoUrls, caption });
  }

  /** Pull bytes for a public RentFlow file URL — used by the carousel
   *  renderer so it can composite an overlay on the source photo. */
  private async fetchBuffer(url: string): Promise<Buffer> {
    const m = url.match(/\/public\/files\/([^/?]+)$/);
    if (m && m[1]) {
      // In-process read is faster than HTTP round-trip when the file lives
      // on the same box. The renderer always runs in the same process so
      // this works in dev + Docker. Falls through to fetch on a miss.
      try {
        const found = await this.prisma.fileUpload.findFirst({
          where: { id: m[1] },
          select: { companyId: true },
        });
        if (found) {
          const { buffer } = await this.files.read(found.companyId, m[1]);
          return buffer;
        }
      } catch {
        // Fall through to fetch.
      }
    }
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
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

function buildSystemPrompt(platform: string, _language: 'en' | 'es' | 'ar'): string {
  // English ONLY across all owned channels — RentFlow's audience is
  // Dubai expats. The `language` param is kept for signature stability
  // (other callers pass channel-name inference) but ignored.
  const langLine = 'Write in clear, concise English.';

  const platformGuide = {
    telegram: `Telegram channel post — 200 to 400 characters. Telegram sends multiple photos as an album with ONE caption. Lead with the strongest hook (location + standout perk → "Despertar viendo el Burj Al Arab"). Then a 2-3 line value prop translating features into benefits, NOT specs. Then the rent (AED). Then a one-line CTA. Use 1-3 emojis sparingly for visual hierarchy. Keep paragraphs short for mobile reading.`,
    instagram: `Instagram CAROUSEL caption — 200 to 400 characters. The post will publish as a multi-photo carousel (up to 10 slides) and your caption sits below ALL of them. Job is to make the user (a) stop scrolling on slide 1, then (b) swipe to the end.

Structure:
- Line 1 = HOOK referencing the slide journey ("Desliza ➡️" / "Mira hasta la última foto" / "Slide 3 te va a sorprender"). Make them swipe.
- Line 2 = sensory image of the BEST feature ("balcón con vista al puerto, café de la mañana incluido")
- Line 3 = ONE killer detail people search for ("Marina, 1BR, AED 8,000")
- Line 4 = CTA referencing DM / swipe / link in bio
- End with 8-12 hashtags (location + property type + lifestyle: #DubaiMarina #1BRDubai #DubaiRentals etc.)`,
    facebook: `Facebook page post — 150 to 300 characters. Conversational, no hashtags. Hook line + value prop + price + soft CTA.`,
  }[platform as 'telegram' | 'instagram' | 'facebook'] ?? 'Generic property post.';

  return `You are a senior real-estate marketing copywriter for RentFlow Dubai. Generate a post for the platform below from the property data the user provides.

${langLine}

${platformGuide}

COPY FRAMEWORK (apply within the platform's length budget):
1. HOOK first — sensory image, specific number, or scarcity. Never "Available now" alone.
2. Translate features into BENEFITS — "balcón privado" → "tu café de la mañana con vista al mar". Don't list specs verbatim.
3. ONE killer fact (the rent + one location anchor).
4. CTA — clear next step.

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
    case 'standard_room': return 'standard bedroom';
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

function describeGrowthPlatform(kind: string): string {
  switch (kind) {
    case 'telegram':
      return 'Telegram channel';
    case 'facebook_page':
      return 'Facebook page';
    case 'instagram':
      return 'Instagram profile';
    case 'whatsapp_community':
      return 'WhatsApp community';
    default:
      return 'social channel';
  }
}
