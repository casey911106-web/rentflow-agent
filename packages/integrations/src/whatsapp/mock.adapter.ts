import { randomUUID } from 'node:crypto';
import type {
  InboundButtonReply,
  InboundMessage,
  SendInteractiveButtonsOptions,
  SendMediaOptions,
  SendResult,
  SendTemplateOptions,
  SendTextOptions,
  WhatsAppAdapter,
} from './adapter.interface';

/**
 * Mock WhatsApp adapter — used in local dev + tests.
 *
 * - send* methods return synthetic externalIds and never call Meta.
 * - verifyWebhookSignature always returns true.
 * - parseInbound supports `{ from, text, messageId }` for normal text and
 *   `{ from, buttonId, buttonTitle, messageId }` for button-reply simulation.
 */
export class MockWhatsAppAdapter implements WhatsAppAdapter {
  readonly name = 'mock';

  constructor(private readonly businessNumberE164: string) {}

  async sendText(opts: SendTextOptions): Promise<SendResult> {
    return { externalId: `wamid.MOCK_${randomUUID()}`, status: 'mock_sent', raw: opts };
  }

  async sendTemplate(opts: SendTemplateOptions): Promise<SendResult> {
    return { externalId: `wamid.MOCK_TPL_${randomUUID()}`, status: 'mock_sent', raw: opts };
  }

  async sendMedia(opts: SendMediaOptions): Promise<SendResult> {
    return { externalId: `wamid.MOCK_MEDIA_${randomUUID()}`, status: 'mock_sent', raw: opts };
  }

  async sendInteractiveButtons(opts: SendInteractiveButtonsOptions): Promise<SendResult> {
    return { externalId: `wamid.MOCK_INT_${randomUUID()}`, status: 'mock_sent', raw: opts };
  }

  verifyWebhookSignature(): boolean {
    return true;
  }

  parseInbound(payload: unknown): InboundMessage[] {
    if (!payload || typeof payload !== 'object') return [];
    const p = payload as {
      from?: string;
      text?: string;
      messageId?: string;
      buttonId?: string;
      buttonTitle?: string;
    };
    if (!p.from) return [];

    const buttonReply: InboundButtonReply | undefined = p.buttonId
      ? { id: p.buttonId, title: p.buttonTitle ?? '' }
      : undefined;

    return [
      {
        externalId: p.messageId ?? `wamid.MOCK_IN_${randomUUID()}`,
        from: p.from,
        toBusinessNumber: this.businessNumberE164,
        type: buttonReply ? 'interactive' : 'text',
        body: buttonReply ? buttonReply.title : p.text,
        buttonReply,
        receivedAt: new Date(),
        raw: payload,
      },
    ];
  }
}
