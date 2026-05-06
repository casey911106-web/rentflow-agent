# Architecture

## Executive summary

RentFlow Agent is a multi-tenant rental conversion operating system. The core domain is **lead → viewing → deal → commission**, with property availability verification feeding the top of funnel and tracking attribution feeding the bottom.

The platform is built as a Turborepo monorepo with a NestJS API as the system of record, a Next.js operations dashboard, and an Expo mobile app for field agents. WhatsApp is a first-class channel implemented through an adapter pattern so it can be mocked locally and swapped between providers.

## High-level system diagram

```
                  ┌─────────────────────────────────────────────────────────────┐
                  │                     RentFlow Agent API                       │
                  │                       (NestJS, REST)                         │
                  │                                                              │
   ┌─────────┐    │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
   │  Web    │───▶│   │  Auth    │  │ Domain   │  │   AI     │  │  Posting   │  │
   │ (Next)  │    │   │  (JWT)   │  │ Modules  │  │ Workflows│  │  + Track.  │  │
   └─────────┘    │   └──────────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
                  │                      │             │              │          │
   ┌─────────┐    │                      ▼             ▼              ▼          │
   │ Mobile  │───▶│              ┌────────────────────────────────────────┐      │
   │ (Expo)  │    │              │           Service layer                │      │
   └─────────┘    │              │   Properties · Owners · Leads · …      │      │
                  │              └────────────────────────────────────────┘      │
   ┌─────────┐    │                              │                                │
   │WhatsApp │───▶│  ┌────────────┐    ┌────────▼────────┐    ┌─────────────┐    │
   │ Cloud   │    │  │  Webhooks  │───▶│  Prisma / SQL   │    │  BullMQ     │    │
   │  API    │    │  │  + Verify  │    │   PostgreSQL    │    │  (Redis)    │    │
   └─────────┘    │  └────────────┘    └─────────────────┘    └─────────────┘    │
                  └─────────────────────────────────────────────────────────────┘
                                          │                          │
                          ┌───────────────┘                          │
                          ▼                                          ▼
                ┌──────────────────┐                       ┌─────────────────┐
                │  S3 / MinIO      │                       │  AI Provider    │
                │  property media  │                       │  (mock/oai/anth)│
                └──────────────────┘                       └─────────────────┘
```

## Layered architecture (NestJS API)

We use Clean Architecture with thin controllers and a service / use-case layer. Business rules never live in controllers.

```
HTTP / Webhook  →  Controller (DTO validation, auth, RBAC)
                ↓
                  Service / Use-case (transactions, business logic)
                ↓
                  Repository (Prisma) ── External adapters (WhatsApp, AI, S3)
                ↓
                  Database
```

Cross-cutting:

- **AuditLogInterceptor** captures who did what, on every mutation.
- **TenantGuard** injects `companyId` and scopes queries.
- **PrismaExceptionFilter** translates DB errors to HTTP.
- **ZodValidationPipe** validates DTOs.

## Domain modules (24)

| Module           | Purpose                                                 |
| ---------------- | ------------------------------------------------------- |
| Auth             | Login, JWT, refresh, password reset                     |
| Users            | CRUD, role assignment                                   |
| Companies        | Tenant management, settings                             |
| Properties       | Inventory, media, calendar, availability blocks          |
| Owners           | Owner profiles, properties owned, contact channels       |
| Scores           | Owner trust, property quality, readiness, agent perf     |
| Leads            | Lead lifecycle, qualification state, source attribution  |
| WhatsApp         | Conversations, messages, webhook ingestion, send         |
| AIAgent          | LLM-driven workflow runners (lead, owner, feedback)      |
| Posting          | Fast Posting Studio, post packages, approvals            |
| Tracking         | Source codes, post codes, click-to-chat link generation  |
| Viewings         | Scheduling, assignment, status transitions               |
| Calendar         | Property + agent availability                            |
| FieldAgents      | Field-agent profiles, availability, performance          |
| Deals            | Deal lifecycle: open → negotiating → won/lost           |
| Commissions      | Expected/invoiced/collected tracking                     |
| Feedback         | Post-viewing feedback collection                         |
| Automation       | Rule engine: triggers (event/schedule) → actions         |
| Notifications    | In-app + WhatsApp + email                                |
| Analytics        | Funnel, scoring, channel attribution                     |
| Files            | Upload pre-signed URLs, validation                       |
| Settings         | Tenant + per-user settings                               |
| AuditLogs        | Append-only audit trail                                  |
| Integrations     | Tokens, webhook configuration, adapter selection         |

## Multi-tenancy

Every aggregate root carries `companyId`. A NestJS `TenantInterceptor` extracts it from the JWT, attaches it to the request, and a Prisma extension automatically scopes reads/writes. Cross-tenant queries are explicit and behind a `@CrossTenant()` decorator usable only by Super Admin.

## Async processing

We use **BullMQ** (Redis) for everything that should not block an HTTP request:

| Queue                        | Producers           | Workers                                    |
| ---------------------------- | ------------------- | ------------------------------------------ |
| `whatsapp-inbound`           | Webhook controller  | Lead/Owner conversation routers            |
| `whatsapp-outbound`          | AI workflow + jobs  | Cloud API sender                           |
| `ai-workflow`                | Various             | LeadConversationStateMachine, OwnerCheck   |
| `score-recalc`               | Triggers / cron     | Score modules                              |
| `availability-check`         | Cron (daily)        | Owner availability prompts                 |
| `viewing-reminders`          | Viewing creation    | T-24h, T-2h reminders                      |
| `feedback-requests`          | Viewing completion  | T+2h feedback prompts                      |
| `lead-followups`             | Lead state          | 3h, 24h, 3d follow-ups                     |

## AI provider abstraction

```
packages/ai
├── provider.interface.ts   # AiProvider: completion(prompt, options): AiResponse
├── mock.provider.ts        # Deterministic, used in tests + local
├── openai.provider.ts      # Adapter
├── anthropic.provider.ts   # Adapter
└── factory.ts              # Selected by AI_PROVIDER env var
```

Prompt templates live in `AIPromptTemplate` (DB) so they can be edited without redeploy.

## Workflow / state machine

Conversations are explicit state machines, not free-form chat. Each state defines:

- `name`
- `enter()` — what to send / fetch
- `transitions` — allowed next states with guards

Three machines:

1. **LeadConversation** — initial_contact → … → closed
2. **OwnerConversation** — ask_availability → … → closed
3. **FeedbackConversation** — request_rating → … → closed

See [ai-agent-flows.md](ai-agent-flows.md).

## Data flow: a single lead, end to end

1. Operator generates a **PostPackage** in the Fast Posting Studio. The package includes a generated `source_code`, `post_code`, and a `wa.me` link with prefilled text.
2. A team member publishes the package manually to a Facebook group or WhatsApp group. They mark "Published" in the dashboard, attaching the channel name and (optional) URL.
3. A user clicks the WhatsApp link. Their first message lands on our Cloud API webhook.
4. `WhatsAppWebhookController` verifies the signature, enqueues to `whatsapp-inbound`.
5. `InboundRouter` parses the message: detects `source_code` + `post_code`, finds or creates a `Lead`, opens a `WhatsAppConversation`.
6. `LeadConversationStateMachine` enters `initial_contact`, fires `ai-workflow` job to qualify.
7. As state advances (budget, area, move-in), the lead's `qualification_score` and `temperature` update.
8. When the lead reaches `viewing_requested`, ops or AI assigns a field agent based on availability + performance score.
9. `Viewing` is created. T-24h and T-2h reminders are scheduled. Calendar is updated.
10. Field agent updates result via mobile app. If `converted`, ops creates a `Deal`. AI sends `FeedbackConversation`.
11. Commission is recorded. Funnel analytics update. Owner trust + property quality scores recompute.

## Compliance posture (summary)

- Posting to Facebook Groups and WhatsApp Groups is **manual / semi-automated** by default. We don't automate platforms beyond what their official APIs allow.
- WhatsApp messages from us require an active 24-hour user-initiated session **or** an approved template. Marketing templates require user consent.
- Opt-out is explicit (`opted_out`) and honored at the messaging layer.
- See [security-and-compliance.md](security-and-compliance.md).

## Local development

```bash
pnpm install
pnpm docker:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The mock WhatsApp adapter exposes `POST /whatsapp/mock/inbound` so integration tests and demos can simulate any inbound message.

## Testing strategy

- **Unit** — pure services, score calculators, parsers (Jest).
- **Integration (API)** — full module flows against a test Postgres (testcontainers or scripted).
- **WhatsApp webhook** — fixture-driven tests against the InboundRouter using the mock adapter.
- **AI workflows** — state-machine tests using `mock.provider`.
- **E2E (web/mobile)** — out of MVP scope; smoke tests only.
