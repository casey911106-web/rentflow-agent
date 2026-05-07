import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@rentflow/database';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppAdapterProvider } from '../whatsapp/adapter.provider';

@Injectable()
export class SuggestionsService {
  private readonly logger = new Logger(SuggestionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waAdapter: WhatsAppAdapterProvider,
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
    suggestion: { conversation: { id: string; leadPhoneE164: string; mode: string } | null; companyId: string; conversationId: string; lead: { fullName: string | null; preferredArea: string | null } },
    text: string,
  ): Promise<{ messageId: string }> {
    const conv = suggestion.conversation;
    if (!conv) throw new BadRequestException('No WhatsApp conversation linked to this suggestion.');
    if (conv.mode === 'closed') {
      throw new BadRequestException('Conversation is closed (lead opted out).');
    }

    // If the suggestion mentions a specific property via /p/<code>, send the
    // property's hero photo with the text as caption — WhatsApp renders it as
    // a single rich card. Falls back to plain text if the property has no
    // media or the image send fails.
    const codeMatch = text.match(/\/p\/([A-Z0-9-]+)/i);
    let result = null as Awaited<ReturnType<typeof this.waAdapter.adapter.sendText>> | null;
    let messageType: 'text' | 'image' | 'template' = 'text';

    if (codeMatch) {
      const code = codeMatch[1]!;
      const property = await this.prisma.property.findUnique({
        where: { companyId_code: { companyId: suggestion.companyId, code } },
        select: {
          media: {
            orderBy: { position: 'asc' },
            take: 1,
            select: { file: { select: { id: true, mimeType: true } } },
          },
        },
      });
      const photo = property?.media[0]?.file;
      if (photo && photo.mimeType.startsWith('image/')) {
        const apiBase = process.env.PUBLIC_API_URL ?? 'https://rentflow-api.rentalho.com';
        const mediaResult = await this.waAdapter.adapter.sendMedia({
          to: conv.leadPhoneE164,
          type: 'image',
          mediaUrl: `${apiBase}/public/files/${photo.id}`,
          caption: text,
          conversationId: conv.id,
        });
        if (mediaResult.status !== 'failed') {
          result = mediaResult;
          messageType = 'image';
        } else {
          this.logger.warn(`Image send failed (${mediaResult.error}); falling back to text`);
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

    // If text/image fails because the 24h customer-service window expired,
    // retry with the lead_followup_24h UTILITY template. Custom AI text is
    // lost in this fallback — the template is fixed copy with name + area.
    if (result.status === 'failed' && /131047|outside.*window|re.?engagement/i.test(result.error ?? '')) {
      this.logger.warn(`24h window expired for ${conv.leadPhoneE164}; falling back to lead_followup_24h template`);
      const firstName = suggestion.lead.fullName?.split(/\s+/)[0] || 'there';
      const area = suggestion.lead.preferredArea || 'Dubai';
      result = await this.waAdapter.adapter.sendTemplate({
        to: conv.leadPhoneE164,
        template: { name: 'lead_followup_24h', languageCode: 'en' },
        variables: { '1': firstName, '2': area },
        conversationId: conv.id,
      });
      messageType = 'template';
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
}
