# Product Requirements Document (PRD)

## Vision

> **Turn social rental inquiries into qualified viewings and closed rentals while keeping inventory availability verified daily.**

RentFlow Agent is a rental conversion operating system, not a posting tool. The posting module exists only to feed leads into the actual product: a closed-loop, traceable funnel from intake to commission.

## Target user

A Dubai-based rental business handling short-term, medium-term, and monthly rentals across:

- Bed spaces, shared rooms, partitions
- Master rooms, studios, 1BR, 2BR, 3BR
- Villas and other rentable spaces

The business currently runs on WhatsApp + Facebook groups + manual handoffs and cannot trace which post produces which deal.

## North-star metric

**Commission collected per published post package.** Everything ladders into this.

## Secondary metrics

- Lead → Qualified conversion rate
- Qualified → Viewing-scheduled rate
- Viewing → Deal-won rate
- Owner response rate to availability checks
- Property readiness score (% of inventory ready to post)
- Time from inbound message to qualification
- Time from inbound message to viewing scheduled

## Roles

| Role               | Surface              | Notes                                                    |
| ------------------ | -------------------- | -------------------------------------------------------- |
| Super Admin        | Web                  | Full access; tenant + integrations + automations          |
| Operations Manager | Web                  | Properties, owners, leads, viewings, posting, deals       |
| Field Agent        | Mobile (Web read-only) | Today's viewings, results, photos, issue reports         |
| Owner              | WhatsApp only (MVP)  | Receives availability checks; replies update DB           |
| Lead / Client      | WhatsApp only        | Talks to AI Agent; books viewings; gives feedback         |
| AI Agent           | Internal             | State-machine driven; not a human user                    |

See [security-and-compliance.md](security-and-compliance.md) for RBAC permission matrix.

## MVP scope (Must)

1. **Verified inventory** — properties tied to owners, with availability checked.
2. **Fast Posting Studio** — generate post packages with tracking + click-to-chat.
3. **Manual / semi-automated publishing** — humans post; system tracks where.
4. **WhatsApp lead capture** — inbound messages parsed, leads created.
5. **AI lead qualification** — state-machine driven; collects key fields.
6. **Lead CRM** — status, temperature, source attribution.
7. **Viewing scheduling** — manual + semi-auto agent assignment.
8. **Field-agent mobile workflow** — accept, navigate, update result, upload media.
9. **Owner availability verification** — daily WhatsApp check; updates calendar + score.
10. **Deal closing** — record rent, deposit, commission.
11. **Commission tracking** — expected → invoiced → collected.
12. **Funnel analytics** — by post / property / owner / agent / channel.

## Out of scope (MVP)

- Owner-facing portal (we only use WhatsApp for owners in MVP).
- Automated posting to Facebook Groups or WhatsApp Groups.
- Advanced video generation / dynamic creatives.
- Multi-language UI (English only in MVP).
- E-signature for lease agreements.
- Payment gateway (we record amounts, we don't collect).
- Partner / affiliate program.

## Non-functional requirements

- **Multi-tenant** from day one. No single-tenant assumptions.
- **English-only** for code, DB, UI, docs, prompts.
- **TypeScript everywhere.**
- **Audit logs** for every mutation that touches money, leads, viewings, deals.
- **Soft deletes** where appropriate (`deleted_at`).
- **UUIDs** for primary keys.
- **Compliance-first**: no scraping, no unsupported automation; opt-out honored.
- **Mockable integrations** for local dev (WhatsApp + AI both have mock adapters).

## Critical user journeys

### CUJ-1: New lead from Facebook group post

1. Operator publishes post package; click-to-chat link contains `source_code`.
2. Lead messages our number with prefilled text.
3. Webhook parses, creates Lead linked to PostPackage + Property.
4. AI Agent qualifies via state machine.
5. When qualified, AI suggests viewing slots based on calendar.
6. Viewing scheduled; agent assigned; both calendars updated.
7. Field agent updates result on mobile.
8. Ops creates Deal; commission tracked.

### CUJ-2: Daily owner availability sweep

1. Cron triggers `availability-check` for each linked property.
2. AI sends WhatsApp owner template message ("Is X still available?").
3. Owner replies (any of: yes / rented / available from date / blocked / silent).
4. Parser updates property status, calendar, owner trust score.
5. If unavailable, active post packages are paused; readiness score drops.

### CUJ-3: Field agent's day

1. Open mobile app → see today's viewings sorted by time.
2. Tap viewing → see lead, property, address, phone.
3. Mark "On the way" → ops dashboard shows arrival.
4. After viewing, mark result + add notes + upload photos.
5. If `converted`, lead is moved to negotiation; ops gets a notification.
6. Agent performance score updates based on punctuality + outcome.

## Core data model (summary)

41 entities. See [database-schema.md](database-schema.md). Highlights:

- `Company` is the tenant root; everything below carries `companyId`.
- `Lead` is the central conversion entity, linked to `PostPackage`, `WhatsAppConversation`, `Viewing`, `Deal`.
- `Viewing` is the central operations entity, linked to `Lead`, `Property`, `FieldAgent`.
- `PostPackage` is the central attribution entity, linked to `Property`, `Campaign`, `TrackingLink`.
- Four score snapshots are stored over time for trend analysis.

## Acceptance criteria (MVP)

- [ ] Operator can create a property, link an owner, upload media, and see readiness score.
- [ ] Operator can generate a post package with tracking link and copy it for manual posting.
- [ ] An inbound WhatsApp message hitting `/webhooks/whatsapp` creates a Lead with correct attribution.
- [ ] AI qualifies a lead through 5 questions and updates state machine.
- [ ] Operator can schedule a viewing and assign a field agent.
- [ ] Field agent can update viewing result from mobile.
- [ ] Operator can record a deal and commission status.
- [ ] Funnel dashboard shows posts → leads → viewings → deals counts and conversion rates.
- [ ] Owner availability check sweeps run daily; replies parsed and reflected on properties.
- [ ] All API mutations write `AuditLog` entries.
- [ ] All routes are tenant-scoped.
- [ ] Posting is manual; the system never automates Facebook/WhatsApp Groups.
