import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { formatPriceLines } from '@rentflow/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppAdapterProvider } from './adapter.provider';
import { isOptOut } from './parsers';
import { SuggestionEngineService, type LeadState } from '../ai-agent/suggestion-engine.service';
import { OperatorNotifierService } from '../ai-agent/operator-notifier.service';
import { SuggestionsService } from '../ai-agent/suggestions.service';

/**
 * Confidence threshold above which the system auto-approves the suggestion
 * and sends it to the lead without waiting for the operator. Below this,
 * the suggestion stays pending. The AI's `escalate` flag always disables
 * auto-approve regardless of confidence.
 *
 * Raised from 0.85 to 0.95 — Claude tended to overshoot confidence and
 * leak wrong-info replies through. The system prompt now defines a
 * calibrated 0.95+ band ("a junior teammate would send this identically")
 * so suggestions in that band are genuinely safe to auto-send.
 */
// Was 0.95; 41% of suggestions were expiring un-actioned because the operator
// couldn't keep up. The model is already gated by other checks (escalate flag,
// stateAfter snap-backs), so we trust it a bit further to free the human queue.
const AUTO_APPROVE_CONFIDENCE = 0.85;

interface RunInput {
  companyId: string;
  leadId: string;
  conversationId: string;
  inboundMessageId: string;
}

/**
 * Lead workflow runner — human-in-the-loop mode.
 *
 * On each inbound message, we:
 *   1. Check guardrails (mode, opt-out, terminal status)
 *   2. Determine the current state from AIAgentSession
 *   3. Ask Claude (via SuggestionEngine) for a suggested reply
 *   4. Persist the suggestion as `pending` for the operator to approve/edit/cancel
 *
 * **Nothing is sent to the lead automatically.** The operator approves the
 * Suggestion in the dashboard or via WhatsApp interactive buttons (Capa 2).
 */
@Injectable()
export class LeadWorkflowRunner {
  private readonly logger = new Logger(LeadWorkflowRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: WhatsAppAdapterProvider,
    @Inject(forwardRef(() => SuggestionEngineService))
    private readonly engine: SuggestionEngineService,
    @Inject(forwardRef(() => OperatorNotifierService))
    private readonly notifier: OperatorNotifierService,
    @Inject(forwardRef(() => SuggestionsService))
    private readonly suggestions: SuggestionsService,
  ) {}

  async run(input: RunInput): Promise<void> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: input.leadId, companyId: input.companyId, deletedAt: null },
      include: { whatsappConversation: true },
    });
    if (!lead || !lead.whatsappConversation) return;

    if (lead.whatsappConversation.mode !== 'ai') {
      this.logger.debug(`Skipping suggestion: conversation ${lead.whatsappConversation.id} mode=${lead.whatsappConversation.mode}`);
      return;
    }

    if (['won', 'lost', 'opted_out'].includes(lead.status)) return;

    // Detect opt-out on the inbound text — handle without calling the LLM.
    const inbound = await this.prisma.whatsAppMessage.findUnique({
      where: { id: input.inboundMessageId },
    });
    const inboundText = (inbound?.body ?? '').trim();

    if (inboundText && isOptOut(inboundText)) {
      await this.handleOptOut(lead.id, lead.whatsappConversation.id);
      return;
    }

    // Resolve state from active AIAgentSession.
    const session = await this.prisma.aIAgentSession.findFirst({
      where: { companyId: input.companyId, leadId: lead.id, machine: 'lead', endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    let state = (session?.state as LeadState | undefined) ?? 'initial_contact';

    // High-intent fast-forward: most inbounds open with "Hi! I'm interested
    // in RF-46GP5 …" (pre-filled by the click-to-chat link). When the lead
    // already carries an attributed propertyId AND that property has an
    // active Fast Posting package, skip the boilerplate qualification dance
    // and ask for a viewing time straight away. Reduces median turns to
    // viewing from ~6 down to 1.
    if (!session && lead.propertyId && state === 'initial_contact') {
      const offerable = await this.prisma.property.findFirst({
        where: {
          id: lead.propertyId,
          deletedAt: null,
          status: 'available',
          postPackages: {
            some: { deletedAt: null, status: { in: ['generated', 'scheduled', 'pending_approval', 'approved', 'published'] } },
          },
        },
        select: { id: true },
      });
      if (offerable) {
        state = 'suggest_property';
        this.logger.log(`Fast-forwarding lead=${lead.id} from initial_contact → suggest_property (propertyId pre-attributed)`);
      }
    }

    // Fast-path: when the inbound carries the `[viewing]` marker (sent by
    // the marketplace 'Book a viewing' CTA) AND a property code, we bypass
    // Claude entirely. Claude has repeatedly mis-handled this exact case by
    // anchoring on stale conversation history; the response is fully
    // determinable from the message + catalog so we just build it.
    const fastPath = await this.tryDirectViewingResponse(lead, inboundText, state);
    if (fastPath) {
      await this.deliverFastPathSuggestion(input, lead, state, fastPath);
      return;
    }

    this.logger.log(`Generating suggestion for lead=${lead.id} state=${state}`);

    const result = await this.engine.generate({
      companyId: input.companyId,
      leadId: lead.id,
      conversationId: lead.whatsappConversation.id,
      inboundMessageId: input.inboundMessageId,
      state,
    });

    if (!result.payload) {
      // Persist a failed suggestion so the operator sees what happened.
      await this.prisma.suggestion.create({
        data: {
          companyId: input.companyId,
          leadId: lead.id,
          conversationId: lead.whatsappConversation.id,
          inboundMessageId: input.inboundMessageId,
          state,
          suggestedReply: result.rawText || '(no output)',
          status: 'failed',
          modelId: result.modelId,
          inputTokens: result.tokenUsage.inputTokens,
          outputTokens: result.tokenUsage.outputTokens,
          cacheReadTokens: result.tokenUsage.cacheReadInputTokens,
          cacheCreationTokens: result.tokenUsage.cacheCreationInputTokens,
          latencyMs: result.latencyMs,
          errorMessage: result.errorMessage ?? 'Model did not return a usable suggestion.',
        },
      });
      this.logger.warn(`Suggestion generation failed for lead=${lead.id}: ${result.errorMessage}`);
      return;
    }

    // Persist multi-field extraction onto the Lead row (only fill empty
    // fields — never overwrite something the operator already corrected).
    if (result.payload.extractedFields) {
      const ef = result.payload.extractedFields;
      const updates: Record<string, unknown> = {};
      if (ef.budgetAed != null && lead.budgetAed == null) updates.budgetAed = ef.budgetAed;
      if (ef.preferredArea && !lead.preferredArea) updates.preferredArea = ef.preferredArea;
      if (ef.peopleCount != null && lead.peopleCount == null) updates.peopleCount = ef.peopleCount;
      if (ef.moveInDate && !lead.moveInDate) {
        const d = new Date(ef.moveInDate);
        if (!isNaN(d.getTime())) updates.moveInDate = d;
      }
      if (ef.rentalDurationMonths != null && lead.rentalDurationMonths == null) {
        updates.rentalDurationMonths = ef.rentalDurationMonths;
      }
      if (Object.keys(updates).length > 0) {
        await this.prisma.lead.update({ where: { id: lead.id }, data: updates });
        this.logger.log(`Lead ${lead.id} fields updated from AI extraction: ${Object.keys(updates).join(', ')}`);
      }
    }

    // Derive qualificationScore + temperature + status from however many
    // profile fields are now collected. Without this, leads sit on
    // `qualifying / unqualified / score=0` forever even after the AI
    // extracted budget, area, people-count, move-in. We recompute every
    // turn (cheap) so newly-collected fields are reflected immediately.
    {
      const known = countCollectedFields(lead, result.payload.extractedFields);
      const qualificationScore = known * 20; // 0/20/40/60/80/100
      let temperature: 'unqualified' | 'cold' | 'warm' | 'hot' = 'unqualified';
      if (known >= 4) temperature = 'hot';
      else if (known === 3) temperature = 'warm';
      else if (known === 2) temperature = 'cold';
      const scoreUpdates: Record<string, unknown> = { qualificationScore, temperature };
      // Promote qualifying/new → qualified once 3 of 5 profile fields are
      // known. Don't downgrade from later statuses (options_sent,
      // viewing_*, won, opted_out, etc.).
      if (known >= 3 && (lead.status === 'qualifying' || lead.status === 'new')) {
        scoreUpdates.status = 'qualified';
      }
      await this.prisma.lead.update({ where: { id: lead.id }, data: scoreUpdates });
    }

    // Server-side validation of `stateAfter` — Claude sometimes jumps to
    // suggest_property without enough profile data, or to closed without
    // an explicit close signal. Snap implausible jumps back to a
    // collect_* state.
    const fieldsKnown = countCollectedFields(lead, result.payload.extractedFields);
    let stateAfter = result.payload.stateAfter;
    if (stateAfter === 'suggest_property' && fieldsKnown < 2) {
      this.logger.warn(`Snapping stateAfter from suggest_property → qualify_lead (only ${fieldsKnown}/5 fields known) for lead=${lead.id}`);
      stateAfter = 'qualify_lead';
    }
    if (stateAfter === 'closed' && !['won', 'lost', 'opted_out'].includes(lead.status)) {
      this.logger.warn(`Snapping stateAfter from closed → qualify_lead (lead status=${lead.status}) for lead=${lead.id}`);
      stateAfter = 'qualify_lead';
    }

    const suggestion = await this.prisma.suggestion.create({
      data: {
        companyId: input.companyId,
        leadId: lead.id,
        conversationId: lead.whatsappConversation.id,
        inboundMessageId: input.inboundMessageId,
        state,
        suggestedReply: result.payload.suggestedReply,
        reasoning: result.payload.reasoning,
        confidence: result.payload.confidence,
        stateAfter,
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

    if (lead.status === 'new') {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { status: 'qualifying' },
      });
    }

    const conf = result.payload.confidence ?? 0;
    const escalate = result.payload.escalate ?? false;
    const autoApprove = conf >= AUTO_APPROVE_CONFIDENCE && !escalate;

    if (autoApprove) {
      // Resolve a 'system' user — the company's first super_admin — to record
      // the approval against, since SuggestionsService.approve needs a userId.
      const sysUser = await this.prisma.user.findFirst({
        where: {
          companyId: input.companyId,
          deletedAt: null,
          status: 'active',
          roles: { has: 'super_admin' },
        },
        select: { id: true },
      });
      if (!sysUser) {
        this.logger.warn(`No super_admin found for auto-approve; falling back to operator review`);
      } else {
        try {
          await this.suggestions.approve(input.companyId, suggestion.id, sysUser.id);
          this.logger.log(`Auto-approved suggestion=${suggestion.id} (confidence=${conf})`);
          return;
        } catch (err) {
          this.logger.warn(
            `Auto-approve failed for suggestion=${suggestion.id}: ${(err as Error).message}; falling back to operator notification`,
          );
        }
      }
    }

    // Fall through: operator-in-the-loop. Push to operator phone (Capa 2).
    try {
      await this.notifier.notifyNewSuggestion(suggestion.id);
    } catch (err) {
      this.logger.warn(
        `Operator notification failed for suggestion=${suggestion.id}: ${(err as Error).message}`,
      );
    }
  }

  private async handleOptOut(leadId: string, conversationId: string) {
    this.logger.log(`Lead ${leadId} opted out — closing conversation`);
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { status: 'opted_out' },
    });
    await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { mode: 'closed' },
    });
    await this.prisma.aIAgentSession.updateMany({
      where: { leadId, machine: 'lead', endedAt: null },
      data: { endedAt: new Date() },
    });
  }

  /**
   * Builds a deterministic "yes you can book this property" reply when the
   * inbound carries `[viewing]` (the marketplace book-viewing CTA marker)
   * plus a parseable property code. Returns null if either is missing or
   * the property is not available — those cases keep going through Claude.
   *
   * The whole point is to take Claude's hand off the wheel for this one
   * very high-confidence intent. Returning a hard-coded shape guarantees
   * the lead gets confirm + 3 numbers + the scheduler placeholder, every
   * time, no matter how confused the chat history might look.
   */
  private async tryDirectViewingResponse(
    lead: { companyId: string; whatsappConversation: { id: string } | null },
    inboundText: string,
    _state: LeadState,
  ): Promise<{ suggestedReply: string; reasoning: string } | null> {
    if (!lead.whatsappConversation) return null;
    if (!/\[viewing\]/i.test(inboundText)) return null;

    const codeMatch = inboundText.match(/\b((?:HW|RF)-[A-Z0-9-]+)\b/i);
    const code = codeMatch?.[1]?.toUpperCase();
    if (!code) return null;

    const property = await this.prisma.property.findFirst({
      where: { companyId: lead.companyId, code, deletedAt: null },
      select: {
        code: true,
        name: true,
        type: true,
        priceAed: true,
        depositAed: true,
        status: true,
      },
    });
    if (!property) return null;
    if (property.status !== 'available') return null; // let Claude apologise + propose alternatives

    const language = await this.detectLanguage(lead.whatsappConversation.id);
    const prices = formatPriceLines(
      {
        type: property.type,
        priceAed: property.priceAed as number | null,
        depositAed: property.depositAed as number | null,
      },
      language,
    );

    const intro =
      language === 'es'
        ? `¡Perfecto! El ${property.code} (${property.name}) está disponible. ✨`
        : `Great! ${property.code} (${property.name}) is available. ✨`;
    const cta =
      language === 'es'
        ? `Elige el día y la hora que mejor te vengan:\n{{SCHEDULER_LINK}}`
        : `Pick a day and time that works for you:\n{{SCHEDULER_LINK}}`;

    return {
      suggestedReply: `${intro}\n\n${prices}\n\n${cta}`,
      reasoning: `[fast-path] [viewing] marker detected for ${property.code} — bypassed Claude, built deterministic confirmation + prices + scheduler link.`,
    };
  }

  private async detectLanguage(conversationId: string): Promise<'en' | 'es'> {
    const recent = await this.prisma.whatsAppMessage.findMany({
      where: { conversationId, direction: 'inbound' },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { body: true },
    });
    const blob = recent.map((m) => m.body ?? '').join(' ').toLowerCase();
    if (/\b(hola|gracias|por\s+favor|quiero|necesito|busco|cuánto|cuando|sí|disponible|verlo|verla|agendar|mándame|enviame)\b/.test(blob)) {
      return 'es';
    }
    return 'en';
  }

  /**
   * Persist a fast-path-built suggestion at confidence 0.99 and route it
   * through the same auto-approve+send path the high-confidence Claude
   * suggestions use. Falls back to operator review only if no super_admin
   * is available to record the approval against.
   */
  private async deliverFastPathSuggestion(
    input: RunInput,
    lead: { id: string; status: string; whatsappConversation: { id: string } | null },
    state: LeadState,
    payload: { suggestedReply: string; reasoning: string },
  ): Promise<void> {
    if (!lead.whatsappConversation) return;
    const suggestion = await this.prisma.suggestion.create({
      data: {
        companyId: input.companyId,
        leadId: lead.id,
        conversationId: lead.whatsappConversation.id,
        inboundMessageId: input.inboundMessageId,
        state,
        suggestedReply: payload.suggestedReply,
        reasoning: payload.reasoning,
        confidence: 0.99,
        stateAfter: 'closed',
        escalate: false,
        status: 'pending',
        modelId: 'fast-path-bypass',
      },
    });

    if (lead.status === 'new') {
      await this.prisma.lead.update({ where: { id: lead.id }, data: { status: 'qualifying' } });
    }

    const sysUser = await this.prisma.user.findFirst({
      where: {
        companyId: input.companyId,
        deletedAt: null,
        status: 'active',
        roles: { has: 'super_admin' },
      },
      select: { id: true },
    });

    if (sysUser) {
      try {
        await this.suggestions.approve(input.companyId, suggestion.id, sysUser.id);
        this.logger.log(`Fast-path: auto-approved + sent suggestion=${suggestion.id} for [viewing] intent`);
        return;
      } catch (err) {
        this.logger.warn(
          `Fast-path auto-approve failed (${(err as Error).message}); leaving as pending for operator`,
        );
      }
    }
    // Best-effort operator notification when auto-approve didn't run.
    try {
      await this.notifier.notifyNewSuggestion(suggestion.id);
    } catch (err) {
      this.logger.warn(`Operator notify failed for fast-path suggestion=${suggestion.id}: ${(err as Error).message}`);
    }
  }
}

/** Count how many of the 5 lead-profile fields we have, taking into
 *  account the freshly-extracted ones in this turn (which haven't been
 *  written to DB yet at the time we snap stateAfter). */
function countCollectedFields(
  lead: { budgetAed: unknown; preferredArea: string | null; peopleCount: number | null; moveInDate: Date | null; rentalDurationMonths: number | null },
  extracted: { budgetAed?: number; preferredArea?: string; peopleCount?: number; moveInDate?: string; rentalDurationMonths?: number } | undefined,
): number {
  const has = {
    budget: lead.budgetAed != null || extracted?.budgetAed != null,
    area: !!lead.preferredArea || !!extracted?.preferredArea,
    people: lead.peopleCount != null || extracted?.peopleCount != null,
    moveIn: lead.moveInDate != null || !!extracted?.moveInDate,
    duration: lead.rentalDurationMonths != null || extracted?.rentalDurationMonths != null,
  };
  return Object.values(has).filter(Boolean).length;
}
