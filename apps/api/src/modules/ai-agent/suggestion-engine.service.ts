import { Injectable, Logger } from '@nestjs/common';
import type { SystemBlock, UserImage } from '@rentflow/ai';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviderRef } from './ai-provider.ref';
import { WhatsAppAdapterProvider } from '../whatsapp/adapter.provider';

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

export interface ExtractedFields {
  budgetAed?: number;
  preferredArea?: string;
  peopleCount?: number;
  moveInDate?: string; // ISO date YYYY-MM-DD
  rentalDurationMonths?: number;
}

export interface SuggestionPayload {
  suggestedReply: string;
  reasoning: string;
  confidence: number;
  stateAfter: LeadState | string;
  escalate: boolean;
  /** Fields the AI extracted from the lead's recent messages. The runner
   *  persists these onto the Lead row so multi-field replies aren't lost. */
  extractedFields?: ExtractedFields;
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
    suggestedReply: {
      type: 'string',
      description: 'The exact WhatsApp message body to send to the lead.',
    },
    reasoning: {
      type: 'string',
      description: '1-2 sentences explaining why this reply (operator-only).',
    },
    confidence: {
      type: 'number',
      description:
        'Calibrated confidence the operator should auto-send this reply. Scale: ' +
        '0.95+ = trivial reply where any phrasing works (greeting, single-fact answer from catalog, scheduler-link send-off). ' +
        '0.80-0.94 = clear intent but content depends on judgement (price negotiation, multiple-property comparison, follow-up tone). ' +
        '0.50-0.79 = ambiguous lead intent OR you had to interpret a partial answer. ' +
        'Below 0.50 = you are guessing or pattern-matching without confirmation. ' +
        'Auto-approve gate is 0.95 — anything below stays pending for the human operator.',
    },
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
    escalate: {
      type: 'boolean',
      description:
        'true if a human operator must review BEFORE this is sent. Concrete triggers: ' +
        '(a) lead is angry, frustrated, complaining about a real issue (broken link, no-show, refund request, scam accusation); ' +
        '(b) lead asks about something outside rental discovery (legal, immigration, jobs, tax); ' +
        '(c) lead is haggling on price below the catalog number; ' +
        '(d) lead asks you to break a hard rule (share owner contact, confirm unavailable property); ' +
        '(e) lead uses opt-out keywords (STOP, unsubscribe, لا تراسلني); ' +
        '(f) you genuinely cannot tell what the lead wants after re-reading the latest [LEAD] line. ' +
        'Do NOT escalate just because the conversation is long, or because you have low confidence — low confidence means "stays pending" not "escalate". ' +
        'Do NOT escalate based on stale grievances if the latest [LEAD] line has moved on.',
    },
    extractedFields: {
      type: 'object',
      description:
        'Lead profile fields you parsed from the most recent [LEAD] lines. ONLY include a field when the lead stated it explicitly in this conversation — do NOT infer or guess. Omit the field entirely (do not send null) if not present. The system merges these into the Lead row so they persist across turns.',
      additionalProperties: false,
      properties: {
        budgetAed: {
          type: 'number',
          description: 'Monthly budget in AED, only if the lead said a number (e.g. "AED 4000", "4k aed", "around 5,000").',
        },
        preferredArea: {
          type: 'string',
          description: 'Area in Dubai the lead asked for (e.g. "Marina", "JBR", "Downtown"). Free text, lowercased OK.',
        },
        peopleCount: {
          type: 'integer',
          description: 'Total occupants if explicitly mentioned ("for 2 people", "I am alone" → 1, "with my wife and 2 kids" → 4).',
        },
        moveInDate: {
          type: 'string',
          description: 'ISO date YYYY-MM-DD if the lead gave a specific date or relative ("next Monday" → resolve relative to today). Omit if vague ("soon", "this month").',
        },
        rentalDurationMonths: {
          type: 'integer',
          description: 'Stay duration in months if explicit ("for 3 months", "1 year" → 12, "few weeks" → omit).',
        },
      },
    },
  },
};

@Injectable()
export class SuggestionEngineService {
  private readonly logger = new Logger(SuggestionEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRef: AiProviderRef,
    private readonly waAdapter: WhatsAppAdapterProvider,
  ) {}

  async generate(input: GenerateSuggestionInput): Promise<SuggestionResult> {
    const start = Date.now();

    const [lead, conversation, fewShot, properties, viewings] = await Promise.all([
      this.prisma.lead.findUnique({
        where: { id: input.leadId },
        include: { property: true },
      }),
      this.prisma.whatsAppConversation.findUnique({
        where: { id: input.conversationId },
        include: {
          // Pull 60 messages so we can render "first N + last M" in the
          // user prompt — keeps early intent and recent context without
          // dropping the middle entirely (which broke continuity in long
          // conversations).
          messages: { orderBy: { createdAt: 'asc' }, take: 60 },
        },
      }),
      this.prisma.trainingExample.findMany({
        where: { companyId: input.companyId, enabled: true },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        // 15 examples (was 5) — gives Claude more diverse correction
        // patterns to learn from, especially the longer-tail edge cases
        // that the 5 most-recent rarely covered.
        take: 15,
      }),
      this.prisma.property.findMany({
        where: {
          companyId: input.companyId,
          deletedAt: null,
          status: 'available',
          // Operator-controlled availability: only offer properties that have
          // at least one Fast Posting package in a publish-worthy state.
          // 'paused', 'archived', 'failed', 'draft' don't count — if the
          // operator paused all posts, the property is off-market.
          postPackages: {
            some: {
              deletedAt: null,
              status: { in: ['generated', 'scheduled', 'pending_approval', 'approved', 'published'] },
            },
          },
        },
        orderBy: { code: 'asc' },
        take: 25,
        select: {
          code: true,
          name: true,
          type: true,
          area: true,
          priceAed: true,
          depositAed: true,
          occupancyMax: true,
          rentalMinMonths: true,
          // Field-agent answers to the PropertyDetailQuestion catalogue.
          // Surfaced in the prompt so Claude can answer guest FAQs ("how
          // many people live there?", "private bathroom?", "daily cleaning?")
          // without falling back to "let me check and get back to you".
          details: true,
        },
      }),
      this.prisma.viewing.findMany({
        where: {
          leadId: input.leadId,
          status: { in: ['requested', 'confirmed', 'assigned', 'rescheduled'] },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 5,
        select: {
          status: true,
          scheduledAt: true,
          property: { select: { code: true, name: true } },
        },
      }),
    ]);

    if (!lead || !conversation) {
      throw new Error(`SuggestionEngine: lead or conversation not found (lead=${input.leadId})`);
    }

    // Cross-sell signal: if the lead asked about a specific property but
    // that property is no longer in the offerable catalog (paused, blocked,
    // rented, etc.), tell Claude explicitly so it doesn't keep claiming
    // "available!" and can pivot to alternatives in the offerable list.
    const requestedOffMarket =
      !!lead.property &&
      !properties.some((p) => p.code === lead.property!.code);

    const systemBlocks = this.buildSystemBlocks(properties, fewShot);

    // Vision: when the guest's most recent inbound was an image (often a
    // screenshot of a listing or a Google Maps drop pin), pull the bytes
    // from the WhatsApp Cloud API and attach to the user turn so Claude
    // can actually look at it. Limit to the last 2 inbound media — anything
    // older is usually noise and balloons the prompt.
    const userImages = await this.collectRecentInboundImages(conversation.messages);
    const hasImages = userImages.length > 0;
    const userPrompt = this.buildUserPrompt(
      lead,
      conversation,
      input.state,
      viewings,
      input.proactive,
      requestedOffMarket,
      hasImages,
    );

    const provider = this.providerRef.provider;
    const modelId = process.env.AI_MODEL ?? 'claude-sonnet-4-6';

    try {
      const response = await provider.complete({
        systemBlocks,
        userPrompt,
        userImages: hasImages ? userImages : undefined,
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
      depositAed: { toString(): string } | string | null;
      occupancyMax: number | null;
      rentalMinMonths: number | null;
      details: unknown;
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
3. ALWAYS push the lead toward scheduling a viewing — that is the goal of every conversation. You don't pick the date yourself; the lead picks it via a self-service scheduler page. When you want to send the booking link, write the LITERAL placeholder \`{{SCHEDULER_LINK}}\` on its own line where the URL should appear — the system replaces it with a real one-time URL before the message is sent. Never invent a URL.

CRITICAL — the placeholder MUST be EXACTLY \`{{SCHEDULER_LINK}}\` (double curly braces, that exact ASCII name, no translation). The following are ALL WRONG and will reach the lead as literal broken text:
- \`<BOOKING_LINK>\`, \`<SCHEDULER_LINK>\`, \`<LINK>\`, \`<URL>\`
- \`[BOOKING_LINK]\`, \`[VIEWING_LINK]\`, \`[LINK]\`, \`[URL]\`
- \`[INSERTAR LINK DE AGENDAMIENTO]\`, \`[INSERTAR EL LINK]\`, \`[PEGAR LINK]\`, \`[LINK DE AGENDAMIENTO]\`, \`[LINK DE RESERVA]\`
- Any Spanish/French/Arabic phrase in brackets describing where the link goes
- Any blank space, "...", or empty bracket where you expect the URL

If you are writing in Spanish, the placeholder is STILL the English string \`{{SCHEDULER_LINK}}\`. Do not translate it. Do not localize it. Just write \`{{SCHEDULER_LINK}}\` exactly. The system replaces those exact characters and nothing else.
4. Never share owner contact details.
5. Never discuss properties not in the catalog.
6. Escalate (escalate: true) if the lead is angry, complaining, talking about refunds, or asking about something outside rental discovery. BUT: only escalate if the LATEST [LEAD] line itself contains the complaint or refund-talk. A new, fresh question from the lead must be answered as a fresh question — never escalate based on stale history when the most recent message is a clean new request.
7. Escalate if the lead uses opt-out keywords (STOP, unsubscribe, "لا تراسلني").
8. ANSWER THE LATEST INBOUND. The newest [LEAD] line — and any [LEAD] lines that came after the most recent [US] line — define what the lead is asking RIGHT NOW. Do NOT respond to grievances buried in older history if the latest message has moved on. If the latest message names a different property code, asks a different question, or makes a fresh request, that is what you answer.
9. BOOK-VIEWING INTENT IS A HARD SIGNAL. If the latest [LEAD] line contains the marker \`[viewing]\` (sent by the marketplace 'Book a viewing' button) OR any of: "book a viewing", "agendar visita", "ver el apartamento", "I'd like to see it", "quiero verlo", "schedule a viewing", "send the link", "mándame el link" — the correct reply has THIS exact shape and nothing else: (a) one-line confirmation the property is available, (b) the three numbers (rent + deposit + commission) on their own three lines, (c) the placeholder \`{{SCHEDULER_LINK}}\` on its own line. DO NOT escalate, DO NOT ask qualifying questions, DO NOT apologise for past link issues. The link without the three numbers is forbidden — leads who have not seen pricing must not be sent to the scheduler.
10. NEW PROPERTY CODE = NEW INTENT. If the latest [LEAD] line names a property code (HW-XXXX, RF-XXX, etc.) that is NOT in the "Confirmed/active viewings" block, the lead is interested in a NEW property. Treat it as a fresh hot lead — confirm availability, restate the three numbers (always — even if they saw rent earlier, restate them all together with the deposit and commission), pivot to viewing. Past unresolved tickets on OTHER properties are irrelevant to this new request.
11. PRICES ARE A FILTER. Never send the scheduler link without the three numbers (rent, deposit, commission) appearing in the same outgoing message. Vague-price leads who can't afford the property waste the field agent's time — being explicit upfront filters them. The numbers must come from the property catalog you were given; do not invent them. If the catalog row is missing a value, write "TBC" rather than guessing.

## Mandatory disclosures — include in EVERY property recommendation
The lead MUST see, in the same message:
- **Monthly rent** in AED — use the property's "rent" from the catalog.
- **Refundable security deposit** — use the property's "deposit" from the catalog. NEVER assume rent = deposit; if the catalog shows a deposit number that differs from rent, use the deposit. Only when the catalog explicitly notes "no explicit deposit set" do you fall back to "= 1 month's rent". State as "Refundable deposit: AED <amount>".
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
Want to see it in person? Pick a day and time here:
{{SCHEDULER_LINK}}"

Spanish:
"Apartamento con piscina y vista al puerto en Dubai Marina — 1 hab, hasta 4 personas.
Renta: AED 8,500 / mes
Depósito reembolsable: AED 8,500
Comisión (única, al cerrar): AED 1,000
Fotos: https://rentflow-agent.vercel.app/p/HW-421030
¿Quieres verlo? Elige día y hora aquí:
{{SCHEDULER_LINK}}"

The marketplace link replaces flooding chat with 10 photos. Paste the FULL https URL (no shorteners, no markdown). One property per recommendation when possible.

## When the lead lands directly on a listing (came from a /p/<code> link)
The first inbound after they click the marketplace 'Message on WhatsApp' button mentions the property code in the auto-text. Treat this as a hot lead:
1. Verify the property is still status='available' in the catalog. If NOT, apologise and ask what other constraints they have so you can suggest alternatives.
2. If available: confirm in one line, restate the three mandatory numbers (rent, deposit, commission), and IMMEDIATELY pivot to viewing — "Would you like to see it? Pick a day and time here:\n{{SCHEDULER_LINK}}"
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

## Multi-field extraction — important
Leads frequently pack multiple facts into one message: "I am 2 people, 4000 budget, marina, moving in Feb". When that happens, EXTRACT EVERY FIELD they stated into \`extractedFields\` in your output JSON, then move the workflow to the next un-collected field. Don't drop facts because the current state is "collect_budget" — if the lead also gave you area and people count, capture them too.

Rules for \`extractedFields\`:
- Only include a field when the lead said it explicitly. Never infer.
- Skip the field entirely (don't send null) if the lead didn't mention it.
- For \`moveInDate\` accept only a real date — "soon", "this month", "ASAP" → omit.
- For \`peopleCount\` count people who will sleep there: "for 2 people" → 2. "alone" → 1. "with my wife" → 2. "with my wife and son" → 3.
- For \`budgetAed\` parse the number even if formatted as "4k", "5,000", "AED 4000". Reject ranges ("3-5k") — omit instead.

## Confidence calibration — be strict
The system auto-sends suggestions with confidence ≥ 0.95 without operator review. Below that, the human reviews. Calibrate honestly:
- **0.95-1.0**: only for replies a junior teammate would send identically. Plain greeting, single fact-lookup, scheduler send-off after price was confirmed, simple confirmation.
- **0.80-0.94**: clear intent but content is judgement-dependent — comparing 2 properties, handling a polite price push-back, choosing follow-up tone.
- **0.50-0.79**: lead's request is ambiguous OR you interpreted a partial answer.
- **< 0.50**: you are guessing.

Do NOT inflate confidence to 0.9+ just to skip operator review — operators catch wrong info you missed. When unsure, undershoot: 0.7 is a safe default.

## Stage advancement — be honest
Set \`stateAfter\` to the stage the conversation would land in *after a useful reply*. Don't jump to \`suggest_property\` until you actually have enough lead profile (at least 2 of: budget, area, moveInDate). Don't set \`closed\` unless the lead explicitly said no/won/lost. The system rejects implausible jumps server-side and snaps you back to a collect_* state — keep yourself out of that path by being honest.

## Output format
Respond ONLY with JSON matching this exact shape:
{
  "suggestedReply": "the WhatsApp message body to send (string, required)",
  "reasoning": "1-2 sentences why you chose this reply (string, required, internal only)",
  "confidence": 0.0 to 1.0 (number, required, calibrated per scale above),
  "stateAfter": "next workflow stage if the lead replies usefully (string, required)",
  "escalate": false (boolean, required, see triggers in schema description),
  "extractedFields": { ...optional, only fields the lead stated explicitly... }
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
      depositAed: { toString(): string } | string | null;
      occupancyMax: number | null;
      rentalMinMonths: number | null;
      details: unknown;
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
        const deposit = p.depositAed
          ? `AED ${Number(p.depositAed).toLocaleString()}`
          : p.priceAed
          ? `AED ${Number(p.priceAed).toLocaleString()} (= 1 month, no explicit deposit set)`
          : '—';
        const occ = p.occupancyMax ? `, ${p.occupancyMax} pax max` : '';
        const min = p.rentalMinMonths ? `, min ${p.rentalMinMonths}mo` : '';
        const facts = formatDetailsForCatalog(p.details);
        return `- ${p.code} (${p.type.replace(/_/g, ' ')}) in ${p.area ?? '—'}: rent ${price}, deposit ${deposit}${occ}${min} — ${p.name}${facts}\n  Link: ${marketplaceBase}/p/${p.code}`;
      })
      .join('\n');
    return `## Property Catalog (currently available)\n\n${rows}\n\n` +
      `The "Facts" line above each property comes directly from the field agent's interview with the owner. ` +
      `When a lead asks about occupancy, nationalities, bathroom (private/shared), cleaning service or other living conditions, ` +
      `ANSWER FROM THESE FACTS. Do NOT say "let me check and get back to you" if the answer is in the Facts line. ` +
      `If the relevant fact is missing, say so honestly and offer to find out — then escalate.`;
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

  /**
   * Pull the last ≤2 inbound media messages from the conversation, fetch
   * the bytes via the WhatsApp adapter, return as base64 vision blocks.
   * Quietly returns an empty array on any download failure — we'd rather
   * answer without the image than fail the whole suggestion.
   */
  private async collectRecentInboundImages(
    messages: Array<{ direction: string; type: string; mediaUrl: string | null }>,
  ): Promise<UserImage[]> {
    const adapter = this.waAdapter.adapter;
    if (!adapter.fetchInboundMedia) return [];
    const candidates = messages
      .filter((m) => m.direction === 'inbound' && m.type === 'image' && m.mediaUrl)
      .slice(-2);
    const out: UserImage[] = [];
    for (const m of candidates) {
      const fetched = await adapter.fetchInboundMedia(m.mediaUrl as string);
      if (!fetched) continue;
      // Anthropic vision accepts jpeg/png/webp/gif. Anything else → skip.
      const mt = fetched.mimeType.toLowerCase();
      const supported = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
      const mediaType = supported.find((s) => mt.startsWith(s));
      if (!mediaType) continue;
      out.push({ base64: fetched.bytes.toString('base64'), mediaType });
    }
    return out;
  }

  private buildUserPrompt(
    lead: { fullName: string | null; phoneE164: string; budgetAed: { toString(): string } | string | null; preferredArea: string | null; peopleCount: number | null; moveInDate: Date | null; rentalDurationMonths: number | null; property: { code: string; name: string; status: string; area: string | null; priceAed: { toString(): string } | string | null } | null },
    conversation: { messages: Array<{ direction: string; body: string | null; createdAt: Date }> },
    state: LeadState,
    viewings: Array<{ status: string; scheduledAt: Date; property: { code: string; name: string } | null }>,
    proactive?: { hoursOfSilence: number },
    requestedOffMarket?: boolean,
    hasImages?: boolean,
  ): string {
    const profile = [
      `Name: ${lead.fullName ?? '(unknown)'}`,
      `Phone: ${lead.phoneE164}`,
      lead.property
        ? `Property of interest: ${lead.property.code} — ${lead.property.name} (${lead.property.status}, ${lead.property.priceAed ? `AED ${Number(lead.property.priceAed).toLocaleString()}` : 'price TBC'})${requestedOffMarket ? ' ⚠ OFF-MARKET — do NOT claim availability, pivot to alternatives below.' : ''}`
        : 'Property of interest: not yet identified',
      lead.moveInDate ? `Collected: move-in ${lead.moveInDate.toISOString().slice(0, 10)}` : null,
      lead.peopleCount ? `Collected: ${lead.peopleCount} people` : null,
      lead.budgetAed ? `Collected: budget AED ${Number(lead.budgetAed).toLocaleString()}` : null,
      lead.preferredArea ? `Collected: prefers ${lead.preferredArea}` : null,
      lead.rentalDurationMonths ? `Collected: ${lead.rentalDurationMonths} months stay` : null,
    ]
      .filter(Boolean)
      .join('\n');

    // Render first 5 (early intent — "I want a 1BR in Marina under 5k") +
    // last 20 (current state). When total ≤ 25 we just show all of them.
    // Insert a "…" marker if we drop messages from the middle so Claude
    // knows there's a gap rather than treating it as continuous flow.
    const totalMsgs = conversation.messages.length;
    let renderedMsgs: string[];
    if (totalMsgs <= 25) {
      renderedMsgs = conversation.messages.map(formatMsg);
    } else {
      const head = conversation.messages.slice(0, 5).map(formatMsg);
      const tail = conversation.messages.slice(-20).map(formatMsg);
      const dropped = totalMsgs - head.length - tail.length;
      renderedMsgs = [...head, `[…${dropped} earlier messages omitted to save context…]`, ...tail];
    }
    const lastMessages = renderedMsgs.join('\n');

    const viewingsBlock = viewings.length === 0
      ? '(none — no viewings booked yet)'
      : viewings
          .map((v) => {
            const when = v.scheduledAt.toISOString().slice(0, 16).replace('T', ' ');
            const propLabel = v.property ? `${v.property.code} — ${v.property.name}` : '(unknown property)';
            return `- [${v.status}] ${when} UTC · ${propLabel}`;
          })
          .join('\n');

    if (proactive) {
      const hours = proactive.hoursOfSilence;
      const silenceWindow =
        hours >= 72 ? '3+ days' : hours >= 24 ? `${Math.round(hours / 24)} days` : `${hours} hours`;
      return `## Current workflow state: ${state}

## Lead profile
${profile}

## Confirmed/active viewings for this lead
${viewingsBlock}

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

    const offMarketDirective = requestedOffMarket
      ? `

## Cross-sell directive (REQUESTED PROPERTY IS OFF-MARKET)
The property the lead asked about is paused/blocked/rented. DO NOT say "yes, available" or send its viewing link.
Instead: apologise briefly ("Just got booked, sorry") and propose 2-3 alternatives from the catalog above that match
either the lead's stated area, price range (within ±20% of the requested property), or their explicit preferences.
Keep it warm and forward-moving — never dead-end.`
      : '';

    const visionDirective = hasImages
      ? `

## Vision input
The image(s) attached to this turn were sent by the lead via WhatsApp. They are likely screenshots of one of
OUR listings (Facebook/Telegram/IG post), a competitor's listing, or a Google Maps drop pin. Read them carefully:
- If the image shows one of OUR properties (match by visible RF-CODE, price, address, or photo), confirm the
  exact property they're asking about and treat it as identified — don't ask "which one?".
- If it's a competitor listing or you can't recognise it, ask one short clarifying question
  ("Got the picture — can you tell me roughly where it is and the price?") rather than guessing.
- If it's a map pin, name the area you see and confirm before assuming.`
      : '';

    return `## Current workflow state: ${state}

## Lead profile
${profile}

## Confirmed/active viewings for this lead
${viewingsBlock}

## Recent messages (oldest first)
${lastMessages}
${offMarketDirective}${visionDirective}

## Task
The lead may have sent several short [LEAD] lines in a row before pausing — treat every [LEAD] line that appears AFTER the most recent [US] line as a single combined question and answer ALL of them together in one reply. Don't ignore earlier [LEAD] lines just because a newer one arrived.

If a viewing already appears in "Confirmed/active viewings" above, DO NOT propose scheduling a new one for the same property. Reference the existing booking. If the lead asks about a DIFFERENT property than the one booked, treat it as a new property of interest — recommend it normally.

If the lead is complaining about a problem ("link broken", "no funciona") and the latest [US] message DID send a working link or a viewing was confirmed AFTER the complaint, the complaint is stale — acknowledge resolution rather than escalating again.

Respond with the JSON object only, no surrounding text.`;
  }

  private extractFields(parsed: unknown): ExtractedFields | undefined {
    if (!parsed || typeof parsed !== 'object') return undefined;
    const ef = (parsed as Record<string, unknown>)['extractedFields'];
    if (!ef || typeof ef !== 'object') return undefined;
    const e = ef as Record<string, unknown>;
    const out: ExtractedFields = {};
    if (typeof e['budgetAed'] === 'number') out.budgetAed = e['budgetAed'] as number;
    if (typeof e['preferredArea'] === 'string') out.preferredArea = (e['preferredArea'] as string).trim();
    if (typeof e['peopleCount'] === 'number' && Number.isInteger(e['peopleCount'])) {
      out.peopleCount = e['peopleCount'] as number;
    }
    if (typeof e['moveInDate'] === 'string') {
      const s = (e['moveInDate'] as string).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) out.moveInDate = s.slice(0, 10);
    }
    if (typeof e['rentalDurationMonths'] === 'number' && Number.isInteger(e['rentalDurationMonths'])) {
      out.rentalDurationMonths = e['rentalDurationMonths'] as number;
    }
    return Object.keys(out).length > 0 ? out : undefined;
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
          extractedFields: this.extractFields(parsed),
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

function formatMsg(m: { direction: string; body: string | null }): string {
  const tag = m.direction === 'inbound' ? '[LEAD]' : '[US]';
  return `${tag} ${m.body ?? '(non-text)'}`;
}

/** Render the PropertyDetailQuestion answers from Property.details as a
 *  one-line "Facts" suffix appended to a catalog row. Keeps the prompt
 *  compact (we render at most ~6 facts per property) and only emits the
 *  line when at least one answer is present. */
function formatDetailsForCatalog(details: unknown): string {
  if (!details || typeof details !== 'object') return '';
  const entries = Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
    .slice(0, 8);
  if (entries.length === 0) return '';
  const formatted = entries
    .map(([k, v]) => {
      const key = k.replace(/_/g, ' ');
      if (Array.isArray(v)) return `${key}=${(v as unknown[]).join('/')}`;
      if (typeof v === 'boolean') return `${key}=${v ? 'yes' : 'no'}`;
      return `${key}=${String(v)}`;
    })
    .join('; ');
  return `\n  Facts (from owner): ${formatted}`;
}
