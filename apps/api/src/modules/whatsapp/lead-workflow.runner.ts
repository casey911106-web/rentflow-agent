import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
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
 */
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
    const state = (session?.state as LeadState | undefined) ?? 'initial_contact';

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
}
