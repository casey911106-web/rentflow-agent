import { createHmac, timingSafeEqual } from 'node:crypto';
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

export interface CloudApiConfig {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  apiBase?: string; // default https://graph.facebook.com/v20.0
  businessNumberE164: string;
}

const DEFAULT_API_BASE = 'https://graph.facebook.com/v20.0';

/**
 * Real Meta WhatsApp Business Cloud API adapter.
 *
 * - Implements text, template, media, and interactive button sends.
 * - Verifies inbound webhook signatures via X-Hub-Signature-256.
 * - Parses inbound text + interactive button_reply messages.
 *
 * Note: outside the 24h customer service window, only approved templates can
 * be sent. We surface a clear error so the caller can fall back appropriately.
 */
export class CloudApiWhatsAppAdapter implements WhatsAppAdapter {
  readonly name = 'cloud_api';
  private readonly apiBase: string;

  constructor(private readonly cfg: CloudApiConfig) {
    this.apiBase = cfg.apiBase ?? DEFAULT_API_BASE;
  }

  async sendText(opts: SendTextOptions): Promise<SendResult> {
    return this.postMessage({
      messaging_product: 'whatsapp',
      to: this.normalizeTo(opts.to),
      type: 'text',
      text: { body: opts.body },
    });
  }

  async sendTemplate(opts: SendTemplateOptions): Promise<SendResult> {
    const components = Object.entries(opts.variables).length
      ? [
          {
            type: 'body',
            parameters: Object.values(opts.variables).map((v) => ({ type: 'text', text: String(v) })),
          },
        ]
      : undefined;
    return this.postMessage({
      messaging_product: 'whatsapp',
      to: this.normalizeTo(opts.to),
      type: 'template',
      template: {
        name: opts.template.name,
        language: { code: opts.template.languageCode },
        ...(components ? { components } : {}),
      },
    });
  }

  async sendMedia(opts: SendMediaOptions): Promise<SendResult> {
    return this.postMessage({
      messaging_product: 'whatsapp',
      to: this.normalizeTo(opts.to),
      type: opts.type,
      [opts.type]: { link: opts.mediaUrl, caption: opts.caption },
    });
  }

  async sendInteractiveButtons(opts: SendInteractiveButtonsOptions): Promise<SendResult> {
    if (opts.buttons.length === 0 || opts.buttons.length > 3) {
      return {
        externalId: '',
        status: 'failed',
        error: 'Interactive button messages require 1-3 buttons.',
      };
    }
    const interactive: Record<string, unknown> = {
      type: 'button',
      body: { text: opts.body },
      action: {
        buttons: opts.buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    };
    if (opts.header) interactive['header'] = { type: 'text', text: opts.header.slice(0, 60) };
    if (opts.footer) interactive['footer'] = { text: opts.footer.slice(0, 60) };

    return this.postMessage({
      messaging_product: 'whatsapp',
      to: this.normalizeTo(opts.to),
      type: 'interactive',
      interactive,
    });
  }

  verifyWebhookSignature(headers: Record<string, string>, rawBody: Buffer): boolean {
    const headerSig = headers['x-hub-signature-256'] ?? headers['X-Hub-Signature-256'];
    if (!headerSig) return false;
    const expected = `sha256=${createHmac('sha256', this.cfg.appSecret).update(rawBody).digest('hex')}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(headerSig);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Parses Cloud API webhook payloads into our normalized InboundMessage shape.
   * Handles: text, image, video, document, template, interactive button_reply.
   */
  parseInbound(payload: unknown): InboundMessage[] {
    const out: InboundMessage[] = [];
    const entries = (payload as { entry?: unknown[] })?.entry ?? [];
    for (const entry of entries) {
      const changes = (entry as { changes?: unknown[] })?.changes ?? [];
      for (const change of changes) {
        const value = (change as { value?: { messages?: unknown[]; metadata?: { display_phone_number?: string } } })?.value;
        const messages = value?.messages ?? [];
        for (const msg of messages) {
          out.push(this.normalizeMessage(msg));
        }
      }
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────────────────

  private normalizeMessage(raw: unknown): InboundMessage {
    const m = raw as {
      id: string;
      from: string;
      type: string;
      text?: { body?: string };
      image?: { link?: string };
      video?: { link?: string };
      document?: { link?: string };
      timestamp?: string;
      interactive?: {
        type?: string;
        button_reply?: { id?: string; title?: string };
        list_reply?: { id?: string; title?: string };
      };
    };
    const e164From = m.from.startsWith('+') ? m.from : `+${m.from}`;
    const validType = (['text', 'image', 'video', 'document', 'template', 'interactive'] as const)
      .includes(m.type as never)
      ? (m.type as 'text' | 'image' | 'video' | 'document' | 'template' | 'interactive')
      : 'text';

    let buttonReply: InboundButtonReply | undefined;
    let body: string | undefined = m.text?.body;
    if (m.interactive) {
      if (m.interactive.button_reply) {
        buttonReply = {
          id: m.interactive.button_reply.id ?? '',
          title: m.interactive.button_reply.title ?? '',
        };
        body = m.interactive.button_reply.title;
      } else if (m.interactive.list_reply) {
        buttonReply = {
          id: m.interactive.list_reply.id ?? '',
          title: m.interactive.list_reply.title ?? '',
        };
        body = m.interactive.list_reply.title;
      }
    }

    return {
      externalId: m.id,
      from: e164From,
      toBusinessNumber: this.cfg.businessNumberE164,
      type: validType,
      body,
      mediaUrl: m.image?.link ?? m.video?.link ?? m.document?.link,
      buttonReply,
      receivedAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
      raw,
    };
  }

  private normalizeTo(to: string): string {
    return to.startsWith('+') ? to.slice(1) : to;
  }

  private async postMessage(body: Record<string, unknown>): Promise<SendResult> {
    const url = `${this.apiBase}/${this.cfg.phoneNumberId}/messages`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return { externalId: '', status: 'failed', error: (err as Error).message };
    }

    let data: unknown = null;
    try {
      data = await resp.json();
    } catch {
      data = null;
    }

    if (!resp.ok) {
      const errorMessage = this.extractErrorMessage(data, resp.status);
      return { externalId: '', status: 'failed', error: errorMessage, raw: data };
    }

    const parsed = data as {
      messages?: Array<{ id?: string }>;
    };
    const id = parsed.messages?.[0]?.id ?? '';
    return { externalId: id, status: 'sent', raw: data };
  }

  private extractErrorMessage(data: unknown, status: number): string {
    if (data && typeof data === 'object') {
      const err = (data as { error?: { message?: string; code?: number } }).error;
      if (err?.message) {
        return `${err.message}${err.code ? ` (#${err.code})` : ''}`;
      }
    }
    return `HTTP ${status}`;
  }
}
