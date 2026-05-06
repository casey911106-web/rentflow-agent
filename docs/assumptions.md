# Assumptions

> **Read before going to production.** Every item here must be either verified, replaced, or accepted as a documented limitation.

## Platform / posting compliance

| # | Assumption | Status | Action before prod |
|---|-----------|--------|--------------------|
| A1 | **Facebook Groups posting is NOT automated.** Meta's Graph API does not expose group posting for third-party apps in the general case. We use manual / semi-automated workflows in MVP. | Accepted | Document in operator training. |
| A2 | **WhatsApp Groups posting is NOT automated.** WhatsApp Cloud API supports 1:1 conversations and templates, not posting to user-created groups. | Accepted | Document in operator training. |
| A3 | **Browser automation / scraping** is not used. No Puppeteer/Playwright posting. We don't risk account suspension. | Accepted | — |
| A4 | We assume WhatsApp Business Cloud API is the messaging channel for the configured number. | To verify | Ensure number is provisioned, app verified, WABA linked. |
| A5 | We assume the business number `+971585063316` is provisioned to a Meta Business Account that owns the WABA. | To verify | Provisioning steps in [whatsapp-integration.md](whatsapp-integration.md). |

## Messaging compliance

| # | Assumption | Status | Action before prod |
|---|-----------|--------|--------------------|
| B1 | First message from a user opens a 24-hour customer service window. Outside that window we send only approved templates. | Encoded in adapter | Approve required templates with Meta. |
| B2 | Marketing-category templates require explicit user consent. We default our outbound templates to `utility` (e.g., availability check, viewing reminder, feedback). | Accepted | Get marketing consent before flipping any to marketing. |
| B3 | We honor opt-out at the messaging layer. Messages with text matching the opt-out list set `Lead.status = opted_out` and block further sends. | Implemented | Localize opt-out keywords. |
| B4 | Owner availability checks are utility-class messages tied to an existing business relationship; this is acceptable in WhatsApp policy. | Likely OK | Legal review per jurisdiction. |

## Technical assumptions

| # | Assumption | Status | Action before prod |
|---|-----------|--------|--------------------|
| T1 | Single-region deployment in MVP (Dubai-aligned). | Accepted | Multi-region not required pre-revenue. |
| T2 | PostgreSQL 16+ as the primary store. | Accepted | — |
| T3 | Redis for BullMQ queues + cache. | Accepted | — |
| T4 | Object storage is S3-compatible. MinIO locally; AWS S3 / Cloudflare R2 in prod. | Accepted | Pick a provider; lock CORS + lifecycle. |
| T5 | We do not encrypt at the column level for MVP. Tokens for integrations are stored in `IntegrationToken` and **must** be encrypted at rest (KMS-wrapped). | Partial | Implement KMS-wrapped column encryption before prod. |
| T6 | All timestamps are UTC at storage; UI converts to Asia/Dubai (UTC+4). | Accepted | — |
| T7 | UUID v4 primary keys. | Accepted | — |
| T8 | API auth: stateless JWT (access + refresh). No session store. | Accepted | Rotate `JWT_SECRET` ≥ every 90 days. |

## AI assumptions

| # | Assumption | Status | Action before prod |
|---|-----------|--------|--------------------|
| AI1 | The mock provider produces deterministic responses suitable for tests and demos. | Implemented | — |
| AI2 | Prompt templates live in DB (`AIPromptTemplate`) and can be edited without redeploy. | Implemented | Version control prompt edits via audit log. |
| AI3 | The AI never confirms availability without checking `Property.status`. | Implemented as guardrail | Add tests. |
| AI4 | The AI never schedules a viewing without checking `PropertyCalendarEvent` and `AgentAvailability`. | Implemented as guardrail | Add tests. |
| AI5 | We do not send PII to providers beyond the conversation context. No internal IDs, deal amounts, or owner contacts unless explicitly required. | Policy | Verify in red-team review. |
| AI6 | When the model is unsure, the conversation is escalated to `human_takeover`, never silently confirmed. | Encoded | Add unit tests for low-confidence routing. |

## Funnel / posting assumptions

| # | Assumption | Status | Action before prod |
|---|-----------|--------|--------------------|
| F1 | Every post package has a unique `source_code` and `post_code`. The first lead message includes them via prefilled `wa.me` text. | Implemented | — |
| F2 | If the prefilled text is edited away by the user before sending, attribution falls back to `last_post_published_for_property` heuristic with a marker (`attribution_confidence`). | Designed | Implement parser fallback. |
| F3 | "Published" status is operator-asserted, not platform-verified. We don't get callbacks from Facebook Groups. | Accepted | Spot-checks via random sampling. |
| F4 | Multiple post packages can target the same property simultaneously; attribution goes to the most recent matching code. | Accepted | — |

## Operations assumptions

| # | Assumption | Status | Action before prod |
|---|-----------|--------|--------------------|
| O1 | Field-agent assignment in MVP is **manual or semi-auto suggestion**. No hard auto-assignment. | Accepted | — |
| O2 | Owners do not log into the app in MVP. They communicate via WhatsApp only. | Accepted | Owner portal is post-MVP. |
| O3 | Daily owner availability sweep runs once per day per property at a configurable hour (default 10:00 Dubai time). | Implemented | Operator can override. |
| O4 | Property "ready to post" requires: owner linked, price confirmed, ≥1 photo, availability confirmed within last 7 days. | Implemented | Tunable per company. |

## MVP simplifications (explicitly deferred)

- No A/B testing of prompts, captions, or templates.
- No commission split between multiple agents on a single deal (one assigned agent per viewing; deal carries one primary agent).
- No multi-currency. AED only in MVP.
- No advanced calendaring (no recurrence, no overlapping bookings).
- No fine-grained permissions UI; roles are coarse (Super Admin / Ops Manager / Field Agent).
- No SLA monitoring beyond simple follow-up timers (3h, 24h, 3d).
- No webhooks out to third parties (we receive WhatsApp webhooks; we don't expose webhooks for tenants yet).

## What MUST be verified before production

1. WABA setup with the business number `+971585063316`.
2. Approved WhatsApp templates: `availability_check`, `viewing_reminder_24h`, `viewing_reminder_2h`, `feedback_request`.
3. Privacy notice / data processing addendum reviewed by legal.
4. Encrypted `IntegrationToken` column.
5. Backups of Postgres + S3 with tested restore.
6. Rate limiting on `/webhooks/whatsapp` and all auth routes.
7. Webhook signature verification enabled (`WHATSAPP_APP_SECRET` set).
8. Observability: structured logs, error reporting, queue dashboards.
9. SOC-aligned access reviews for Super Admin role.
10. Deletion / export workflows for personal data on request.
