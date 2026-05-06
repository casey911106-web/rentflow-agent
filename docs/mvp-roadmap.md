# MVP Roadmap

Time-boxed at ~8 weeks. Goal is to **prove revenue** by closing real deals through the system.

## Phase 0 — Foundation (Week 1)

- [x] Monorepo, Docker Compose, env scaffolding
- [x] Documentation set
- [x] Prisma schema (41 entities, enums)
- [ ] CI: lint + typecheck + test on PR
- [ ] Auth: login + JWT refresh
- [ ] Tenant scoping middleware

**Exit criteria:** local dev works end-to-end with mock adapters; auth + tenant guards green.

## Phase 1 — Inventory backbone (Weeks 2–3)

- [ ] Properties CRUD + media + calendar
- [ ] Owners CRUD + property links
- [ ] Property availability blocks
- [ ] Property issues (mobile + web reporters)
- [ ] Score modules (readiness, quality, owner trust) v1
- [ ] Web: Properties list, Property detail, Owners list, Owner detail
- [ ] Seed: 10 properties, 5 owners, scores populated

**Exit criteria:** ops can create and manage inventory, see readiness scores, identify gaps.

## Phase 2 — WhatsApp + leads (Weeks 3–5)

- [ ] WhatsApp Cloud API adapter (mock + real)
- [ ] Webhook endpoint with signature verification
- [ ] Inbound parser: source_code / post_code detection
- [ ] Lead creation with full attribution
- [ ] AI provider abstraction + mock provider
- [ ] LeadConversationStateMachine
- [ ] Lead CRM list + detail + WhatsApp console
- [ ] Lead temperature + qualification scoring
- [ ] Follow-up jobs (3h / 24h / 3d)

**Exit criteria:** a real inbound message qualifies via AI; ops sees the conversation; follow-ups fire.

## Phase 3 — Viewings + field ops (Weeks 5–6)

- [ ] Viewing scheduling
- [ ] Manual + semi-auto agent assignment
- [ ] T-24h / T-2h reminders
- [ ] Mobile app skeleton: login, today's viewings, viewing detail, update result, photo upload, issue report
- [ ] Field-agent performance score
- [ ] Web: Viewings calendar, Viewing detail, Field agents list

**Exit criteria:** a viewing flows from request → scheduled → assigned → completed → result, all updated by the agent on mobile.

## Phase 4 — Owner verification (Week 6)

- [ ] OwnerConversationStateMachine
- [ ] Daily availability cron
- [ ] Reply parser (yes / rented / blocked / from-date / unclear)
- [ ] Property status auto-update on confirmed responses
- [ ] Owner trust score updates
- [ ] Web: Owners dashboard with response rate

**Exit criteria:** sweep runs daily; properties auto-flag pending owner confirmation when silence > threshold.

## Phase 5 — Posting + attribution (Weeks 6–7)

- [ ] Fast Posting Studio UI
- [ ] Post package generator: captions (short / long / WhatsApp / Facebook), price line, availability line
- [ ] Tracking link + click-to-chat link generation
- [ ] Mark-published flow with channel + URL
- [ ] Post packages list + filters
- [ ] Attribution analytics by post / channel / property

**Exit criteria:** ops creates a post in <60s; published post shows leads; lead → viewing → deal traces back.

## Phase 6 — Deals + commission (Week 7)

- [ ] Deal creation + lifecycle
- [ ] Commission tracking (expected → invoiced → collected)
- [ ] Web: Deals list + detail + commission view
- [ ] Funnel analytics: post → lead → viewing → deal → commission
- [ ] Score dashboards

**Exit criteria:** the dashboard shows commission per post / agent / property / channel for real closed deals.

## Phase 7 — Hardening (Week 8)

- [ ] Audit logs across all mutations
- [ ] Rate limiting + CORS lockdown
- [ ] Webhook signature verification end-to-end
- [ ] WhatsApp templates approved with Meta
- [ ] Backups + restore drill
- [ ] Operator training docs
- [ ] Production deployment

**Exit criteria:** first production deal closed and traced through the system.

## Post-MVP backlog (deferred)

- Owner-facing portal
- Multi-language UI (Arabic)
- Automated WhatsApp template scheduling
- Multi-currency
- E-signature integration
- Calendar integrations (Google / iCal)
- Deal commission splits
- Public referral / affiliate program
- Webhook system for third parties
- Advanced AI: deal coaching, price recommendations, fraud detection
