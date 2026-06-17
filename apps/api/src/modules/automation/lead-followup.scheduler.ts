import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { LeadStatus } from '@rentflow/database';
import { PrismaService } from '../../prisma/prisma.service';
import { OperatorNotifierService } from '../ai-agent/operator-notifier.service';
import { SuggestionEngineService, type LeadState } from '../ai-agent/suggestion-engine.service';

/**
 * Two follow-up tiers, all measured in minutes-since-OUR-last-reply.
 * Each tier has a small window so the every-5-min cron always catches them.
 * No tier ever fires once the lead's 24h Meta customer-service window has
 * closed (>= 24h since their last inbound message) — we don't pay for
 * UTILITY/MARKETING templates to push silent leads.
 *
 * Each tier produces a *pending* Suggestion that needs operator approval —
 * proactive nudges never auto-approve, regardless of confidence.
 *
 * Trimmed from 4 tiers to 2 (2026-06): the intermediate 6h/20h nudges burned
 * Claude tokens on silent leads without converting. We keep only the two
 * highest-leverage moments — the early "got-distracted" nudge and the
 * last-call before the 24h window closes — halving proactive generation cost.
 */
const FOLLOWUP_TIERS: Array<{
  label: string;
  minMin: number; // inclusive
  maxMin: number; // exclusive
  intent: string; // hint for Claude prompt
}> = [
  { label: '30min',  minMin: 30,   maxMin: 60,   intent: 'Soft, friendly nudge — they probably got distracted. One sentence.' },
  { label: '23h30',  minMin: 1410, maxMin: 1440, intent: 'Last-call before the chat window closes for 24h — "we are here if you need anything else, just say hi".' },
];

const TERMINAL_STATUSES = new Set<LeadStatus>(['won', 'lost', 'opted_out']);

const ELIGIBLE_LEAD_STATUSES: LeadStatus[] = [
  'new',
  'contacted',
  'qualifying',
  'qualified',
  'options_sent',
  'viewing_requested',
];

const WINDOW_MAX_HOURS = 24;

@Injectable()
export class LeadFollowupScheduler {
  private readonly logger = new Logger(LeadFollowupScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: SuggestionEngineService,
    private readonly notifier: OperatorNotifierService,
  ) {}

  /** Every 5 minutes — tier windows are 30 min wide so we never miss. */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'lead-followup-sweep' })
  async sweep(): Promise<void> {
    if (this.running) {
      this.logger.warn('Skipping sweep — previous run still in progress.');
      return;
    }
    this.running = true;
    try {
      await this.runSweep();
    } catch (err) {
      this.logger.error(`Lead follow-up sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async runManually(): Promise<{ generated: number; skipped: number }> {
    return this.runSweep();
  }

  private async runSweep(): Promise<{ generated: number; skipped: number }> {
    let generated = 0;
    let skipped = 0;

    const candidates = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        status: { in: ELIGIBLE_LEAD_STATUSES },
        whatsappConversation: { is: { mode: 'ai' } },
      },
      include: { whatsappConversation: true },
      take: 200,
    });

    const now = Date.now();
    const windowCutoff = new Date(now - WINDOW_MAX_HOURS * 60 * 60 * 1000);

    for (const lead of candidates) {
      if (!lead.whatsappConversation) {
        skipped++;
        continue;
      }
      if (TERMINAL_STATUSES.has(lead.status)) {
        skipped++;
        continue;
      }

      // Lead's customer-service window must still be open.
      const lastInbound = await this.prisma.whatsAppMessage.findFirst({
        where: { conversationId: lead.whatsappConversation.id, direction: 'inbound' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (!lastInbound || lastInbound.createdAt < windowCutoff) {
        // No inbound or > 24h since last one → window closed, do not follow up.
        skipped++;
        continue;
      }

      // Skip leads that already have a confirmed/assigned viewing inside
      // the next 36h. They are not silent because they got distracted —
      // they are silent because they already have an appointment with us.
      // Sending another nudge here is the spam pattern we keep getting
      // burned by ("Just checking in ahead of tomorrow's viewing").
      const upcomingViewing = await this.prisma.viewing.findFirst({
        where: {
          leadId: lead.id,
          status: { in: ['confirmed', 'assigned', 'rescheduled', 'requested'] },
          scheduledAt: { gte: new Date(now), lte: new Date(now + 36 * 60 * 60 * 1000) },
        },
        select: { id: true, scheduledAt: true, status: true },
      });
      if (upcomingViewing) {
        skipped++;
        continue;
      }

      // Measure tier from THE LEAD'S last inbound. (Was lastOutbound, which
      // chained: each sent follow-up reset the clock, so the 30-min tier
      // re-fired every 30 min indefinitely. The 4 tier names describe how
      // long the guest has been silent — that's the inbound anchor, not
      // our reply anchor.)
      const lastOutbound = await this.prisma.whatsAppMessage.findFirst({
        where: { conversationId: lead.whatsappConversation.id, direction: 'outbound' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (!lastOutbound) {
        // We haven't replied yet — the inbound flow handles first reply, not us.
        skipped++;
        continue;
      }

      const minutesSinceInbound = Math.floor((now - lastInbound.createdAt.getTime()) / 60_000);
      const tier = FOLLOWUP_TIERS.find((t) => minutesSinceInbound >= t.minMin && minutesSinceInbound < t.maxMin);
      if (!tier) {
        skipped++;
        continue;
      }

      // Already sent THIS tier since the lead went silent? Skip.
      const dupe = await this.prisma.suggestion.findFirst({
        where: {
          leadId: lead.id,
          createdAt: { gte: lastInbound.createdAt },
          reasoning: { contains: `[follow-up ${tier.label}]` },
        },
        select: { id: true },
      });
      if (dupe) {
        skipped++;
        continue;
      }

      // Anti-spam guard: never chain two outbound messages within 25 min of
      // each other. If our last outbound is fresher than that, even if a
      // tier window is open, skip — operator just replied or we just sent
      // a previous follow-up.
      const minutesSinceOutbound = Math.floor((now - lastOutbound.createdAt.getTime()) / 60_000);
      if (minutesSinceOutbound < 25) {
        skipped++;
        continue;
      }

      const ok = await this.generateForLead(lead, tier);
      if (ok) generated++;
      else skipped++;
    }

    this.logger.log(`Lead follow-up sweep: generated=${generated} skipped=${skipped}`);
    return { generated, skipped };
  }

  private async generateForLead(
    lead: { id: string; companyId: string; whatsappConversation: { id: string } | null },
    tier: { label: string; minMin: number; maxMin: number; intent: string },
  ): Promise<boolean> {
    if (!lead.whatsappConversation) return false;

    const session = await this.prisma.aIAgentSession.findFirst({
      where: { companyId: lead.companyId, leadId: lead.id, machine: 'lead', endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    const state = (session?.state as LeadState | undefined) ?? 'qualify_lead';

    const result = await this.engine.generate({
      companyId: lead.companyId,
      leadId: lead.id,
      conversationId: lead.whatsappConversation.id,
      inboundMessageId: '',
      state,
      proactive: { hoursOfSilence: tier.minMin / 60 },
    });

    if (!result.payload) {
      this.logger.warn(`Follow-up generation failed for lead=${lead.id}: ${result.errorMessage ?? 'no payload'}`);
      return false;
    }

    const suggestion = await this.prisma.suggestion.create({
      data: {
        companyId: lead.companyId,
        leadId: lead.id,
        conversationId: lead.whatsappConversation.id,
        inboundMessageId: null,
        state,
        suggestedReply: result.payload.suggestedReply,
        reasoning: `[follow-up ${tier.label}] ${tier.intent} — ${result.payload.reasoning}`,
        confidence: result.payload.confidence,
        stateAfter: result.payload.stateAfter,
        escalate: result.payload.escalate,
        status: 'pending',
        modelId: result.modelId,
        inputTokens: result.tokenUsage.inputTokens,
        outputTokens: result.tokenUsage.outputTokens,
        cacheReadTokens: result.tokenUsage.cacheReadInputTokens,
        cacheCreationTokens: result.tokenUsage.cacheCreationInputTokens,
        latencyMs: result.latencyMs,
      },
    });

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: { lastFollowUpAt: new Date() },
    });

    try {
      await this.notifier.notifyNewSuggestion(suggestion.id);
    } catch (err) {
      this.logger.warn(
        `Operator notification for follow-up failed (suggestion=${suggestion.id}): ${(err as Error).message}`,
      );
    }
    return true;
  }
}
