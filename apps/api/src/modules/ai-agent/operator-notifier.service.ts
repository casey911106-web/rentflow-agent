import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppAdapterProvider } from '../whatsapp/adapter.provider';

/**
 * Pushes new pending suggestions to the operator's personal WhatsApp number
 * with Approve / Edit / Cancel reply buttons.
 *
 * The operator must have opened a 24h customer-service window with the
 * business number first (by sending any inbound message to it). Outside that
 * window, the send fails — fine, the dashboard inbox is still authoritative.
 */
@Injectable()
export class OperatorNotifierService {
  private readonly logger = new Logger(OperatorNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waAdapter: WhatsAppAdapterProvider,
  ) {}

  /** Send the suggestion to the operator phone if one is configured. */
  async notifyNewSuggestion(suggestionId: string): Promise<void> {
    const operator = process.env.OPERATOR_WHATSAPP_E164;
    if (!operator) {
      this.logger.debug('OPERATOR_WHATSAPP_E164 not set — skipping operator notification.');
      return;
    }

    const suggestion = await this.prisma.suggestion.findUnique({
      where: { id: suggestionId },
      include: {
        lead: { include: { property: true } },
        conversation: true,
      },
    });
    if (!suggestion || !suggestion.conversation) return;
    if (suggestion.status !== 'pending') return;

    const body = this.formatBody(suggestion);
    const result = await this.waAdapter.adapter.sendInteractiveButtons({
      to: operator,
      header: '🤖 RentFlow suggestion',
      body,
      footer: this.formatFooter(suggestion),
      buttons: [
        { id: `approve:${suggestion.id}`, title: '✓ Aprobar' },
        { id: `edit:${suggestion.id}`,    title: '✎ Editar'  },
        { id: `cancel:${suggestion.id}`,  title: '✗ Cancelar' },
      ],
      conversationId: suggestion.conversation.id,
    });

    if (result.status === 'failed') {
      this.logger.warn(
        `Operator notification failed for suggestion=${suggestion.id}: ${result.error ?? 'unknown'}`,
      );
    } else {
      this.logger.log(`Operator notified for suggestion=${suggestion.id} (${result.externalId})`);
    }
  }

  private formatBody(s: {
    lead: { fullName: string | null; phoneE164: string; property: { code: string; name: string } | null };
    state: string;
    suggestedReply: string;
    confidence: number | null;
    escalate: boolean;
  }): string {
    const lines: string[] = [];
    const leadLabel = s.lead.fullName ?? s.lead.phoneE164;
    lines.push(`*${leadLabel}*${s.lead.property ? ` · ${s.lead.property.code}` : ''}`);
    lines.push(`State: ${s.state.replace(/_/g, ' ')}`);
    if (s.escalate) lines.push('⚠️ AI flagged this for escalation');
    lines.push('');
    lines.push('Suggested reply:');
    lines.push(`"${this.truncate(s.suggestedReply, 700)}"`);
    return lines.join('\n');
  }

  private formatFooter(s: { confidence: number | null }): string {
    if (s.confidence === null || s.confidence === undefined) return 'Tap to decide';
    return `Confidence ${Math.round(s.confidence * 100)}% · tap to decide`;
  }

  private truncate(text: string, maxLen: number): string {
    return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
  }
}
