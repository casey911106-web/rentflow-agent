import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_LIMIT = 100; // Expo allows 100 per request

interface ExpoMessage {
  to: string;
  title?: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string; // Android notification channel
  priority?: 'default' | 'normal' | 'high';
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string; expoPushToken?: string };
}

/**
 * Sends push notifications to mobile devices via the Expo Push API.
 *
 * Free, unlimited (no Apple/Google fees because Expo proxies to APNs/FCM).
 * Tokens come from User.expoPushTokens (registered on app login).
 *
 * Sends are best-effort and fire-and-forget — push is a notification
 * channel, not a critical write path. We never throw out of these methods
 * so callers don't need try/catch.
 *
 * Stale-token cleanup: when Expo tells us a token is invalid
 * (DeviceNotRegistered), we strip it from the user's array immediately so
 * we don't keep retrying.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** New publishing task assigned to a field agent. */
  async notifyPublishingTaskAssigned(
    userId: string,
    info: { propertyCode: string; propertyName: string; assignmentId: string },
  ): Promise<void> {
    return this.send(userId, {
      title: '📣 New publishing task',
      body: `${info.propertyCode} — ${info.propertyName}. 24h to log placements.`,
      data: { kind: 'task_assigned', assignmentId: info.assignmentId, link: '/tasks' },
      channelId: 'tasks',
    });
  }

  /** New viewing assigned to a field agent. */
  async notifyViewingAssigned(
    userId: string,
    info: { propertyCode: string; propertyName: string; viewingId: string; scheduledAt: Date; leadName: string | null },
  ): Promise<void> {
    const time = info.scheduledAt.toLocaleString('en-GB', {
      timeZone: 'Asia/Dubai',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    return this.send(userId, {
      title: '🗓️ New viewing assigned',
      body: `${info.propertyCode} on ${time}${info.leadName ? ` · ${info.leadName}` : ''}`,
      data: { kind: 'viewing_assigned', viewingId: info.viewingId, link: `/viewing/${info.viewingId}` },
      channelId: 'viewings',
      priority: 'high',
    });
  }

  /** Reminder ~30 min before a viewing. */
  async notifyViewingReminder(
    userId: string,
    info: { propertyCode: string; viewingId: string; scheduledAt: Date },
  ): Promise<void> {
    const time = info.scheduledAt.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Dubai',
      hour: '2-digit',
      minute: '2-digit',
    });
    return this.send(userId, {
      title: `⏰ Viewing in 30 min — ${info.propertyCode}`,
      body: `Be on site by ${time}. Tap for address.`,
      data: { kind: 'viewing_reminder', viewingId: info.viewingId, link: `/viewing/${info.viewingId}` },
      channelId: 'viewings',
      priority: 'high',
    });
  }

  /** Availability check assigned to a field agent — confirm with the owner. */
  async notifyAvailabilityCheckAssigned(
    userId: string,
    info: { propertyCode: string; propertyName: string },
  ): Promise<void> {
    return this.send(userId, {
      title: '🏠 Confirma disponibilidad',
      body: `${info.propertyCode} — ${info.propertyName}. Pregunta al dueño. 24h.`,
      data: { kind: 'availability_check_assigned', link: '/availability' },
      channelId: 'availability',
    });
  }

  /** Property-details task assigned to a field agent — capture FAQ answers
   *  from the owner so the WhatsApp AI can reply to guests without escalating. */
  async notifyPropertyDetailsAssigned(
    userId: string,
    info: { propertyCode: string; propertyName: string },
  ): Promise<void> {
    return this.send(userId, {
      title: '📝 Datos faltantes',
      body: `${info.propertyCode} — ${info.propertyName}. Pregunta al dueño los datos básicos (ocupantes, baño, limpieza).`,
      data: { kind: 'property_details_assigned', link: '/property-details' },
      channelId: 'availability',
    });
  }

  /** A lead replied — operator(s) on the company should see it fast. */
  async notifyLeadReplied(
    userIds: string[],
    info: { leadId: string; leadName: string | null; phoneE164: string; preview: string },
  ): Promise<void> {
    const truncated = info.preview.length > 80 ? `${info.preview.slice(0, 77)}…` : info.preview;
    await Promise.all(
      userIds.map((id) =>
        this.send(id, {
          title: `💬 ${info.leadName ?? info.phoneE164} replied`,
          body: truncated,
          data: { kind: 'lead_replied', leadId: info.leadId, link: `/leads/${info.leadId}` },
          channelId: 'leads',
          priority: 'high',
        }),
      ),
    );
  }

  // ------------------------------------------------------------------------
  // privates
  // ------------------------------------------------------------------------

  private async send(userId: string, payload: Omit<ExpoMessage, 'to'>): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { expoPushTokens: true },
      });
      if (!user || user.expoPushTokens.length === 0) return;

      const messages: ExpoMessage[] = user.expoPushTokens.map((token) => ({
        to: token,
        sound: 'default',
        ...payload,
      }));

      const tickets = await this.postBatch(messages);
      const invalid = this.collectInvalidTokens(messages, tickets);
      if (invalid.length > 0) {
        await this.removeStaleTokens(userId, invalid);
      }
    } catch (err) {
      this.logger.warn(`Push send failed for user=${userId}: ${(err as Error).message}`);
    }
  }

  private async postBatch(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
    const tickets: ExpoTicket[] = [];
    for (let i = 0; i < messages.length; i += EXPO_BATCH_LIMIT) {
      const batch = messages.slice(i, i + EXPO_BATCH_LIMIT);
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(batch),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: ExpoTicket[]; errors?: unknown };
      if (Array.isArray(json.data)) tickets.push(...json.data);
    }
    return tickets;
  }

  private collectInvalidTokens(messages: ExpoMessage[], tickets: ExpoTicket[]): string[] {
    const invalid: string[] = [];
    tickets.forEach((t, i) => {
      if (t.status === 'error' && (t.details?.error === 'DeviceNotRegistered' || t.message?.includes('not a registered'))) {
        const token = messages[i]?.to;
        if (token) invalid.push(token);
      }
    });
    return invalid;
  }

  private async removeStaleTokens(userId: string, tokens: string[]) {
    if (tokens.length === 0) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { expoPushTokens: true },
    });
    if (!user) return;
    const next = user.expoPushTokens.filter((t) => !tokens.includes(t));
    await this.prisma.user.update({
      where: { id: userId },
      data: { expoPushTokens: next },
    });
    this.logger.log(`Pruned ${tokens.length} stale push token(s) from user=${userId}`);
  }
}
