import { Injectable, Logger } from '@nestjs/common';

const META_API_BASE = 'https://graph.facebook.com/v25.0';

interface DownloadResult {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Downloads a media item from WhatsApp Cloud API by its media id.
 *
 * Two-step flow:
 *  1. GET /<media-id> → returns a short-lived `url` + `mime_type`
 *  2. GET <url> with Authorization → returns the binary
 *
 * Both steps require the Cloud API access token. The download URL expires
 * within ~5 min of the original message — practical impact is that media
 * must be downloaded near message receipt time, not hours later.
 */
@Injectable()
export class MediaDownloader {
  private readonly logger = new Logger(MediaDownloader.name);
  private readonly token = process.env.WHATSAPP_CLOUD_API_ACCESS_TOKEN ?? '';

  isConfigured(): boolean {
    return this.token.length > 0;
  }

  async download(mediaId: string): Promise<DownloadResult | null> {
    if (!this.token) {
      this.logger.warn('WHATSAPP_CLOUD_API_ACCESS_TOKEN missing — skipping media download');
      return null;
    }
    try {
      const meta = await this.fetchMetadata(mediaId);
      if (!meta) return null;
      const buffer = await this.fetchBinary(meta.url);
      if (!buffer) return null;
      return { buffer, mimeType: meta.mimeType };
    } catch (err) {
      this.logger.warn(`Media download failed for ${mediaId}: ${(err as Error).message}`);
      return null;
    }
  }

  private async fetchMetadata(mediaId: string): Promise<{ url: string; mimeType: string } | null> {
    const res = await fetch(`${META_API_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      this.logger.warn(`Media metadata fetch ${mediaId} returned ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { url?: string; mime_type?: string };
    if (!json.url || !json.mime_type) return null;
    return { url: json.url, mimeType: json.mime_type };
  }

  private async fetchBinary(url: string): Promise<Buffer | null> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      this.logger.warn(`Media binary fetch returned ${res.status}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

/**
 * Try to dig out a media_id from a raw inbound payload. The cloud-api
 * adapter passes raw through on InboundMessage, so we have the original
 * webhook shape available.
 */
export function extractMediaIdFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    image?: { id?: string };
    video?: { id?: string };
    document?: { id?: string };
    audio?: { id?: string };
  };
  return r.image?.id ?? r.video?.id ?? r.document?.id ?? r.audio?.id ?? null;
}
