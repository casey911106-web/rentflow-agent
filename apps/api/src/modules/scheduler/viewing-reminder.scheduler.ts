import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppAdapterProvider } from '../whatsapp/adapter.provider';
import { SchedulerService } from './scheduler.service';

/**
 * Two reminder passes for upcoming viewings.
 *
 * Morning brief (07:30 Asia/Dubai daily): for every viewing today, send the
 * lead a friendly heads-up with a fresh reschedule link (valid until 1h
 * before the viewing). The link goes through the public scheduler so the
 * lead can pick a new slot inside the same chat flow.
 *
 * 30-minute heads-up (every 5 min): for viewings starting in ~30 min, send
 * the lead a short 'see you soon' nudge with the agent's name. We dedupe on
 * a flag in Viewing.metadata-style — the simplest path is to use
 * outcomeNotes prefix; instead, we leverage the `arrivedAt` field by
 * checking if a 'reminder30' notification was already created for this
 * viewing.
 *
 * Both messages go via free-form text inside the lead's 24h customer-service
 * window. If outside the window the send fails silently — operators can
 * follow up manually.
 */
@Injectable()
export class ViewingReminderScheduler {
  private readonly logger = new Logger(ViewingReminderScheduler.name);
  private morningRunning = false;
  private nearRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly waAdapter: WhatsAppAdapterProvider,
    private readonly scheduler: SchedulerService,
  ) {}

  /** Daily 07:30 Asia/Dubai (= 03:30 UTC). */
  @Cron('30 3 * * *', { name: 'viewing-morning-brief', timeZone: 'UTC' })
  async morningBrief() {
    if (this.morningRunning) return;
    this.morningRunning = true;
    try {
      const result = await this.runMorning();
      if (result.sent > 0) this.logger.log(`Morning briefs sent: ${result.sent}`);
    } catch (err) {
      this.logger.error(`morningBrief: ${(err as Error).message}`);
    } finally {
      this.morningRunning = false;
    }
  }

  /** Every 5 min — 30-minute heads-up before a viewing. */
  @Cron('*/5 * * * *', { name: 'viewing-30min-heads-up' })
  async thirtyMinHeadsUp() {
    if (this.nearRunning) return;
    this.nearRunning = true;
    try {
      const result = await this.runNear();
      if (result.sent > 0) this.logger.log(`30-min reminders sent: ${result.sent}`);
    } catch (err) {
      this.logger.error(`thirtyMinHeadsUp: ${(err as Error).message}`);
    } finally {
      this.nearRunning = false;
    }
  }

  private async runMorning() {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const viewings = await this.prisma.viewing.findMany({
      where: {
        scheduledAt: { gte: todayStart, lt: todayEnd },
        status: { notIn: ['cancelled', 'lost', 'completed', 'converted'] },
      },
      include: {
        property: { select: { code: true, name: true } },
        lead: { select: { id: true, phoneE164: true, fullName: true } },
        fieldAgent: { include: { user: { select: { fullName: true } } } },
      },
    });

    let sent = 0;
    for (const v of viewings) {
      try {
        // Issue a fresh reschedule token (one-shot, 24h expiry)
        const token = await this.scheduler.issueRescheduleToken(v.companyId, v.id);
        const marketplaceBase =
          process.env.MARKETPLACE_BASE_URL ?? 'https://rentflow-agent.vercel.app';
        const link = `${marketplaceBase}/p/${v.property.code}/schedule?t=${token.id}`;
        const time = v.scheduledAt.toLocaleTimeString('en-GB', {
          timeZone: 'Asia/Dubai',
          hour: '2-digit',
          minute: '2-digit',
        });
        const agentName = v.fieldAgent?.user?.fullName ?? 'our agent';
        const body = `Good morning${v.lead.fullName ? ` ${v.lead.fullName.split(/\s+/)[0]}` : ''}! Reminder: ${agentName} will meet you today at ${time} for ${v.property.code} — ${v.property.name}.\n\nNeed a different time? Reschedule (up to 1h before): ${link}`;

        const conv = await this.prisma.whatsAppConversation.findFirst({
          where: { companyId: v.companyId, leadPhoneE164: v.lead.phoneE164 },
        });
        await this.waAdapter.adapter.sendText({
          to: v.lead.phoneE164,
          body,
          conversationId: conv?.id ?? `lead:${v.lead.phoneE164}`,
        });
        if (conv) {
          await this.prisma.whatsAppMessage.create({
            data: {
              companyId: v.companyId,
              conversationId: conv.id,
              direction: 'outbound',
              type: 'text',
              body,
              providerStatus: 'sent',
            },
          });
        }
        sent++;
      } catch (err) {
        this.logger.warn(`Morning brief failed for viewing=${v.id}: ${(err as Error).message}`);
      }
    }
    return { sent };
  }

  private async runNear() {
    const now = new Date();
    const inMin = new Date(now.getTime() + 25 * 60 * 1000);
    const inMax = new Date(now.getTime() + 35 * 60 * 1000);

    const viewings = await this.prisma.viewing.findMany({
      where: {
        scheduledAt: { gte: inMin, lte: inMax },
        status: { notIn: ['cancelled', 'lost', 'completed', 'converted'] },
      },
      include: {
        property: { select: { code: true, name: true, addressLine: true } },
        lead: { select: { id: true, phoneE164: true, fullName: true } },
        fieldAgent: { include: { user: { select: { fullName: true } } } },
      },
    });

    let sent = 0;
    for (const v of viewings) {
      // Dedupe via Notification existing for this viewing+kind
      const already = await this.prisma.notification.findFirst({
        where: {
          companyId: v.companyId,
          title: `30min:${v.id}`,
        },
      });
      if (already) continue;

      try {
        const time = v.scheduledAt.toLocaleTimeString('en-GB', {
          timeZone: 'Asia/Dubai',
          hour: '2-digit',
          minute: '2-digit',
        });
        const agentName = v.fieldAgent?.user?.fullName ?? 'our agent';
        const addr = v.property.addressLine ? `\n📍 ${v.property.addressLine}` : '';
        const body = `Heads-up — ${agentName} will be at ${v.property.code} at ${time} (in ~30 min).${addr}\n\nIf you need to cancel or shift, message us now.`;

        const conv = await this.prisma.whatsAppConversation.findFirst({
          where: { companyId: v.companyId, leadPhoneE164: v.lead.phoneE164 },
        });
        await this.waAdapter.adapter.sendText({
          to: v.lead.phoneE164,
          body,
          conversationId: conv?.id ?? `lead:${v.lead.phoneE164}`,
        });
        if (conv) {
          await this.prisma.whatsAppMessage.create({
            data: {
              companyId: v.companyId,
              conversationId: conv.id,
              direction: 'outbound',
              type: 'text',
              body,
              providerStatus: 'sent',
            },
          });
        }
        // Dedupe marker
        await this.prisma.notification.create({
          data: {
            companyId: v.companyId,
            kind: 'info',
            title: `30min:${v.id}`,
            body: 'Sent 30-min heads-up to lead',
          },
        });
        sent++;
      } catch (err) {
        this.logger.warn(`30-min reminder failed for viewing=${v.id}: ${(err as Error).message}`);
      }
    }
    return { sent };
  }
}
