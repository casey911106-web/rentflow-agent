# AI Agent Flows

The AI Agent is a **state-machine-driven** workflow runner, not a free-form chatbot. There are three machines: lead, owner, and feedback. Each state has explicit `enter` actions, allowed transitions, and guardrails.

## Provider abstraction

```ts
// packages/ai/src/provider.interface.ts
export interface AiProvider {
  name: string;
  complete(opts: AiCompleteOptions): Promise<AiCompleteResponse>;
  classify?(opts: AiClassifyOptions): Promise<AiClassifyResponse>;
}
```

Default in dev: `MockAiProvider` — deterministic, returns scripted answers based on the most recent user message + state. Selected by `AI_PROVIDER=mock`.

Switch to `openai` or `anthropic` by env var. Templates live in `AIPromptTemplate`.

## 1. LeadConversation state machine

States and transitions:

```
initial_contact ──▶ identify_property ──▶ collect_move_in_date ──▶ collect_people_count
   │                       │                       │                      │
   │                       └─ (already specified)──┘                      │
   ▼                                                                       ▼
human_takeover ◀──────── (escalation from any state) ──────────  collect_budget
   │                                                                       │
   │                                                                       ▼
   │                                                              collect_area
   │                                                                       │
   │                                                                       ▼
   │                                                              collect_duration
   │                                                                       │
   │                                                                       ▼
   │                                                              qualify_lead ──▶ suggest_property
   │                                                                                       │
   │                                                                                       ▼
   │                                                                              ask_viewing_time
   │                                                                                       │
   │                                                                                       ▼
   │                                                                              schedule_viewing
   │                                                                                       │
   │                                                                                       ▼
   │                                                                              confirm_viewing
   │                                                                                       │
   │                                                                                       ▼
   ▼                                                                                  follow_up ──▶ closed
opted_out / closed
```

### Per-state behavior

| State | Enter action | Updates | Transitions |
|-------|--------------|---------|-------------|
| `initial_contact` | Greet; surface inferred property if `source_code` present. | `Lead.firstSeenAt`, `Lead.source*` | → `identify_property` (no property) or `collect_move_in_date` (property known) |
| `identify_property` | Ask which space they're interested in; offer the linked one. | `Lead.propertyId` | → `collect_move_in_date` |
| `collect_move_in_date` | "When would you like to move in?" | `Lead.moveInDate` (parsed date) | → `collect_people_count` |
| `collect_people_count` | "How many people will stay?" | `Lead.peopleCount` | → `collect_budget` |
| `collect_budget` | "What's your monthly budget?" | `Lead.budgetAed` | → `collect_area` |
| `collect_area` | "Which area do you prefer?" | `Lead.preferredArea` | → `collect_duration` |
| `collect_duration` | "How long do you want to stay?" | `Lead.rentalDurationMonths` | → `qualify_lead` |
| `qualify_lead` | Compute score (see below). Set temperature. | `Lead.qualificationScore`, `Lead.temperature`, `Lead.status` | → `suggest_property` (hot/warm) or `closed` (unqualified) |
| `suggest_property` | Confirm/suggest matching property. | `Lead.propertyId` (may change) | → `ask_viewing_time` |
| `ask_viewing_time` | Propose 2 slots from `PropertyCalendarEvent`. | — | → `schedule_viewing` |
| `schedule_viewing` | Create `Viewing(status=requested)`. | `Viewing` row | → `confirm_viewing` |
| `confirm_viewing` | Send confirmation summary. | `Viewing.status=confirmed` | → `follow_up` |
| `follow_up` | T-24h, T-2h reminders queued by jobs. | — | → `closed` |
| `human_takeover` | Pause AI for the conversation. | `Conversation.mode=human_takeover` | manual release → previous state |
| `closed` | Terminal. | `Lead.status` final | — |

### Qualification scoring (0–100)

```
score = 25 * urgencyWeight        // move-in within 14 days = 1.0, within 30 = 0.7, beyond = 0.3
      + 25 * budgetMatch          // +/- 10% of property price = 1.0
      + 15 * peopleFitsProperty   // 0.0 if exceeds occupancy rules
      + 15 * durationFit          // matches min stay = 1.0
      + 10 * propertyAvailable    // hard 0/1
      + 10 * responseSpeed        // <30min = 1.0; >24h = 0.3
```

| Range | Temperature  |
| ----- | ------------ |
| 80+   | `hot`        |
| 60–79 | `warm`       |
| 40–59 | `cold`       |
| <40   | `unqualified`|

### Guardrails (apply in any state)

1. **Never confirm availability** unless `Property.status === 'available'` AND no calendar conflict.
2. **Never schedule** without checking `PropertyCalendarEvent` and `AgentAvailability`.
3. **Never promise final price** unless `Property.priceConfirmedAt` is recent.
4. **Escalate on**: angry sentiment, negotiation request, owner-specific question, unclear response twice in a row, opt-out keywords.
5. **Honor opt-out** keywords (`STOP`, `لا تراسلني`, etc.) → set `Lead.status = opted_out`, halt sends.

## 2. OwnerConversation state machine

```
ask_availability ──▶ parse_response ──▶ ask_until_when ──▶ confirm_price ──▶ update_calendar ──▶ closed
                          │                                                          ▲
                          └────── (clear "yes" / "still available") ─────────────────┘
                          │
                          └────── (unclear)  ──▶ notify_admin ──▶ closed
```

| State | Enter action | Updates |
|-------|--------------|---------|
| `ask_availability` | Send template (utility) referencing the property by name/code. | `OwnerAvailabilityCheck(status=pending_response)` |
| `parse_response` | Classify reply: `available` / `rented` / `from_date` / `blocked` / `price_changed` / `unclear`. | `OwnerAvailabilityCheck.parsedReply` |
| `ask_until_when` | (if rented) "Until when?" | `Property.rentedUntil` |
| `confirm_price` | (if price_changed) "What's the new price?" | `Property.priceAed`, `priceConfirmedAt` |
| `update_calendar` | Apply changes; pause active post packages if unavailable. | `Property.status`, `PropertyCalendarEvent`, `PostPackage.status` |
| `notify_admin` | Send in-app notification. | `Notification` |
| `closed` | Terminal. Update `OwnerScoreSnapshot`. | — |

## 3. FeedbackConversation state machine

```
request_rating ──▶ request_comments ──▶ ask_booking_interest ──▶ update_agent_score ──▶ closed
```

| State | Enter action | Updates |
|-------|--------------|---------|
| `request_rating` | "How would you rate the viewing? 1–5." (T+2h after `Viewing.status=completed`) | `ViewingFeedback.rating` |
| `request_comments` | "Any comments?" | `ViewingFeedback.comments` |
| `ask_booking_interest` | "Are you ready to book?" | `Lead.status` (won/negotiating/lost) |
| `update_agent_score` | Recompute `AgentPerformanceSnapshot`. | snapshot row |
| `closed` | Terminal. | — |

## Implementation notes

- Each state lives at `apps/api/src/modules/ai-agent/states/<machine>/<state>.ts` exporting a `StateHandler` with `enter()` and `transition(input)`.
- The runner is at `apps/api/src/modules/ai-agent/runner.ts` and is queued via BullMQ on each inbound message.
- Prompt templates are looked up by `({ machine, state })` from `AIPromptTemplate`. Variables like `{{property.name}}`, `{{lead.budget}}` are interpolated server-side.
- LLM calls go through `AiProvider`. The runner decides which prompt to use, what guardrails to enforce on the result, and what DB updates to commit.
- Every state transition writes to `AIAgentSession` for observability and replay.
