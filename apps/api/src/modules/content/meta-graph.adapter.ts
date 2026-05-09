import { Injectable, Logger } from '@nestjs/common';

const GRAPH_BASE = 'https://graph.facebook.com';
const GRAPH_VERSION = 'v25.0';
const IG_PUBLISH_POLL_INTERVAL_MS = 1500;
const IG_PUBLISH_POLL_MAX = 20; // ~30s ceiling

export interface MetaSendResult {
  externalPostId: string;
  externalUrl: string | null;
}

export interface MetaMediaItem {
  /** Public HTTPS URL Meta fetches from. Must be reachable; private hosts fail. */
  url: string;
  /** image | video — defaults to image. */
  type?: 'image' | 'video';
}

/**
 * Wrapper over Meta Graph API for posting to Facebook Pages and Instagram
 * Business accounts. Same surface shape as TelegramAdapter so ContentService
 * can dispatch by platform without branching all the way through.
 *
 * Auth: a single long-lived Page Access Token (FACEBOOK_PAGE_TOKEN env)
 * works for BOTH the Facebook Page and the linked Instagram Business
 * account. Tokens issued from a long-lived user token are permanent —
 * they only invalidate on app changes or password reset.
 *
 * Posting rules:
 *  - Facebook Page: single photo, multi-photo (up to ~10), or text-only.
 *  - Instagram: needs a public image_url, two-step (create container,
 *    then publish). Carousels need N child containers wrapped in a
 *    parent CAROUSEL container. We poll status_code until FINISHED.
 */
@Injectable()
export class MetaGraphAdapter {
  private readonly logger = new Logger(MetaGraphAdapter.name);
  private readonly token = process.env.FACEBOOK_PAGE_TOKEN ?? '';

  isConfigured(): boolean {
    return this.token.length > 0;
  }

  // ------------------------------------------------------------------------
  // Facebook Page
  // ------------------------------------------------------------------------

  async postFacebookPagePhoto(args: {
    pageId: string;
    photoUrl: string;
    caption?: string;
  }): Promise<MetaSendResult> {
    const data = await this.call(`/${args.pageId}/photos`, {
      url: args.photoUrl,
      caption: args.caption ?? '',
      published: 'true',
    });
    const postId = String(data.post_id ?? data.id);
    return {
      externalPostId: postId,
      externalUrl: this.permalinkFromPostId(postId),
    };
  }

  async postFacebookPageMultiPhoto(args: {
    pageId: string;
    photoUrls: string[];
    caption?: string;
  }): Promise<MetaSendResult> {
    if (args.photoUrls.length === 0) {
      throw new Error('postFacebookPageMultiPhoto requires at least 1 photo');
    }
    if (args.photoUrls.length === 1) {
      return this.postFacebookPagePhoto({
        pageId: args.pageId,
        photoUrl: args.photoUrls[0]!,
        caption: args.caption,
      });
    }
    // Step 1: upload each photo as unpublished — get fbid back.
    const uploaded: string[] = [];
    for (const url of args.photoUrls.slice(0, 10)) {
      const r = await this.call(`/${args.pageId}/photos`, {
        url,
        published: 'false',
      });
      uploaded.push(String(r.id));
    }
    // Step 2: create the feed post that attaches all the unpublished photos.
    const attached = uploaded.map((fbid) => ({ media_fbid: fbid }));
    const post = await this.call(`/${args.pageId}/feed`, {
      message: args.caption ?? '',
      attached_media: JSON.stringify(attached),
    });
    const postId = String(post.id);
    return {
      externalPostId: postId,
      externalUrl: this.permalinkFromPostId(postId),
    };
  }

  async postFacebookPageText(args: {
    pageId: string;
    text: string;
  }): Promise<MetaSendResult> {
    const data = await this.call(`/${args.pageId}/feed`, {
      message: args.text,
    });
    const postId = String(data.id);
    return {
      externalPostId: postId,
      externalUrl: this.permalinkFromPostId(postId),
    };
  }

  // ------------------------------------------------------------------------
  // Instagram (Business)
  // ------------------------------------------------------------------------

  async postInstagramSingle(args: {
    igUserId: string;
    photoUrl: string;
    caption?: string;
  }): Promise<MetaSendResult> {
    // Step 1: create media container.
    const container = await this.call(`/${args.igUserId}/media`, {
      image_url: args.photoUrl,
      caption: args.caption ?? '',
    });
    const creationId = String(container.id);
    // Step 2: wait for container to be FINISHED.
    await this.waitIgContainerReady(creationId);
    // Step 3: publish.
    const published = await this.call(`/${args.igUserId}/media_publish`, {
      creation_id: creationId,
    });
    const mediaId = String(published.id);
    return {
      externalPostId: mediaId,
      externalUrl: await this.fetchIgPermalink(mediaId),
    };
  }

  async postInstagramCarousel(args: {
    igUserId: string;
    photoUrls: string[];
    caption?: string;
  }): Promise<MetaSendResult> {
    if (args.photoUrls.length === 0) {
      throw new Error('postInstagramCarousel requires at least 1 photo');
    }
    if (args.photoUrls.length === 1) {
      return this.postInstagramSingle({
        igUserId: args.igUserId,
        photoUrl: args.photoUrls[0]!,
        caption: args.caption,
      });
    }
    // Step 1: create each child container as is_carousel_item.
    const childIds: string[] = [];
    for (const url of args.photoUrls.slice(0, 10)) {
      const child = await this.call(`/${args.igUserId}/media`, {
        image_url: url,
        is_carousel_item: 'true',
      });
      childIds.push(String(child.id));
    }
    // Step 2: wait for each child to be ready.
    for (const id of childIds) await this.waitIgContainerReady(id);
    // Step 3: create parent CAROUSEL container.
    const parent = await this.call(`/${args.igUserId}/media`, {
      media_type: 'CAROUSEL',
      caption: args.caption ?? '',
      children: childIds.join(','),
    });
    const creationId = String(parent.id);
    await this.waitIgContainerReady(creationId);
    // Step 4: publish.
    const published = await this.call(`/${args.igUserId}/media_publish`, {
      creation_id: creationId,
    });
    const mediaId = String(published.id);
    return {
      externalPostId: mediaId,
      externalUrl: await this.fetchIgPermalink(mediaId),
    };
  }

  // ------------------------------------------------------------------------
  // privates
  // ------------------------------------------------------------------------

  private permalinkFromPostId(postId: string): string | null {
    // FB post IDs come as <pageId>_<postSuffix>. The public URL is
    // facebook.com/<pageId>/posts/<postSuffix>.
    const parts = postId.split('_');
    if (parts.length === 2) {
      return `https://www.facebook.com/${parts[0]}/posts/${parts[1]}`;
    }
    return `https://www.facebook.com/${postId}`;
  }

  private async fetchIgPermalink(mediaId: string): Promise<string | null> {
    try {
      const data = await this.callGet(`/${mediaId}`, { fields: 'permalink' });
      return typeof data.permalink === 'string' ? data.permalink : null;
    } catch {
      return null;
    }
  }

  private async waitIgContainerReady(containerId: string): Promise<void> {
    for (let i = 0; i < IG_PUBLISH_POLL_MAX; i++) {
      const data = await this.callGet(`/${containerId}`, { fields: 'status_code' });
      const status = data.status_code as string | undefined;
      if (status === 'FINISHED') return;
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new Error(`IG container ${containerId} reached ${status}`);
      }
      await sleep(IG_PUBLISH_POLL_INTERVAL_MS);
    }
    throw new Error(`IG container ${containerId} did not finish in time`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async call(path: string, params: Record<string, string>): Promise<any> {
    if (!this.token) throw new Error('FACEBOOK_PAGE_TOKEN is not set');
    const url = `${GRAPH_BASE}/${GRAPH_VERSION}${path}`;
    const body = new URLSearchParams({ ...params, access_token: this.token });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return this.parseResponse(res, path);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async callGet(path: string, params: Record<string, string>): Promise<any> {
    if (!this.token) throw new Error('FACEBOOK_PAGE_TOKEN is not set');
    const qs = new URLSearchParams({ ...params, access_token: this.token });
    const url = `${GRAPH_BASE}/${GRAPH_VERSION}${path}?${qs.toString()}`;
    const res = await fetch(url);
    return this.parseResponse(res, path);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async parseResponse(res: Response, path: string): Promise<any> {
    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; type?: string; code?: number };
    } & Record<string, unknown>;
    if (!res.ok || json.error) {
      const msg = json.error?.message ?? `HTTP ${res.status}`;
      this.logger.warn(`Meta Graph ${path} failed: ${msg}`);
      throw new Error(`Meta Graph ${path}: ${msg}`);
    }
    return json;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
