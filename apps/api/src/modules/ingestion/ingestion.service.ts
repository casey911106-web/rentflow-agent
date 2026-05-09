import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviderRef } from '../ai-agent/ai-provider.ref';
import { FilesService } from '../files/files.service';
import { WhatsAppAdapterProvider } from '../whatsapp/adapter.provider';
import { MediaDownloader, extractMediaIdFromRaw } from './media-downloader';

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 min from start
const SLUG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PROPERTY_CODE_PREFIX = 'RF';

interface BufferedMessage {
  body: string | null;
  mediaId: string | null;
  mediaMimeType: string | null;
  receivedAt: Date;
}

interface IngestionSession {
  partnerUserId: string;
  conversationId: string;
  startedAt: Date;
  buffer: BufferedMessage[];
  /** Pre-downloaded FileUploads awaiting attachment to the new Property. */
  pendingFileIds: { fileUploadId: string; kind: 'image' | 'video' }[];
  timeoutHandle?: NodeJS.Timeout;
}

interface ParsedSubmission {
  priceAed?: number;
  depositAed?: number;
  area?: string;
  type?: string;
  occupancyMax?: number;
  description?: string;
  amenities?: string[];
  agentName?: string;
  moveInDate?: string;
  rentalMinMonths?: number;
}

/**
 * Handles inbound WhatsApp messages from partner agents who source
 * properties from external groups. The sender must be a User with
 * `isPartner = true` and start the submission with `/property`. They
 * close it with `/done` or wait out the 5-min timeout.
 *
 * In-memory session map keyed by `<companyId>:<conversationId>` — we
 * never have two ingestion sessions per partner conversation at once,
 * so this is safe single-instance. If we ever go multi-instance the
 * session state moves to Redis or a Session table.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly sessions = new Map<string, IngestionSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiRef: AiProviderRef,
    private readonly files: FilesService,
    private readonly mediaDl: MediaDownloader,
    private readonly waAdapter: WhatsAppAdapterProvider,
  ) {}

  /** Returns true if the inbound was handled (route should NOT continue). */
  async tryHandle(args: {
    companyId: string;
    conversationId: string;
    partnerUserId: string;
    partnerPhoneE164: string;
    inbound: {
      type: string;
      body: string | null;
      raw: unknown;
      receivedAt: Date;
    };
  }): Promise<boolean> {
    const key = this.sessionKey(args.companyId, args.conversationId);
    const text = (args.inbound.body ?? '').trim();
    const isStart = /^\/property\b/i.test(text);
    const isDone = /^\/done\b/i.test(text);
    const session = this.sessions.get(key);

    if (isStart) {
      // Start (or restart) a session.
      if (session?.timeoutHandle) clearTimeout(session.timeoutHandle);
      const fresh: IngestionSession = {
        partnerUserId: args.partnerUserId,
        conversationId: args.conversationId,
        startedAt: new Date(),
        buffer: [],
        pendingFileIds: [],
      };
      // Capture the rest of the start message body (everything after /property)
      const trailing = text.replace(/^\/property\b/i, '').trim();
      if (trailing) {
        fresh.buffer.push({
          body: trailing,
          mediaId: null,
          mediaMimeType: null,
          receivedAt: args.inbound.receivedAt,
        });
      }
      // Even on the start message, capture media if attached.
      await this.captureMediaIfAny(args.inbound, args.companyId, args.partnerUserId, fresh);
      fresh.timeoutHandle = setTimeout(() => {
        this.finalize(args.companyId, args.conversationId, args.partnerPhoneE164, 'timeout').catch(
          (err) => this.logger.warn(`Finalize on timeout failed: ${(err as Error).message}`),
        );
      }, SESSION_TIMEOUT_MS);
      this.sessions.set(key, fresh);
      await this.reply(
        args.companyId,
        args.partnerPhoneE164,
        '📥 Te escucho — manda fotos, descripción y precio. Di `/done` cuando termines o esperaré 5 min.',
        args.conversationId,
      );
      return true;
    }

    if (!session) return false; // not in ingestion mode for this conversation

    if (isDone) {
      await this.finalize(args.companyId, args.conversationId, args.partnerPhoneE164, 'done');
      return true;
    }

    // Append to buffer and capture any media.
    session.buffer.push({
      body: text || null,
      mediaId: extractMediaIdFromRaw(args.inbound.raw),
      mediaMimeType: null,
      receivedAt: args.inbound.receivedAt,
    });
    await this.captureMediaIfAny(args.inbound, args.companyId, args.partnerUserId, session);
    return true;
  }

  // ------------------------------------------------------------------------
  // privates
  // ------------------------------------------------------------------------

  private sessionKey(companyId: string, conversationId: string) {
    return `${companyId}:${conversationId}`;
  }

  private async captureMediaIfAny(
    inbound: { type: string; raw: unknown },
    companyId: string,
    uploaderId: string,
    session: IngestionSession,
  ) {
    if (inbound.type !== 'image' && inbound.type !== 'video' && inbound.type !== 'document') {
      return;
    }
    const mediaId = extractMediaIdFromRaw(inbound.raw);
    if (!mediaId) return;
    const dl = await this.mediaDl.download(mediaId);
    if (!dl) {
      this.logger.warn(`Could not download media ${mediaId} — link may have expired`);
      return;
    }
    try {
      const file = await this.files.save({
        companyId,
        uploadedById: uploaderId,
        mimeType: dl.mimeType,
        buffer: dl.buffer,
        ownerEntityType: 'property_pending',
        ownerEntityId: session.conversationId, // will reattach to property at finalize
        originalName: `partner-${mediaId}`,
      });
      session.pendingFileIds.push({
        fileUploadId: file.id,
        kind: dl.mimeType.startsWith('video/') ? 'video' : 'image',
      });
    } catch (err) {
      this.logger.warn(`File save failed during ingestion: ${(err as Error).message}`);
    }
  }

  private async finalize(
    companyId: string,
    conversationId: string,
    partnerPhoneE164: string,
    reason: 'done' | 'timeout',
  ): Promise<void> {
    const key = this.sessionKey(companyId, conversationId);
    const session = this.sessions.get(key);
    if (!session) return;
    if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
    this.sessions.delete(key);

    const allText = session.buffer
      .map((m) => m.body ?? '')
      .filter(Boolean)
      .join('\n')
      .trim();

    if (!allText && session.pendingFileIds.length === 0) {
      await this.reply(
        companyId,
        partnerPhoneE164,
        `⚠️ No recibí ni texto ni fotos${reason === 'timeout' ? ' antes del timeout' : ''}. Manda /property otra vez para reintentar.`,
        conversationId,
      );
      return;
    }

    let parsed: ParsedSubmission = {};
    if (allText) {
      try {
        parsed = await this.parseWithAi(allText);
      } catch (err) {
        this.logger.warn(`AI parse failed: ${(err as Error).message}`);
      }
    }

    if (!parsed.priceAed || !parsed.area) {
      const missing: string[] = [];
      if (!parsed.priceAed) missing.push('renta mensual (AED)');
      if (!parsed.area) missing.push('zona (Marina, JBR, etc.)');
      // Persist a stub session so the partner can reply with the missing data
      // and we'll come back. For MVP, just ask and drop the buffer — the
      // partner re-sends `/property` with the full info.
      await this.reply(
        companyId,
        partnerPhoneE164,
        `⚠️ Falta info: ${missing.join(', ')}. Manda /property otra vez con esos datos.`,
        conversationId,
      );
      return;
    }

    // Resolve assigned field agent by fuzzy name match.
    let assignedFieldAgentId: string | null = null;
    if (parsed.agentName) {
      const candidates = await this.prisma.user.findMany({
        where: {
          companyId,
          deletedAt: null,
          status: 'active',
          roles: { hasSome: ['field_agent', 'ops_manager', 'super_admin'] },
        },
        select: { id: true, fullName: true },
      });
      const target = parsed.agentName.toLowerCase();
      const match = candidates.find((c) => c.fullName?.toLowerCase().includes(target));
      if (match) assignedFieldAgentId = match.id;
    }

    // Allocate a unique property code.
    const code = await this.uniquePropertyCode(companyId);

    // Create the property in not_ready_to_post.
    const property = await this.prisma.property.create({
      data: {
        companyId,
        code,
        name: this.fallbackName(parsed),
        type: this.normalizeType(parsed.type),
        status: 'not_ready_to_post',
        area: parsed.area,
        priceAed: parsed.priceAed,
        depositAed: parsed.depositAed ?? null,
        description: parsed.description ?? null,
        occupancyMax: parsed.occupancyMax ?? null,
        rentalMinMonths: parsed.rentalMinMonths ?? null,
        amenities: parsed.amenities ? (parsed.amenities as unknown as object) : undefined,
        moveInDate: parsed.moveInDate ? new Date(parsed.moveInDate) : null,
        submittedByUserId: session.partnerUserId,
        assignedFieldAgentId,
      },
    });

    // Re-link any media we already saved to this property.
    for (let i = 0; i < session.pendingFileIds.length; i++) {
      const m = session.pendingFileIds[i]!;
      try {
        // Re-stamp the FileUpload owner so files-by-property views can find it.
        await this.prisma.fileUpload.update({
          where: { id: m.fileUploadId },
          data: { ownerEntityType: 'property', ownerEntityId: property.id },
        });
        await this.prisma.propertyMedia.create({
          data: {
            propertyId: property.id,
            fileUploadId: m.fileUploadId,
            position: i,
            kind: m.kind === 'video' ? 'video' : 'photo',
          },
        });
      } catch (err) {
        this.logger.warn(`Failed to attach file ${m.fileUploadId} to property ${property.id}: ${(err as Error).message}`);
      }
    }

    const baseWeb = process.env.MARKETPLACE_BASE_URL ?? 'https://rentflow-agent.vercel.app';
    const lines: string[] = [
      `✓ Property ${property.code} creada (not_ready_to_post)`,
      `Renta: AED ${Number(parsed.priceAed).toLocaleString()} / mes`,
      `Zona: ${parsed.area}`,
    ];
    if (parsed.type) lines.push(`Tipo: ${this.humanType(parsed.type)}`);
    if (parsed.occupancyMax) lines.push(`Sleeps: ${parsed.occupancyMax}`);
    if (assignedFieldAgentId) {
      const agent = await this.prisma.user.findUnique({
        where: { id: assignedFieldAgentId },
        select: { fullName: true },
      });
      if (agent) lines.push(`Agente: ${agent.fullName}`);
    } else if (parsed.agentName) {
      lines.push(`⚠️ Agente "${parsed.agentName}" no encontrado — asígnalo manualmente`);
    }
    lines.push(`Fotos/videos: ${session.pendingFileIds.length}`);
    lines.push('');
    lines.push(`Revisar: ${baseWeb}/properties/${property.id}`);

    await this.reply(companyId, partnerPhoneE164, lines.join('\n'), conversationId);
  }

  private async parseWithAi(text: string): Promise<ParsedSubmission> {
    const provider = this.aiRef.provider;
    const modelId = process.env.AI_MODEL ?? 'claude-sonnet-4-6';
    const systemPrompt = `You extract structured rental property data from informal Spanish/English WhatsApp text messages forwarded from real-estate WhatsApp groups in Dubai.

Return ONLY a JSON object matching this shape (use null for missing values):
{
  "priceAed": number | null,
  "depositAed": number | null,
  "area": string | null,        // Dubai neighbourhood: "Dubai Marina", "JBR", "Downtown", "JVC", "Palm Jumeirah", "Business Bay", etc.
  "type": "studio" | "one_bedroom" | "two_bedroom" | "three_bedroom" | "villa" | "master_room" | "shared_room" | "partition" | "bed_space" | null,
  "occupancyMax": number | null,
  "description": string | null,
  "amenities": string[] | null,
  "agentName": string | null,    // if input contains "Agente: X" or "Agent X"
  "moveInDate": string | null,    // ISO date like "2026-06-01" if mentioned
  "rentalMinMonths": number | null
}

Rules:
- Numbers come from explicit mentions only — do NOT infer.
- "9.5k" or "9,500 AED" → 9500. "9k" or "9000 AED" → 9000.
- "2BR", "2 hab", "two-bedroom" → "two_bedroom". "1BR", "1 hab" → "one_bedroom".
- "studio" remains "studio". "Villa" → "villa".
- "sleeps 6", "para 6 personas", "6 people" → occupancyMax: 6.
- Description: a short clean sentence (≤ 200 chars), no "AED" or numbers in it.
- Amenities: short array like ["sea view","pool","parking"]. Empty/null if none mentioned.
- agentName: extract "Agent: Juan", "Agente Juan Mensah", etc. Just the human name.

Output the JSON only, no preface.`;
    const response = await provider.complete({
      systemBlocks: [{ text: systemPrompt }],
      userPrompt: text,
      maxTokens: 500,
      model: modelId,
    });
    const out = response.parsedJson ?? this.tryJsonParse(response.text);
    return (out as ParsedSubmission) ?? {};
  }

  private tryJsonParse(text: string): ParsedSubmission | null {
    if (!text) return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as ParsedSubmission;
    } catch {
      return null;
    }
  }

  private fallbackName(parsed: ParsedSubmission): string {
    if (parsed.description && parsed.description.length > 0 && parsed.description.length <= 80) {
      return parsed.description;
    }
    const beds = this.humanType(parsed.type ?? 'one_bedroom');
    const where = parsed.area ?? 'Dubai';
    return `${beds} in ${where}`;
  }

  private normalizeType(t: string | undefined):
    | 'studio'
    | 'one_bedroom'
    | 'two_bedroom'
    | 'three_bedroom'
    | 'villa'
    | 'master_room'
    | 'shared_room'
    | 'partition'
    | 'bed_space'
    | 'other' {
    const allowed = [
      'studio',
      'one_bedroom',
      'two_bedroom',
      'three_bedroom',
      'villa',
      'master_room',
      'shared_room',
      'partition',
      'bed_space',
      'other',
    ] as const;
    return (allowed as readonly string[]).includes(t ?? '')
      ? (t as 'studio')
      : 'other';
  }

  private humanType(t: string): string {
    const map: Record<string, string> = {
      studio: 'Studio',
      one_bedroom: '1BR',
      two_bedroom: '2BR',
      three_bedroom: '3BR',
      villa: 'Villa',
      master_room: 'Master room',
      shared_room: 'Shared room',
      partition: 'Partition',
      bed_space: 'Bed space',
      other: 'Property',
    };
    return map[t] ?? t;
  }

  private async uniquePropertyCode(companyId: string): Promise<string> {
    for (let i = 0; i < 10; i++) {
      let s = '';
      for (let k = 0; k < 5; k++) s += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
      const code = `${PROPERTY_CODE_PREFIX}-${s}`;
      const exists = await this.prisma.property.findFirst({
        where: { companyId, code },
        select: { id: true },
      });
      if (!exists) return code;
    }
    throw new Error('Failed to allocate unique property code after 10 tries');
  }

  private async reply(
    companyId: string,
    toPhoneE164: string,
    body: string,
    conversationId: string,
  ): Promise<void> {
    try {
      await this.waAdapter.adapter.sendText({
        to: toPhoneE164,
        body,
        conversationId,
      });
      await this.prisma.whatsAppMessage.create({
        data: {
          companyId,
          conversationId,
          direction: 'outbound',
          type: 'text',
          body,
          providerStatus: 'sent',
        },
      }).catch((err) => {
        this.logger.warn(
          `Persisting ingestion reply for conv=${conversationId} failed: ${(err as Error).message}`,
        );
      });
    } catch (err) {
      this.logger.warn(`Reply to partner ${toPhoneE164} failed: ${(err as Error).message}`);
    }
  }
}
