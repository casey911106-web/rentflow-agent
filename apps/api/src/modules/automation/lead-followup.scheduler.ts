import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { OperatorNotifierService } from '../ai-agent/operator-notifier.service';
import { SuggestionEngineService, type LeadState } from '../ai-agent/suggestion-engine.service';

const FOLLOWUP_TIERS: Array<{ minHours: number; maxHours: number; label: string }> = [
  { minHours: 3,  maxHours: 24,  label: '3h'  },
  { minHours: 24, maxHours: 72,  label: '24h' },
  { minHours: 72, maxHours: 168, label: '3d'  },
];

const TERMINAL_STATUSES = new Set(['won', 'lost', 'opted_out']);

const FOLLOWUP_COOLDOWN_HOURS = 12;

const ELIGIBLE_LEAD_STATUSES = new Set([
  'new',
  'contacted',
  'qualifying',
  'qualified',
  'options_sent',
  'viewing_requested',
  'cold',
]);

/**
 * Sweeps for silent leads and generates proactive follow-up Suggestions.
 *
 * Three tiers (3h / 24h / 3d). For each lead in the eligible window:
 *   - skip if already received a proactive suggestion in the last 12h
 *   - skip if conversation is human_takeover or closed
 *   - otherwise generate a new pending Suggestion via Claude
 *
 * The operator approves/edits/cancels via the dashboard or WhatsApp buttons —
 * same flow as inbound-driven suggestions.
 */
@Injectable()
export class LeadFollowupScheduler {
  private readonly logger = new Logger(LeadFollowupScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: SuggestionEngineService,
    private readonly notifier: OperatorNotifierService,
  ) {}

  /** Runs every 30 minutes. Configurable via @nestjs/schedule. */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'lead-followup-sweep' })
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

  /** Public hook so an admin endpoint can trigger the sweep on demand. */
  async runManually(): Promise<{ generated: number; skipped: number }> {
    return this.runSweep();
  }

  private async runSweep(): Promise<{ generated: number; skipped: number }> {
    let generated = 0;
    let skipped = 0;

    for (const tier of FOLLOWUP_TIERS) {
      const minAt = new Date(Date.now() - tier.maxHours * 60 * 60 * 1000);
      const maxAt = new Date(Date.now() - tier.minHours * 60 * 60 * 1000);
      const cooldownAt = new Date(Date.now() - FOLLOWUP_COOLDOWN_HOURS * 60 * 60 * 1000);

      const candidates = await this.prisma.lead.findMany({
        where: {
          deletedAt: null,
          status: { in: Array.from(ELIGIBLE_LEAD_STATUSES) },
          lastInteractionAt: { gte: minAt, lte: maxAt },
          OR: [
            { lastFollowUpAt: null },
            { lastFollowUpAt: { lt: cooldownAt } },
          ],
          whatsappConversation: { is: { mode: 'ai' } },
        },
        include: { whatsappConversation: true },
        take: 25,
      });

      for (const lead of candidates) {
        if (!lead.whatsappConversation) {
          skipped++;
          continue;
        }
        if (TERMINAL_STATUSES.has(lead.status)) {
          skipped++;
          continue;
        }
        const ok = await this.generateForLead(lead, tier);
        if (ok) generated++;
        else skipped++;
      }
    }

    this.logger.log(`Lead follow-up sweep: generated=${generated} skipped=${skipped}`);
    return { generated, skipped };
  }

  private async generateForLead(
    lead: { id: string; companyId: string; whatsappConversation: { id: string } | null },
    tier: { minHours: number; maxHours: number; label: string },
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
      proactive: { hoursOfSilence: tier.minHours },
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
        reasoning: `[follow-up ${tier.label}] ${result.payload.reasoning}`,
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
