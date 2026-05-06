import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppAdapterProvider } from './adapter.provider';
import { SuggestionsService } from '../ai-agent/suggestions.service';

const PENDING_EDIT_KEY = (operatorE164: string) => `operator.pending_edit:${operatorE164}`;
const PENDING_EDIT_TTL_MS = 5 * 60 * 1000;

interface PendingEditValue {
  suggestionId: string;
  operatorE164: string;
  expiresAt: string;
}

/**
 * Handles inbound messages FROM the operator's personal phone.
 *
 * - Interactive button replies (approve / edit / cancel) trigger the
 *   corresponding SuggestionsService action.
 * - When operator taps Edit, we reply asking for the corrected text and
 *   stash a 5-min "pending edit" marker keyed by their phone.
 * - The operator's next free-text message within the TTL is treated as the
 *   edited reply for the pinned suggestion.
 *
 * State is stored in `AppSetting` with a per-operator key so we don't need
 * a new table or external store.
 */
@Injectable()
export class OperatorInboundHandler {
  private readonly logger = new Logger(OperatorInboundHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waAdapter: WhatsAppAdapterProvider,
    private readonly suggestions: SuggestionsService,
  ) {}

  /**
   * Process one inbound message from the operator.
   * Returns `true` when handled, `false` when the message should fall through
   * to the lead workflow (e.g. operator was acting as a regular lead).
   */
  async handle(input: {
    companyId: string;
    operatorE164: string;
    inboundMessageId: string;
    buttonId?: string;
    text?: string;
  }): Promise<boolean> {
    if (input.buttonId) {
      return this.handleButton(input.companyId, input.operatorE164, input.buttonId);
    }
    if (input.text) {
      return this.handleText(input.companyId, input.operatorE164, input.text);
    }
    return false;
  }

  private async handleButton(companyId: string, operatorE164: string, buttonId: string): Promise<boolean> {
    const [action, suggestionId] = buttonId.split(':');
    if (!action || !suggestionId) {
      this.logger.warn(`Unrecognized button payload: ${buttonId}`);
      return false;
    }
    const operatorUserId = await this.resolveOperatorUserId(companyId, operatorE164);

    try {
      switch (action) {
        case 'approve':
          await this.suggestions.approve(companyId, suggestionId, operatorUserId);
          await this.reply(operatorE164, '✓ Approved & sent.');
          await this.clearPendingEdit(companyId, operatorE164);
          return true;
        case 'cancel':
          await this.suggestions.cancel(companyId, suggestionId, operatorUserId);
          await this.reply(operatorE164, '✗ Cancelled. Nothing was sent to the lead.');
          await this.clearPendingEdit(companyId, operatorE164);
          return true;
        case 'edit':
          await this.setPendingEdit(companyId, operatorE164, suggestionId);
          await this.reply(
            operatorE164,
            'Send me the corrected reply as your next message. It will be delivered to the lead and recorded as a training example. (5 min window — reply CANCEL to abort.)',
          );
          return true;
        default:
          this.logger.warn(`Unknown action in button payload: ${buttonId}`);
          return false;
      }
    } catch (err) {
      this.logger.error(
        `Operator action ${action} failed for suggestion=${suggestionId}: ${(err as Error).message}`,
      );
      await this.reply(operatorE164, `⚠️ ${(err as Error).message}`);
      return true;
    }
  }

  private async handleText(companyId: string, operatorE164: string, text: string): Promise<boolean> {
    const trimmed = text.trim();
    const pending = await this.getPendingEdit(companyId, operatorE164);
    if (!pending) {
      return false;
    }

    if (Date.parse(pending.expiresAt) < Date.now()) {
      await this.clearPendingEdit(companyId, operatorE164);
      await this.reply(operatorE164, 'Edit window expired (5 min). Tap Edit again on the suggestion.');
      return true;
    }

    if (/^cancel$/i.test(trimmed)) {
      await this.clearPendingEdit(companyId, operatorE164);
      await this.reply(operatorE164, 'Edit cancelled. The suggestion is still pending — tap any button.');
      return true;
    }

    const operatorUserId = await this.resolveOperatorUserId(companyId, operatorE164);
    try {
      await this.suggestions.edit(companyId, pending.suggestionId, operatorUserId, trimmed);
      await this.clearPendingEdit(companyId, operatorE164);
      await this.reply(operatorE164, '✓ Edited & sent. Thanks — saved as a training example.');
    } catch (err) {
      await this.reply(operatorE164, `⚠️ ${(err as Error).message}`);
    }
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────────────────

  private async reply(to: string, body: string): Promise<void> {
    try {
      await this.waAdapter.adapter.sendText({
        to,
        body,
        // We use a synthetic conversationId for operator-side bot messages —
        // they don't need to be tracked in lead WhatsAppConversation rows.
        conversationId: 'operator',
      });
    } catch (err) {
      this.logger.warn(`Failed to reply to operator: ${(err as Error).message}`);
    }
  }

  private async setPendingEdit(companyId: string, operatorE164: string, suggestionId: string): Promise<void> {
    const value: PendingEditValue = {
      suggestionId,
      operatorE164,
      expiresAt: new Date(Date.now() + PENDING_EDIT_TTL_MS).toISOString(),
    };
    await this.prisma.appSetting.upsert({
      where: { companyId_key: { companyId, key: PENDING_EDIT_KEY(operatorE164) } },
      create: { companyId, key: PENDING_EDIT_KEY(operatorE164), value: value as unknown as object },
      update: { value: value as unknown as object },
    });
  }

  private async getPendingEdit(companyId: string, operatorE164: string): Promise<PendingEditValue | null> {
    const row = await this.prisma.appSetting.findFirst({
      where: { companyId, key: PENDING_EDIT_KEY(operatorE164) },
    });
    if (!row) return null;
    const v = row.value as unknown as PendingEditValue;
    if (!v?.suggestionId || !v?.expiresAt) return null;
    return v;
  }

  private async clearPendingEdit(companyId: string, operatorE164: string): Promise<void> {
    await this.prisma.appSetting.deleteMany({
      where: { companyId, key: PENDING_EDIT_KEY(operatorE164) },
    });
  }

  private async resolveOperatorUserId(companyId: string, operatorE164: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { companyId, phoneE164: operatorE164, deletedAt: null },
    });
    if (user) return user.id;
    // Fallback: any super_admin in the tenant.
    const admin = await this.prisma.user.findFirst({
      where: { companyId, roles: { has: 'super_admin' }, deletedAt: null },
    });
    if (admin) return admin.id;
    throw new Error('No operator user found to attribute the action to.');
  }
}
