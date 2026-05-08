import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@rentflow/database';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppAdapterProvider } from '../whatsapp/adapter.provider';
import { SchedulerService } from '../scheduler/scheduler.service';

// Accept the canonical `{{SCHEDULER_LINK}}` plus the variants Claude
// occasionally hallucinates (<BOOKING_LINK>, [VIEWING_LINK], etc). All point
// to the same idea — replace with the real one-time scheduler URL.
const SCHEDULER_PLACEHOLDER_RE =
  /\{\{\s*(?:SCHEDULER|BOOKING|VIEWING|APPOINTMENT|CALENDAR|SCHEDULE)_LINK\s*\}\}|<\s*(?:SCHEDULER|BOOKING|VIEWING|APPOINTMENT|CALENDAR|SCHEDULE)_LINK\s*>|\[\s*(?:SCHEDULER|BOOKING|VIEWING|APPOINTMENT|CALENDAR|SCHEDULE)_LINK\s*\]/gi;
// Catches anything that still looks like an unresolved template token after
// all known substitutions. Stripped before sending so leads never see them.
const LEFTOVER_PLACEHOLDER_RE = /\{\{[^}]+\}\}|<[A-Z][A-Z0-9_]{2,}>|\[[A-Z][A-Z0-9_]{2,}\]/g;
const SCHEDULER_INTENT_RE =
  /(?:te (?:paso|env[íi]o|enviar[ée]?)|i(?:'| wi)?ll send|i can send|let me send|here(?:'s| is)).{0,40}link.{0,40}(?:pick|choose|escojas|elegir|day|time|d[íi]a|hora|schedule|agend)/i;

@Injectable()
export class SuggestionsService {
  private readonly logger = new Logger(SuggestionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waAdapter: WhatsAppAdapterProvider,
    private readonly scheduler: SchedulerService,
  ) {}

  list(companyId: string, status?: string) {
    return this.prisma.suggestion.findMany({
      where: { companyId, ...(status ? { status: status as 'pending' } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        lead: { select: { id: true, fullName: true, phoneE164: true, status: true, temperature: true } },
        conversation: { select: { id: true, mode: true } },
      },
    });
  }

  async findById(companyId: string, id: string) {
    const s = await this.prisma.suggestion.findFirst({
      where: { id, companyId },
      include: {
        lead: { include: { property: true } },
        conversation: {
          include: { messages: { orderBy: { createdAt: 'asc' }, take: 30 } },
        },
        decidedBy: { select: { fullName: true } },
        trainingExample: true,
      },
    });
    if (!s) throw new NotFoundException('Suggestion not found');
    return s;
  }

  /** Approve verbatim: send the AI's text to the lead. */
  async approve(companyId: string, id: string, userId: string) {
    const suggestion = await this.findById(companyId, id);
    this.assertPending(suggestion.status);
    const sent = await this.sendToLead(suggestion, suggestion.suggestedReply);
    await this.advanceLeadState(suggestion.leadId, suggestion.stateAfter);
    return this.prisma.suggestion.update({
      where: { id },
      data: {
        status: 'approved',
        finalReply: suggestion.suggestedReply,
        decidedById: userId,
        decidedAt: new Date(),
        outboundMessageId: sent.messageId,
      },
    });
  }

  /** Edit + send. Captures the AI/operator pair as a TrainingExample. */
  async edit(companyId: string, id: string, userId: string, editedText: string) {
    if (!editedText || editedText.trim().length === 0) {
      throw new BadRequestException('Edited reply cannot be empty.');
    }
    const trimmed = editedText.trim();
    const suggestion = await this.findById(companyId, id);
    this.assertPending(suggestion.status);

    const sent = await this.sendToLead(suggestion, trimmed);
    await this.advanceLeadState(suggestion.leadId, suggestion.stateAfter);

    const updated = await this.prisma.$transaction(async (tx) => {
      const s = await tx.suggestion.update({
        where: { id },
        data: {
          status: 'edited',
          finalReply: trimmed,
          decidedById: userId,
          decidedAt: new Date(),
          outboundMessageId: sent.messageId,
        },
      });

      // Capture training example only if the edit actually differs.
      if (trimmed !== suggestion.suggestedReply.trim()) {
        await tx.trainingExample.create({
          data: {
            companyId,
            suggestionId: id,
            state: suggestion.state,
            contextSnapshot: this.buildContextSnapshot(suggestion) as Prisma.InputJsonValue,
            aiSuggestion: suggestion.suggestedReply,
            operatorEdit: trimmed,
            enabled: true,
          },
        });
      }
      return s;
    });

    return updated;
  }

  /** Cancel: do not send anything to the lead. */
  cancel(companyId: string, id: string, userId: string) {
    return this.transitionStatus(companyId, id, userId, 'cancelled');
  }

  countPending(companyId: string) {
    return this.prisma.suggestion.count({
      where: { companyId, status: 'pending' },
    });
  }

  /** List training examples for management UI. */
  listTrainingExamples(companyId: string) {
    return this.prisma.trainingExample.findMany({
      where: { companyId },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  toggleTrainingExample(companyId: string, id: string, enabled: boolean) {
    return this.prisma.trainingExample.updateMany({
      where: { id, companyId },
      data: { enabled },
    });
  }

  pinTrainingExample(companyId: string, id: string, pinned: boolean) {
    return this.prisma.trainingExample.updateMany({
      where: { id, companyId },
      data: { pinned },
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────────────────

  private assertPending(status: string) {
    if (status !== 'pending') {
      throw new BadRequestException(`Suggestion is already ${status}; can only act on pending suggestions.`);
    }
  }

  private async transitionStatus(
    companyId: string,
    id: string,
    userId: string,
    next: 'cancelled' | 'failed',
  ) {
    const suggestion = await this.findById(companyId, id);
    this.assertPending(suggestion.status);
    return this.prisma.suggestion.update({
      where: { id },
      data: {
        status: next,
        decidedById: userId,
        decidedAt: new Date(),
      },
    });
  }

  private async sendToLead(
    suggestion: {
      conversation: { id: string; leadPhoneE164: string; mode: string } | null;
      companyId: string;
      conversationId: string;
      leadId: string;
      lead: {
        fullName: string | null;
        preferredArea: string | null;
        property?: { code: string } | null;
      };
    },
    text: string,
  ): Promise<{ messageId: string }> {
    const conv = suggestion.conversation;
    if (!conv) throw new BadRequestException('No WhatsApp conversation linked to this suggestion.');
    if (conv.mode === 'closed') {
      throw new BadRequestException('Conversation is closed (lead opted out).');
    }

    // Resolve property code from /p/<CODE> in text (preferred) or the lead's
    // linked property as fallback. Used both for media attach and scheduler link.
    const inlineCodeMatch = text.match(/\/p\/([A-Z0-9-]+)/i);
    const propertyCode = inlineCodeMatch?.[1] ?? suggestion.lead.property?.code ?? null;

    // Substitute scheduler link placeholder with a real, single-use token URL.
    // We accept either the explicit `{{SCHEDULER_LINK}}` placeholder or the
    // legacy phrasing patterns the AI was trained with.
    text = await this.injectSchedulerLink(text, suggestion.companyId, suggestion.leadId, propertyCode);

    // Defensive: strip any remaining unresolved template-looking tokens.
    // Claude occasionally hallucinates novel placeholder shapes; we never
    // want a lead to receive literal `<X>`/`[Y]`/`{{Z}}` text.
    if (LEFTOVER_PLACEHOLDER_RE.test(text)) {
      LEFTOVER_PLACEHOLDER_RE.lastIndex = 0;
      const stripped = text.match(LEFTOVER_PLACEHOLDER_RE) ?? [];
      this.logger.warn(
        `Stripping leftover placeholders (lead=${suggestion.leadId}): ${stripped.join(', ')}`,
      );
      text = text.replace(LEFTOVER_PLACEHOLDER_RE, '').replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n').trim();
    }
    LEFTOVER_PLACEHOLDER_RE.lastIndex = 0;

    const codeMatch = inlineCodeMatch ?? (propertyCode ? text.match(/\/p\/([A-Z0-9-]+)/i) : null);
    let result = null as Awaited<ReturnType<typeof this.waAdapter.adapter.sendText>> | null;
    let messageType: 'text' | 'image' | 'video' | 'template' = 'text';

    if (codeMatch) {
      const code = codeMatch[1]!;
      const property = await this.prisma.property.findUnique({
        where: { companyId_code: { companyId: suggestion.companyId, code } },
        select: {
          media: {
            orderBy: { position: 'asc' },
            take: 10,
            select: { file: { select: { id: true, mimeType: true } } },
          },
        },
      });
      const allMedia = property?.media ?? [];
      // Prefer first image; if none, take first video; else nothing.
      const heroPhoto = allMedia.find((m) => m.file.mimeType.startsWith('image/'))?.file;
      const heroVideo = allMedia.find((m) => m.file.mimeType.startsWith('video/'))?.file;
      const hero = heroPhoto ?? heroVideo;
      const heroType: 'image' | 'video' | null = heroPhoto ? 'image' : heroVideo ? 'video' : null;

      if (hero && heroType) {
        const apiBase = process.env.PUBLIC_API_URL ?? 'https://rentflow-api.rentalho.com';
        const mediaResult = await this.waAdapter.adapter.sendMedia({
          to: conv.leadPhoneE164,
          type: heroType,
          mediaUrl: `${apiBase}/public/files/${hero.id}`,
          caption: text,
          conversationId: conv.id,
        });
        if (mediaResult.status !== 'failed') {
          result = mediaResult;
          messageType = heroType;
        } else {
          this.logger.warn(`${heroType} send failed (${mediaResult.error}); falling back to text`);
        }
      }
    }

    if (!result) {
      result = await this.waAdapter.adapter.sendText({
        to: conv.leadPhoneE164,
        body: text,
        conversationId: conv.id,
      });
      messageType = 'text';
    }

    // 24h-window template fallback removed by business policy: no spend on
    // re-engagement templates until revenue justifies it. The follow-up
    // scheduler short-circuits before creating any proactive Suggestion
    // once the lead's 24h window has passed; on rare in-window failures we
    // surface the error to the operator instead of auto-paying for a
    // template send.
    if (result.status === 'failed' && /131047|outside.*window|re.?engagement/i.test(result.error ?? '')) {
      this.logger.warn(`Outside 24h window for ${conv.leadPhoneE164}; not falling back to template.`);
    }

    const message = await this.prisma.whatsAppMessage.create({
      data: {
        companyId: suggestion.companyId,
        conversationId: conv.id,
        externalId: result.externalId || null,
        direction: 'outbound',
        type: messageType,
        body: text,
        providerStatus: result.status,
        providerError: result.error,
      },
    });
    await this.prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: { lastOutboundAt: new Date() },
    });
    if (result.status === 'failed') {
      this.logger.warn(`Outbound send returned failed: ${result.error ?? 'unknown'}`);
    }
    return { messageId: message.id };
  }

  private async advanceLeadState(leadId: string, stateAfter: string | null) {
    if (!stateAfter) return;
    // Close any open AIAgentSession and open one in stateAfter.
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, companyId: true, whatsappConversationId: true },
    });
    if (!lead) return;
    await this.prisma.aIAgentSession.updateMany({
      where: { leadId, machine: 'lead', endedAt: null },
      data: { endedAt: new Date() },
    });
    await this.prisma.aIAgentSession.create({
      data: {
        companyId: lead.companyId,
        leadId,
        conversationId: lead.whatsappConversationId,
        machine: 'lead',
        state: stateAfter,
        contextJson: { source: 'suggestion-approval', at: new Date().toISOString() },
      },
    });
  }

  private buildContextSnapshot(suggestion: {
    state: string;
    suggestedReply: string;
    confidence: number | null;
    leadId: string;
  }): Record<string, unknown> {
    return {
      state: suggestion.state,
      confidence: suggestion.confidence,
      leadId: suggestion.leadId,
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * Substitute the scheduler-link placeholder (or legacy "I'll send a link"
   * phrasings) with a real one-time booking URL. If we can't determine a
   * property to book against, we strip the placeholder and append a friendly
   * note so the lead never sees `{{SCHEDULER_LINK}}` literally.
   */
  private async injectSchedulerLink(
    text: string,
    companyId: string,
    leadId: string,
    propertyCode: string | null,
  ): Promise<string> {
    const hasPlaceholder = SCHEDULER_PLACEHOLDER_RE.test(text);
    SCHEDULER_PLACEHOLDER_RE.lastIndex = 0; // reset stateful global regex
    const hasIntent = !hasPlaceholder && SCHEDULER_INTENT_RE.test(text);
    if (!hasPlaceholder && !hasIntent) return text;

    if (!propertyCode) {
      this.logger.warn(`Scheduler placeholder/intent in suggestion but no propertyCode resolvable (lead=${leadId})`);
      return text.replace(SCHEDULER_PLACEHOLDER_RE, '').trim();
    }

    let token: { id: string };
    try {
      token = await this.scheduler.issueBookingToken(companyId, leadId, propertyCode);
    } catch (err) {
      this.logger.warn(`Failed to issue scheduler token for ${propertyCode}: ${(err as Error).message}`);
      return text.replace(SCHEDULER_PLACEHOLDER_RE, '').trim();
    }

    const base = process.env.MARKETPLACE_BASE_URL ?? 'https://rentflow-agent.vercel.app';
    const url = `${base}/p/${propertyCode}/schedule?t=${token.id}`;

    if (hasPlaceholder) {
      return text.replace(SCHEDULER_PLACEHOLDER_RE, url);
    }
    // Legacy intent: append URL on a new line so the lead actually receives it.
    return `${text.trimEnd()}\n${url}`;
  }
}
