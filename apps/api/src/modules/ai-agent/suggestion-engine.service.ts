import { Injectable, Logger } from '@nestjs/common';
import type { SystemBlock } from '@rentflow/ai';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviderRef } from './ai-provider.ref';

export type LeadState =
  | 'initial_contact'
  | 'collect_move_in_date'
  | 'collect_people_count'
  | 'collect_budget'
  | 'collect_area'
  | 'collect_duration'
  | 'qualify_lead'
  | 'suggest_property'
  | 'closed';

export interface GenerateSuggestionInput {
  companyId: string;
  leadId: string;
  conversationId: string;
  inboundMessageId: string;
  state: LeadState;
  /**
   * Present when generating a proactive re-engagement suggestion for a silent
   * lead. The engine adapts the prompt to write a follow-up nudge instead of
   * a reply to an inbound message.
   */
  proactive?: { hoursOfSilence: number };
}

export interface SuggestionPayload {
  suggestedReply: string;
  reasoning: string;
  confidence: number;
  stateAfter: LeadState | string;
  escalate: boolean;
}

export interface SuggestionResult {
  payload: SuggestionPayload | null;
  rawText: string;
  modelId: string;
  tokenUsage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
  latencyMs: number;
  errorMessage?: string;
}

const SUGGESTION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestedReply', 'reasoning', 'confidence', 'stateAfter', 'escalate'],
  properties: {
    suggestedReply: { type: 'string', description: 'The exact WhatsApp message body to send to the lead.' },
    reasoning: { type: 'string', description: '1-2 sentences explaining why this reply (operator-only).' },
    confidence: { type: 'number', description: '0.0-1.0 confidence in this suggestion.' },
    stateAfter: {
      type: 'string',
      enum: [
        'initial_contact',
        'collect_move_in_date',
        'collect_people_count',
        'collect_budget',
        'collect_area',
        'collect_duration',
        'qualify_lead',
        'suggest_property',
        'closed',
      ],
    },
    escalate: { type: 'boolean', description: 'true if a human operator should review urgently.' },
  },
};

@Injectable()
export class SuggestionEngineService {
  private readonly logger = new Logger(SuggestionEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRef: AiProviderRef,
  ) {}

  async generate(input: GenerateSuggestionInput): Promise<SuggestionResult> {
    const start = Date.now();

    const [lead, conversation, fewShot, properties] = await Promise.all([
      this.prisma.lead.findUnique({
        where: { id: input.leadId },
        include: { property: true },
      }),
      this.prisma.whatsAppConversation.findUnique({
        where: { id: input.conversationId },
        include: {
          messages: { orderBy: { createdAt: 'asc' }, take: 30 },
        },
      }),
      this.prisma.trainingExample.findMany({
        where: { companyId: input.companyId, enabled: true },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
      this.prisma.property.findMany({
        where: { companyId: input.companyId, deletedAt: null, status: 'available' },
        orderBy: { code: 'asc' },
        take: 25,
        select: {
          code: true,
          name: true,
          type: true,
          area: true,
          priceAed: true,
          occupancyMax: true,
          rentalMinMonths: true,
        },
      }),
    ]);

    if (!lead || !conversation) {
      throw new Error(`SuggestionEngine: lead or conversation not found (lead=${input.leadId})`);
    }

    const systemBlocks = this.buildSystemBlocks(properties, fewShot);
    const userPrompt = this.buildUserPrompt(lead, conversation, input.state, input.proactive);

    const provider = this.providerRef.provider;
    const modelId = process.env.AI_MODEL ?? 'claude-sonnet-4-6';

    try {
      const response = await provider.complete({
        systemBlocks,
        userPrompt,
        maxTokens: 800,
        jsonSchema: SUGGESTION_JSON_SCHEMA,
        model: modelId,
      });

      const latencyMs = Date.now() - start;
      const payload = this.coerceToPayload(response.parsedJson, response.text);

      return {
        payload,
        rawText: response.text,
        modelId: response.model ?? modelId,
        tokenUsage: {
          inputTokens: response.usage?.inputTokens,
          outputTokens: response.usage?.outputTokens,
          cacheReadInputTokens: response.usage?.cacheReadInputTokens,
          cacheCreationInputTokens: response.usage?.cacheCreationInputTokens,
        },
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = (err as Error).message;
      this.logger.error(`SuggestionEngine failed for lead=${input.leadId}: ${message}`);
      return {
        payload: null,
        rawText: '',
        modelId,
        tokenUsage: {},
        latencyMs,
        errorMessage: message,
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Prompt construction
  // ──────────────────────────────────────────────────────────────────────

  /**
   * System content has two cached prefixes:
   *   Block 1: brand voice + rules (very stable, rarely changes)
   *   Block 2: property catalog + few-shot examples (changes when inventory
   *     or training data changes — still cached within stable windows)
   *
   * Both end with `cacheControl: 'ephemeral'` so the provider creates 5-min
   * TTL cache breakpoints. Sonnet 4.6 minimum cacheable prefix is 2048
   * tokens; the brand block alone usually clears that bar.
   */
  private buildSystemBlocks(
    properties: Array<{
      code: string;
      name: string;
      type: string;
      area: string | null;
      priceAed: { toString(): string } | string | null;
      occupancyMax: number | null;
      rentalMinMonths: number | null;
    }>,
    fewShot: Array<{ state: string; aiSuggestion: string; operatorEdit: string; contextSnapshot: unknown }>,
  ): SystemBlock[] {
    const brandBlock = `
# RentFlow Agent — Lead Conversation Assistant

You are a sales assistant for a Dubai-based rental business. Your job is to suggest replies to potential renters who message us via WhatsApp.

## Context
- Business: short-term, monthly, and bed-space rentals in Dubai (UAE).
- Channel: WhatsApp. Use casual but professional tone — short sentences, no walls of text.
- Currency: AED. Timezone: Asia/Dubai.

## Voice
- Friendly and warm, but professional.
- Concise — WhatsApp users dislike long messages. Aim for ~1-3 short sentences.
- Use bullet points for lists when listing options or features.
- Use emojis sparingly (1-2 max, only when natural).
- Mirror the lead's language if they write in Spanish or Arabic; otherwise use English.
- Never use marketing buzzwords ("amazing opportunity!", "super awesome!").

## Hard rules — NEVER violate
1. Never confirm a property is available unless the property's status field says "available".
2. Never promise a price you weren't given explicitly in the property catalog.
3. ALWAYS push the lead toward scheduling a viewing — that is the goal of every conversation. You don't book the viewing yourself: when the lead is ready, the operator-approved next step is to send them the self-service scheduler link the system generates (a placeholder phrase the operator will replace, e.g. "I'll send you a link to pick a time"). Don't pick a date yourself.
4. Never share owner contact details.
5. Never discuss properties not in the catalog.
6. Escalate (escalate: true) if the lead is angry, complaining, talking about refunds, or asking about something outside rental discovery.
7. Escalate if the lead uses opt-out keywords (STOP, unsubscribe, "لا تراسلني").

## Mandatory disclosures — include in EVERY property recommendation
The lead MUST see, in the same message:
- **Monthly rent** in AED.
- **Refundable security deposit**: equal to 1 month's rent (state it explicitly: "Refundable deposit: AED <amount>").
- **One-time commission, paid on deal close**, based on bedrooms:
  - Studio or 1 bedroom: AED 1,000
  - 2 or 3 bedrooms: AED 2,000
  - 4+ bedrooms / villa: AED 3,000
  Phrase as: "Commission (one-time, on deal close): AED <amount>".
Do not omit any of the three numbers — leads who find out costs later feel ambushed and bounce.

## When recommending a specific property
When you recommend a specific property to the lead, ALWAYS include:
1. A one-line description (location + bedrooms + standout perk like "balcony with marina view")
2. The three mandatory numbers above (rent + deposit + commission)
3. The marketplace link so they can see all photos: \`${process.env.MARKETPLACE_BASE_URL ?? 'https://rentflow-agent.vercel.app'}/p/<CODE>\`
4. A direct nudge to schedule a viewing.

Format example (English, 1BR at AED 8,500):
"DreamLike Full Pool & Marina View Apartment in Dubai Marina — 1BR, sleeps 4.
Rent: AED 8,500/month
Refundable deposit: AED 8,500
Commission (one-time, on close): AED 1,000
Photos: https://rentflow-agent.vercel.app/p/HW-421030
Want to see it in person? Tell me and I'll send a link to pick a time."

Spanish:
"Apartamento con piscina y vista al puerto en Dubai Marina — 1 hab, hasta 4 personas.
Renta: AED 8,500 / mes
Depósito reembolsable: AED 8,500
Comisión (única, al cerrar): AED 1,000
Fotos: https://rentflow-agent.vercel.app/p/HW-421030
¿Quieres verlo? Te paso un link para que escojas día y hora."

The marketplace link replaces flooding chat with 10 photos. Paste the FULL https URL (no shorteners, no markdown). One property per recommendation when possible.

## When the lead lands directly on a listing (came from a /p/<code> link)
The first inbound after they click the marketplace 'Message on WhatsApp' button mentions the property code in the auto-text. Treat this as a hot lead:
1. Verify the property is still status='available' in the catalog. If NOT, apologise and ask what other constraints they have so you can suggest alternatives.
2. If available: confirm in one line, restate the three mandatory numbers (rent, deposit, commission), and IMMEDIATELY pivot to viewing — "Would you like to see it? I'll send a link to pick day and time."
3. Don't re-pitch features they already saw on the page.

## Workflow stages
The lead progresses through these stages. The current stage is given in the user prompt.
1. initial_contact — greet, identify what they want.
2. collect_move_in_date — ask "when?".
3. collect_people_count — ask "how many people?".
4. collect_budget — ask "what's your budget in AED?".
5. collect_area — ask "preferred area?".
6. collect_duration — ask "how long do you want to stay?".
7. qualify_lead — review what we have, summarize.
8. suggest_property — present the matching property with price and main features. Ask if they want a viewing.
9. closed — operator takes over for viewing scheduling.

Aim to advance ONE stage per message. Don't ask 5 questions at once. If the lead's reply doesn't have what you need (e.g. you asked for a date and they said "soon"), gently re-ask with examples.

## Output format
Respond ONLY with JSON matching this exact shape:
{
  "suggestedReply": "the WhatsApp message body to send (string, required)",
  "reasoning": "1-2 sentences why you chose this reply (string, required, internal only)",
  "confidence": 0.0 to 1.0 (number, required),
  "stateAfter": "next workflow stage if the lead replies usefully (string, required)",
  "escalate": false (boolean, required)
}

Do not include any text outside the JSON object.
`.trim();

    const propertyCatalogBlock = this.formatPropertyCatalog(properties);
    const fewShotBlock = this.formatFewShot(fewShot);

    const blocks: SystemBlock[] = [
      { text: brandBlock, cacheControl: 'ephemeral' },
      { text: `${propertyCatalogBlock}\n\n${fewShotBlock}`.trim(), cacheControl: 'ephemeral' },
    ];

    return blocks;
  }

  private formatPropertyCatalog(
    properties: Array<{
      code: string;
      name: string;
      type: string;
      area: string | null;
      priceAed: { toString(): string } | string | null;
      occupancyMax: number | null;
      rentalMinMonths: number | null;
    }>,
  ): string {
    if (properties.length === 0) {
      return '## Property Catalog\n\n(no available properties)';
    }
    const marketplaceBase =
      process.env.MARKETPLACE_BASE_URL ?? 'https://rentflow-agent.vercel.app';
    const rows = properties
      .map((p) => {
        const price = p.priceAed ? `AED ${Number(p.priceAed).toLocaleString()}/mo` : '—';
        const occ = p.occupancyMax ? `, ${p.occupancyMax} pax max` : '';
        const min = p.rentalMinMonths ? `, min ${p.rentalMinMonths}mo` : '';
        return `- ${p.code} (${p.type.replace(/_/g, ' ')}) in ${p.area ?? '—'}: ${price}${occ}${min} — ${p.name}\n  Link: ${marketplaceBase}/p/${p.code}`;
      })
      .join('\n');
    return `## Property Catalog (currently available)\n\n${rows}`;
  }

  private formatFewShot(
    examples: Array<{ state: string; aiSuggestion: string; operatorEdit: string; contextSnapshot: unknown }>,
  ): string {
    if (examples.length === 0) {
      return `## Operator-Curated Examples\n\n(none yet — your suggestions are unsupervised. Be conservative.)`;
    }
    const rendered = examples
      .map((ex, i) => {
        const ctx = typeof ex.contextSnapshot === 'string'
          ? ex.contextSnapshot
          : JSON.stringify(ex.contextSnapshot);
        return `### Example ${i + 1} (state: ${ex.state})\nContext: ${ctx}\nAI proposed: "${ex.aiSuggestion}"\nOperator corrected to: "${ex.operatorEdit}"`;
      })
      .join('\n\n');
    return `## Operator-Curated Examples (learn from these corrections)\n\n${rendered}`;
  }

  private buildUserPrompt(
    lead: { fullName: string | null; phoneE164: string; budgetAed: { toString(): string } | string | null; preferredArea: string | null; peopleCount: number | null; moveInDate: Date | null; rentalDurationMonths: number | null; property: { code: string; name: string; status: string; area: string | null; priceAed: { toString(): string } | string | null } | null },
    conversation: { messages: Array<{ direction: string; body: string | null; createdAt: Date }> },
    state: LeadState,
    proactive?: { hoursOfSilence: number },
  ): string {
    const profile = [
      `Name: ${lead.fullName ?? '(unknown)'}`,
      `Phone: ${lead.phoneE164}`,
      lead.property
        ? `Property of interest: ${lead.property.code} — ${lead.property.name} (${lead.property.status}, ${lead.property.priceAed ? `AED ${Number(lead.property.priceAed).toLocaleString()}` : 'price TBC'})`
        : 'Property of interest: not yet identified',
      lead.moveInDate ? `Collected: move-in ${lead.moveInDate.toISOString().slice(0, 10)}` : null,
      lead.peopleCount ? `Collected: ${lead.peopleCount} people` : null,
      lead.budgetAed ? `Collected: budget AED ${Number(lead.budgetAed).toLocaleString()}` : null,
      lead.preferredArea ? `Collected: prefers ${lead.preferredArea}` : null,
      lead.rentalDurationMonths ? `Collected: ${lead.rentalDurationMonths} months stay` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const lastMessages = conversation.messages
      .slice(-12)
      .map((m) => {
        const tag = m.direction === 'inbound' ? '[LEAD]' : '[US]';
        return `${tag} ${m.body ?? '(non-text)'}`;
      })
      .join('\n');

    if (proactive) {
      const hours = proactive.hoursOfSilence;
      const silenceWindow =
        hours >= 72 ? '3+ days' : hours >= 24 ? `${Math.round(hours / 24)} days` : `${hours} hours`;
      return `## Current workflow state: ${state}

## Lead profile
${profile}

## Conversation so far (oldest first)
${lastMessages || '(no messages yet)'}

## Task — proactive re-engagement
The lead has been silent for ${silenceWindow}. There is NO new inbound message to respond to. Suggest a brief, warm follow-up that:
- References what we already know about them (use the collected fields above)
- Re-engages without being pushy
- Asks one specific, easy-to-answer question
- Includes a soft "if you've moved on, no problem" out clause when silence is ≥ 24h

Respond with the JSON object only, no surrounding text. \`stateAfter\` should reflect what we'd transition to if they reply usefully.`;
    }

    return `## Current workflow state: ${state}

## Lead profile
${profile}

## Recent messages (oldest first)
${lastMessages}

## Task
Based on the recent messages and the workflow state, suggest the next reply to send. Respond with the JSON object only, no surrounding text.`;
  }

  private coerceToPayload(parsed: unknown, fallbackText: string): SuggestionPayload | null {
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>;
      if (typeof p['suggestedReply'] === 'string') {
        return {
          suggestedReply: p['suggestedReply'] as string,
          reasoning: typeof p['reasoning'] === 'string' ? (p['reasoning'] as string) : '',
          confidence: typeof p['confidence'] === 'number' ? (p['confidence'] as number) : 0.5,
          stateAfter: typeof p['stateAfter'] === 'string' ? (p['stateAfter'] as string) : 'closed',
          escalate: p['escalate'] === true,
        };
      }
    }
    if (fallbackText && fallbackText.trim().length > 0 && fallbackText.length < 4000) {
      return {
        suggestedReply: fallbackText.trim(),
        reasoning: '(unstructured fallback — model did not return JSON)',
        confidence: 0.3,
        stateAfter: 'closed',
        escalate: true,
      };
    }
    return null;
  }
}
