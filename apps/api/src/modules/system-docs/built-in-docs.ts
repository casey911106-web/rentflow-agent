import type { SystemDoc } from './system-docs.types';

/**
 * Single source of truth for in-system documentation.
 *
 * Every automation, feature, and integration that the operator should know
 * about lives here. When you change the behavior of any of them, update the
 * matching entry in the same commit — code review enforces it.
 *
 * Each entry's `sourceFiles` points to where the implementation lives so
 * support and debugging can trace the runtime behavior back to code.
 */
export const BUILT_IN_DOCS: SystemDoc[] = [
  // ──────────────────────────────────────────────────────────────────
  // AUTOMATIONS
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'lead-followup-sweep',
    category: 'automation',
    name: 'Lead follow-up sweep',
    shortDescription:
      'Within the lead\'s open 24h WhatsApp window, generates 4 nudge Suggestions at 30 min, 6 h, 20 h and 23.5 h after our last reply. NEVER fires once the window is closed.',
    longDescription:
      'Every 5 minutes the scheduler scans active leads (status not won/lost/opted_out) whose conversation is in AI mode. For each lead it loads the last inbound and last outbound timestamps. If more than 24 hours have passed since the lead\'s last inbound, the lead is skipped — the Meta customer-service window is closed and we do not pay for re-engagement templates. Otherwise it computes minutes-since-our-last-reply and matches one of four tiers:\n\n  • 30 min — soft nudge, one-line, "got distracted?" energy\n  • 6 h    — warm follow-up, ask if they have a question\n  • 20 h   — closing tone, "anything else you wanted to know?"\n  • 23.5 h — last call before the window closes for 24h, "we are here if you need anything"\n\nFor each tier window the system asks Claude in proactive mode for a context-aware nudge and creates a *pending* Suggestion. Proactive Suggestions NEVER auto-approve regardless of confidence — every single one needs operator approval (Approve / Edit / Cancel) via WhatsApp buttons or the dashboard. The same tier never fires twice for the same lastOutbound timestamp.',
    schedule: 'Every 5 minutes',
    triggers: ['Cron'],
    effects: [
      'Skips any lead whose lastInbound is older than 24 h (Meta window closed)',
      'Creates one *pending* Suggestion per matched tier window — no auto-approve',
      'Tier dedup: each tier (30 min / 6 h / 20 h / 23.5 h) only fires once between operator replies',
      'Stamps Lead.lastFollowUpAt for analytics',
      'Notifies the operator via WhatsApp interactive buttons (if OPERATOR_WHATSAPP_E164 is set and operator has an open 24 h window)',
    ],
    configurables: [
      { key: 'OPERATOR_WHATSAPP_E164', description: 'Operator phone E.164. When set, suggestions are pushed here with buttons.' },
      { key: 'AI_PROVIDER', default: 'anthropic', description: 'mock for dev, anthropic for prod.' },
      { key: 'AI_MODEL', default: 'claude-sonnet-4-6' },
    ],
    rationale:
      'A lead replies, we reply, they go quiet. Within the 24 h Meta window every reply we send is free, so we have a tight budget of nudges to reactivate them: a soft 30-min poke, a warmer 6h check-in, a "anything else?" at 20h and a final "we\'re here" at 23.5h right before the window slams shut. Past 24h we stop entirely because pushing a UTILITY/MARKETING template costs real money — we will only enable that lane once the unit economics justify it.',
    observability: [
      'Logs lines like `Lead follow-up sweep: generated=N skipped=N`',
      'Token usage for each Suggestion is recorded in Suggestion.inputTokens / outputTokens / cacheReadTokens',
      'Empty inbox after a sweep with active leads = look at the API logs for skipped reasons',
    ],
    sourceFiles: [
      'apps/api/src/modules/automation/lead-followup.scheduler.ts',
      'apps/api/src/modules/ai-agent/suggestion-engine.service.ts',
    ],
    link: '/suggestions',
  },
  {
    id: 'owner-availability-sweep',
    category: 'automation',
    name: 'Owner availability sweep',
    shortDescription:
      'Daily WhatsApp ping to property owners asking if their unit is still available. Updates Property.status from their reply automatically.',
    longDescription:
      'Every day at 10:00 Asia/Dubai (06:00 UTC), the system scans every property whose `availabilityConfirmedAt` is older than 24h or null. For each, it sends a direct WhatsApp message to the owner: *"Hi {firstName}, this is RentFlow Agent. Quick check — is RF-001 still available? Reply Yes / Rented / Available from <date> / Price changed."* It then creates an `OwnerAvailabilityCheck` row with status `pending_response`. Anti-spam: skips properties that already received a check in the last 23h.',
    schedule: 'Daily at 10:00 Asia/Dubai',
    triggers: ['Cron', 'Manual via POST /automation/run-owner-availability-sweep'],
    effects: [
      'Sends a plain-text WhatsApp message to each owner who has an active 24h customer-service window',
      'Creates an OwnerAvailabilityCheck row for tracking',
      'Logs an OwnerMessage record',
      'If outside the 24h window, the send fails — the check is marked needs_clarification and surfaces on the owner detail page for the operator to handle manually',
    ],
    configurables: [
      { key: 'WHATSAPP_ADAPTER', default: 'cloud', description: 'Set to "mock" for dev to skip real sends.' },
      { key: 'WHATSAPP_CLOUD_API_*', description: 'Required Meta credentials for real outbound.' },
    ],
    rationale:
      'Stale availability is the #1 cause of wasted operator time. A daily sweep keeps inventory ≤ 24h fresh without humans remembering to ask.',
    observability: [
      'Logs `Owner availability sweep: pinged=N skipped=N`',
      'Failed sends are visible in OwnerMessage.metadata.error',
      'Sudden drop in pings = check that ownerId is set on properties (orphan properties skip)',
    ],
    sourceFiles: ['apps/api/src/modules/automation/owner-availability.scheduler.ts'],
  },
  {
    id: 'owner-reply-parser',
    category: 'automation',
    name: 'Owner reply parser',
    shortDescription:
      'Auto-classifies inbound messages from registered owners and updates Property.status without operator intervention.',
    longDescription:
      'When a WhatsApp message arrives, the InboundRouter checks if the sender is a registered Owner with a pending OwnerAvailabilityCheck. If so, the parser classifies the reply using regex heuristics: `available`, `rented`, `rented until <date>`, `available from <date>`, `blocked`, `price_changed`, or `unclear`. It updates `Property.status`, `Property.availabilityConfirmedAt`, `Property.rentedUntil` accordingly, and marks the check as resolved. Ambiguous replies stay as `needs_clarification` for the operator.',
    triggers: ['Inbound WhatsApp message from a known Owner E.164'],
    effects: [
      'Updates Property.status (available / rented / blocked / unavailable)',
      'Updates Property.availabilityConfirmedAt',
      'Marks OwnerAvailabilityCheck as resolved with parsed metadata',
      'Creates an OwnerMessage (inbound) for the audit trail',
    ],
    configurables: [],
    rationale:
      'Owners are mechanical signal — they say "yes" or "rented" and we update status. No reason to make the operator click through every confirmation.',
    observability: [
      'Logs `Owner X reply parsed as <status>`',
      'Failed classifications surface as OwnerAvailabilityCheck.status = needs_clarification on the owner detail page',
    ],
    sourceFiles: ['apps/api/src/modules/automation/owner-reply.parser.ts'],
  },
  {
    id: 'lead-workflow-runner',
    category: 'automation',
    name: 'Lead workflow runner',
    shortDescription:
      'On every inbound lead message, generates a Claude-powered Suggestion for the operator to approve, edit, or cancel.',
    longDescription:
      'When a WhatsApp message arrives from a lead (not from an owner or operator), the runner: (1) checks the conversation mode — skip if human_takeover or closed, (2) checks for opt-out keywords like STOP, (3) reads the current AIAgentSession state, (4) calls the SuggestionEngine which builds a cached prompt with brand voice + property catalog + few-shot examples and calls Claude Sonnet 4.6, (5) saves the result as a `pending` Suggestion. **Nothing is sent to the lead automatically** — the operator decides via the dashboard inbox or the WhatsApp button message.',
    triggers: ['Inbound WhatsApp message from a lead phone'],
    effects: [
      'Creates a Suggestion with state, suggestedReply, reasoning, confidence, stateAfter, escalate flag',
      'Captures token usage and latency for observability',
      'Pushes notification to operator phone (if OPERATOR_WHATSAPP_E164 is set)',
      'Creates failed Suggestions when Claude errors so the operator sees them',
    ],
    configurables: [
      { key: 'AI_PROVIDER', default: 'anthropic' },
      { key: 'AI_API_KEY', description: 'Anthropic API key.' },
      { key: 'AI_MODEL', default: 'claude-sonnet-4-6' },
    ],
    rationale:
      'AI for content quality, human for judgment. Operator stays accountable for what the lead receives. Edits become training data that improves future suggestions.',
    observability: [
      'Token + latency stats on each Suggestion card in the inbox',
      'Cache hit ratio (cacheReadTokens / inputTokens) shows how well prompt caching is working — should be ≥ 80% after warm-up',
    ],
    sourceFiles: [
      'apps/api/src/modules/whatsapp/lead-workflow.runner.ts',
      'apps/api/src/modules/ai-agent/suggestion-engine.service.ts',
    ],
    link: '/suggestions',
  },
  {
    id: 'operator-notifier',
    category: 'automation',
    name: 'Operator WhatsApp notifier',
    shortDescription:
      'Pushes each new pending Suggestion to the operator phone with Approve / Edit / Cancel reply buttons.',
    longDescription:
      'When a Suggestion is created (either from an inbound message or a follow-up sweep), the notifier sends an interactive button message to OPERATOR_WHATSAPP_E164. The body includes the lead, state, suggested reply, and confidence. Three reply buttons:\n- ✓ Aprobar — sends the suggestion verbatim to the lead\n- ✎ Editar — bot asks for the corrected text via WhatsApp; the next operator text becomes the edited reply (5-min window)\n- ✗ Cancelar — discards without sending\n\nButton replies and edit text route via the standard webhook → OperatorInboundHandler.',
    triggers: ['Suggestion creation (inbound-driven or follow-up sweep)'],
    effects: [
      'Sends interactive button message to operator',
      'No-op when OPERATOR_WHATSAPP_E164 is unset',
    ],
    configurables: [
      { key: 'OPERATOR_WHATSAPP_E164', description: 'Operator phone E.164.' },
      { key: 'WHATSAPP_ADAPTER', default: 'cloud', description: '"mock" disables real sends.' },
    ],
    rationale:
      'Operator should be able to operate from their phone — same approval flow, no need to keep the dashboard open.',
    observability: [
      'Failed sends log `Operator notification failed for suggestion=...`',
      'If pushes stop arriving, the most likely cause is the 24h customer-service window expired (operator should send any text to the business number to refresh)',
    ],
    sourceFiles: [
      'apps/api/src/modules/ai-agent/operator-notifier.service.ts',
      'apps/api/src/modules/whatsapp/operator-inbound.handler.ts',
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // FEATURES
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'fast-posting-studio',
    category: 'feature',
    name: 'Fast Posting Studio',
    shortDescription:
      'Generates trackable post packages (caption variants + tracking link + click-to-chat URL) so manual social posting is end-to-end attributable.',
    longDescription:
      'A post package is a unit of marketing content tied to a property and a unique tracking code. Operator picks a property → system generates short / long / WhatsApp / Facebook captions, a tracking URL (`/t/POST-XXXX` for click counting), and a click-to-chat WhatsApp link with a prefilled message containing the property and post codes. Operator copies the caption, publishes manually in FB / WA groups, marks "Published" with the channel name. When a lead clicks the link and sends the prefilled text, the InboundRouter parses both codes and attributes the lead to that exact post. Funnel analytics show clicks → leads → qualified → viewings → deals → commission per post / channel / property.',
    triggers: [
      'Operator clicks "+ Generate package" in /posting',
      'POST /post-packages/generate via API',
    ],
    effects: [
      'Creates PostPackage row + TrackingLink row',
      'Captures publishing metadata (channel, URL, time, who published)',
      'Auto-pauses published packages when the property becomes unavailable (via owner sweep)',
    ],
    configurables: [
      { key: 'WHATSAPP_BUSINESS_WA_ME_BASE_URL', default: 'https://wa.me/971585063316' },
      { key: 'POST_CODE_PREFIX', default: 'POST', description: 'Prefix for generated post codes.' },
    ],
    rationale:
      'Meta does not allow legitimate API posting to FB/WA groups. Instead of pretending to automate, we make manual posting fully traceable so we know which post produces which deal.',
    observability: [
      'Per-post stats on /posting cards: clicks + leads',
      'Per-channel rollups in /analytics',
      'attribution_confidence on each Lead (high / medium / low / none) — indicates how sure we are which post brought them',
    ],
    sourceFiles: [
      'apps/api/src/modules/posting/posting.service.ts',
      'apps/api/src/modules/tracking/tracking.controller.ts',
      'apps/api/src/modules/whatsapp/inbound.router.ts',
    ],
    link: '/posting',
  },
  {
    id: 'suggestions-inbox',
    category: 'feature',
    name: 'Suggestions inbox',
    shortDescription:
      'Operator workspace where every Claude-generated reply waits for approval. Approve / Edit / Cancel — edits become training examples.',
    longDescription:
      'The /suggestions page lists pending suggestions newest-first with a 5-second auto-refresh. Each card shows the lead, state, AI reasoning, confidence score, the suggested text, and telemetry (model, tokens, cache hit, latency). The operator can: Approve → text is sent verbatim to the lead via WhatsApp Cloud API; Edit → operator rewrites, both versions are saved as a TrainingExample (which is injected as a few-shot example in future Claude calls); Cancel → nothing is sent. Tabs for Pending / Approved / Edited / Cancelled / Failed.',
    triggers: ['Operator opens /suggestions'],
    effects: [
      'Approve sends a WhatsApp message and advances the lead state',
      'Edit captures (suggestion, edit) pair into TrainingExample for few-shot priming',
      'Cancel marks the suggestion cancelled — no message sent',
    ],
    configurables: [],
    rationale:
      'Human-in-the-loop AI: AI proposes, human disposes. Edits feed back into the prompt so the model gets better at this team\'s voice over time.',
    observability: [
      'Pending count badge in the sidebar (auto-refreshes every 8s)',
      'Cache read tokens visible per suggestion — high cache reads = prompt caching is healthy',
    ],
    sourceFiles: [
      'apps/api/src/modules/ai-agent/suggestions.service.ts',
      'apps/web/src/app/(dashboard)/suggestions/page.tsx',
    ],
    link: '/suggestions',
  },
  {
    id: 'fast-posting-pause-on-unavailable',
    category: 'automation',
    name: 'Auto-pause on property unavailable',
    shortDescription:
      'When a property becomes rented or blocked, all its published post packages are auto-paused so we stop receiving leads for inventory we can\'t fulfill.',
    longDescription:
      'When the OwnerReplyParser updates a Property to status `rented`, `blocked`, or `unavailable`, post packages with status `published` for that property are automatically transitioned to `paused`. The operator gets a notification listing which posts to manually delete or edit in the FB/WA groups (we can\'t auto-delete external posts — that\'s the operator\'s job).',
    triggers: ['Owner reply marks property unavailable'],
    effects: [
      'Sets PostPackage.status = paused, pausedAt = now()',
      'Creates a Notification for the operator',
    ],
    configurables: [],
    rationale:
      'Stops the funnel from feeding dead leads.',
    observability: ['Notification badge', 'Paused tab in /posting'],
    sourceFiles: ['apps/api/src/modules/automation/owner-reply.parser.ts'],
  },

  // ──────────────────────────────────────────────────────────────────
  // INTEGRATIONS
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'integration-anthropic',
    category: 'integration',
    name: 'Anthropic Claude API',
    shortDescription:
      'Sonnet 4.6 with adaptive thinking + structured JSON output + 5-min prompt caching.',
    longDescription:
      'All AI suggestions go through Claude Sonnet 4.6. The prompt is structured in two cached blocks: (1) brand voice + hard rules (very stable), (2) property catalog + operator-curated few-shot examples (changes when inventory or training data changes). Both have `cache_control: ephemeral` for ~10x cost reduction on repeated requests. Output is JSON-validated against a schema (suggestedReply, reasoning, confidence, stateAfter, escalate).',
    triggers: ['Inbound lead message', 'Lead follow-up sweep'],
    effects: [],
    configurables: [
      { key: 'AI_PROVIDER', default: 'anthropic', description: 'mock for offline/cheap dev.' },
      { key: 'AI_API_KEY', description: 'sk-ant-... from console.anthropic.com.' },
      { key: 'AI_MODEL', default: 'claude-sonnet-4-6' },
    ],
    rationale:
      'Sonnet 4.6 has the best speed/quality balance for short conversational replies. Adaptive thinking lets the model decide when reasoning is worth the latency.',
    observability: [
      'cache_read_input_tokens > 0 = caching is working',
      'cache_creation_input_tokens > 0 + read 0 = first request after a prompt change',
      'Per-suggestion token + latency stats on the inbox card',
    ],
    sourceFiles: [
      'packages/ai/src/anthropic.provider.ts',
      'apps/api/src/modules/ai-agent/suggestion-engine.service.ts',
    ],
  },
  {
    id: 'integration-whatsapp-cloud',
    category: 'integration',
    name: 'WhatsApp Business Cloud API',
    shortDescription:
      'Send/receive WhatsApp messages, interactive button menus, and webhook signature verification — all via Meta\'s Cloud API.',
    longDescription:
      'The CloudApiWhatsAppAdapter implements: sendText, sendTemplate, sendMedia, sendInteractiveButtons, parseInbound (text + button_reply), and HMAC-SHA256 webhook signature verification. Outbound messages within the 24h customer-service window can be plain text. Outside the window, only approved templates work. Inbound messages route through InboundRouter → operator handler / owner parser / lead workflow.',
    triggers: [
      'Outbound: API code calling adapter.sendText(...) etc.',
      'Inbound: POST /webhooks/whatsapp from Meta',
    ],
    effects: [
      'Stores every WhatsAppMessage with provider status',
      'Creates WhatsAppConversation per (company × lead phone)',
      'Parses interactive button replies for operator approval flow',
    ],
    configurables: [
      { key: 'WHATSAPP_ADAPTER', default: 'cloud', description: '"cloud" or "mock".' },
      { key: 'WHATSAPP_CLOUD_API_PHONE_NUMBER_ID' },
      { key: 'WHATSAPP_CLOUD_API_BUSINESS_ACCOUNT_ID' },
      { key: 'WHATSAPP_CLOUD_API_ACCESS_TOKEN' },
      { key: 'WHATSAPP_APP_SECRET' },
      { key: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN' },
    ],
    rationale:
      'WhatsApp is the primary channel where Dubai rental leads happen. Cloud API is the only Meta-sanctioned way to integrate.',
    observability: [
      'WebhookLog rows for every inbound POST',
      'WhatsAppMessage.providerStatus = sent / mock_sent / failed',
      'WhatsAppMessage.providerError when Meta returns an error (e.g. expired session window)',
    ],
    sourceFiles: [
      'packages/integrations/src/whatsapp/cloud-api.adapter.ts',
      'apps/api/src/modules/whatsapp/webhook.controller.ts',
    ],
  },
  {
    id: 'integration-postgres',
    category: 'integration',
    name: 'PostgreSQL + Prisma',
    shortDescription:
      '41-entity schema with multi-tenant scoping, soft deletes, and audit log support.',
    longDescription:
      'All persistent state lives in PostgreSQL via Prisma ORM. Every aggregate root carries `companyId` for tenant isolation. Soft deletes via `deletedAt` for Lead, Property, Owner, User, Deal, PostPackage, FieldAgent. UUID v4 primary keys, UTC timestamps, money as Decimal(12,2) AED.',
    configurables: [
      { key: 'DATABASE_URL', description: 'PostgreSQL connection string.' },
    ],
    rationale: 'Single source of truth for the rental funnel.',
    sourceFiles: ['packages/database/prisma/schema.prisma'],
  },
];
