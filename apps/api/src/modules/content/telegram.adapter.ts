import { Injectable, Logger } from '@nestjs/common';

const TG_API_BASE = 'https://api.telegram.org';

export interface TelegramSendResult {
  messageId: number;
  externalUrl: string | null;
}

export interface TelegramMediaItem {
  /** Public HTTPS URL Telegram fetches from. */
  url: string;
  /** image | video — defaults to image. */
  type?: 'photo' | 'video';
}

/**
 * Thin wrapper over the Telegram Bot HTTP API. We use fetch directly instead
 * of an SDK — the surface we need is small (sendMessage, sendPhoto,
 * sendMediaGroup) and pulling in another library for three endpoints isn't
 * worth it.
 *
 * Auth via TELEGRAM_BOT_TOKEN env. Tokens are channel-agnostic; the same bot
 * can post to every channel where it has been added as admin.
 *
 * Responses include `message_id` which we combine with the channel username
 * to produce a public post URL: https://t.me/<username>/<message_id>.
 */
@Injectable()
export class TelegramAdapter {
  private readonly logger = new Logger(TelegramAdapter.name);
  private readonly token = process.env.TELEGRAM_BOT_TOKEN ?? '';

  isConfigured(): boolean {
    return this.token.length > 0;
  }

  /** Plain-text or HTML message. Returns provider message_id + canonical URL. */
  async sendMessage(args: {
    chatId: string | number;
    text: string;
    /** Channel public username without `@` — used to build the externalUrl. */
    channelUsername?: string | null;
    parseMode?: 'HTML' | 'MarkdownV2';
    disableWebPagePreview?: boolean;
    disableNotification?: boolean;
  }): Promise<TelegramSendResult> {
    const body: Record<string, unknown> = {
      chat_id: args.chatId,
      text: args.text,
      disable_notification: args.disableNotification ?? false,
    };
    if (args.parseMode) body.parse_mode = args.parseMode;
    if (args.disableWebPagePreview != null) body.disable_web_page_preview = args.disableWebPagePreview;

    const data = await this.call('sendMessage', body);
    const messageId = Number(data.message_id);
    return {
      messageId,
      externalUrl: this.buildPostUrl(args.channelUsername, messageId),
    };
  }

  /** Single photo with optional caption. URL must be publicly reachable by Telegram. */
  async sendPhoto(args: {
    chatId: string | number;
    photoUrl: string;
    caption?: string;
    channelUsername?: string | null;
    parseMode?: 'HTML' | 'MarkdownV2';
    disableNotification?: boolean;
  }): Promise<TelegramSendResult> {
    const body: Record<string, unknown> = {
      chat_id: args.chatId,
      photo: args.photoUrl,
      disable_notification: args.disableNotification ?? false,
    };
    if (args.caption) body.caption = args.caption;
    if (args.parseMode) body.parse_mode = args.parseMode;

    const data = await this.call('sendPhoto', body);
    const messageId = Number(data.message_id);
    return {
      messageId,
      externalUrl: this.buildPostUrl(args.channelUsername, messageId),
    };
  }

  /**
   * Album of 2-10 media items. Caption goes on the first item; subsequent
   * items show without a caption. Telegram returns one Message per item;
   * we treat the first message_id as the canonical post identifier.
   */
  async sendMediaGroup(args: {
    chatId: string | number;
    media: TelegramMediaItem[];
    caption?: string;
    channelUsername?: string | null;
    parseMode?: 'HTML' | 'MarkdownV2';
    disableNotification?: boolean;
  }): Promise<TelegramSendResult> {
    const trimmed = args.media.slice(0, 10);
    if (trimmed.length < 2) {
      throw new Error(`sendMediaGroup requires 2..10 items, got ${trimmed.length}`);
    }
    const media = trimmed.map((m, i) => {
      const item: Record<string, unknown> = {
        type: m.type ?? 'photo',
        media: m.url,
      };
      if (i === 0 && args.caption) {
        item.caption = args.caption;
        if (args.parseMode) item.parse_mode = args.parseMode;
      }
      return item;
    });
    const body = {
      chat_id: args.chatId,
      media,
      disable_notification: args.disableNotification ?? false,
    };

    const data = await this.call('sendMediaGroup', body);
    // sendMediaGroup returns an array of Messages
    const first = Array.isArray(data) ? data[0] : data;
    const messageId = Number(first?.message_id);
    return {
      messageId,
      externalUrl: this.buildPostUrl(args.channelUsername, messageId),
    };
  }

  private buildPostUrl(username: string | null | undefined, messageId: number): string | null {
    if (!username || !Number.isFinite(messageId)) return null;
    const u = username.startsWith('@') ? username.slice(1) : username;
    return `https://t.me/${u}/${messageId}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async call(method: string, body: unknown): Promise<any> {
    if (!this.token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }
    const url = `${TG_API_BASE}/bot${this.token}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: unknown;
      description?: string;
      error_code?: number;
      parameters?: { retry_after?: number };
    };
    if (!res.ok || json.ok === false) {
      const desc = json.description ?? `HTTP ${res.status}`;
      const retryAfter = json.parameters?.retry_after;
      this.logger.warn(
        `Telegram ${method} failed: ${desc}${retryAfter ? ` (retry_after=${retryAfter}s)` : ''}`,
      );
      throw new Error(`Telegram ${method}: ${desc}`);
    }
    return json.result;
  }
}
