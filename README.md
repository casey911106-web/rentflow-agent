# RentFlow Agent

> **Rental conversion operating system** — turn social rental inquiries into qualified viewings and closed rentals while keeping inventory availability verified daily.

RentFlow Agent is **not** a posting tool. The posting module exists only to feed leads into the real product: a closed-loop system from property intake → availability verification → WhatsApp lead capture → AI qualification → viewing → deal closed → commission collected, with full attribution and scoring at every step.

Built first as an internal operations platform for a Dubai-based rental business (short-term, monthly, holiday homes). Multi-tenant from day one so it can later host third-party owners and inventory.

---

## Monorepo layout

```
rentflow-agent/
├── apps/
│   ├── api/          # NestJS REST API + WhatsApp webhooks + AI workflow runner
│   ├── web/          # Next.js operations dashboard
│   └── mobile/       # Expo (React Native) field-agent app
├── packages/
│   ├── database/     # Prisma schema, migrations, seed
│   ├── shared/       # Shared types, enums, DTOs, utils
│   ├── ai/           # Provider abstraction (mock / OpenAI / Anthropic)
│   ├── integrations/ # WhatsApp Cloud API adapter (+ mock), S3 adapter
│   ├── ui/           # Shared web UI primitives (Tailwind + shadcn)
│   └── config/       # Shared eslint / tsconfig / tailwind presets
└── docs/             # Architecture, PRD, AI flows, scoring, compliance
```

## Tech stack

| Layer        | Tech                                                               |
| ------------ | ------------------------------------------------------------------ |
| Web          | Next.js 14 (App Router), React 18, TypeScript, Tailwind, shadcn/ui, TanStack Query, Recharts |
| Mobile       | Expo SDK 51, React Native, TypeScript, Expo Router, NativeWind     |
| API          | NestJS 10, TypeScript, PostgreSQL, Prisma, Redis, BullMQ, Zod      |
| AI           | Provider-agnostic adapters; default mock for local dev             |
| Integrations | WhatsApp Business Cloud API (mockable); S3-compatible storage       |
| Infra        | Docker Compose (Postgres, Redis, MinIO)                            |

## Prerequisites

- Node.js >= 20
- pnpm >= 9 (`npm i -g pnpm`)
- Docker + Docker Compose
- (Optional) Expo CLI for mobile dev

## Quick start

> Comments are kept on their own lines — zsh on macOS does **not** strip `#` comments after a command unless `setopt interactive_comments` is set, and pasted comments will be passed as args to npm scripts.

Install dependencies:
```bash
pnpm install
```

Copy environment:
```bash
cp .env.example .env
```

Start infrastructure — Postgres, Redis, MinIO (requires Docker Desktop or OrbStack):
```bash
pnpm docker:up
```

If you don't want Docker, install Postgres + Redis via Homebrew instead:
```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
createdb rentflow
```
Then update `DATABASE_URL` in `.env` to `postgresql://$(whoami)@localhost:5432/rentflow?schema=public`.

Generate Prisma client, run migrations, and seed:
```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

Run all apps in dev:
```bash
pnpm dev
```

Services after `pnpm dev`:

| Service | URL                       |
| ------- | ------------------------- |
| Web     | http://localhost:3000     |
| API     | http://localhost:3001     |
| API docs (Swagger) | http://localhost:3001/docs |
| MinIO console      | http://localhost:9001 (rentflow / rentflow-secret) |
| Mobile (Expo)      | open via Expo Go QR       |

## Default WhatsApp number

The Cloud API adapter and all click-to-chat links default to:

- Local UAE: `058 506 3316`
- E.164: `+971585063316`
- Click-to-chat: `https://wa.me/971585063316`

This is overridable per-tenant via `AppSetting`. See [docs/whatsapp-integration.md](docs/whatsapp-integration.md).

## Documentation

Read these in order:

1. [Architecture](docs/architecture.md)
2. [Product requirements](docs/product-requirements.md)
3. [Assumptions](docs/assumptions.md) ← **read before production**
4. [MVP roadmap](docs/mvp-roadmap.md)
5. [Database schema](docs/database-schema.md)
6. [API reference](docs/api-reference.md)
7. [AI agent flows](docs/ai-agent-flows.md)
8. [WhatsApp integration](docs/whatsapp-integration.md)
9. [Posting and attribution](docs/posting-and-attribution.md)
10. [Scoring system](docs/scoring-system.md)
11. [Security and compliance](docs/security-and-compliance.md)

## Scripts

| Command           | What it does                              |
| ----------------- | ----------------------------------------- |
| `pnpm dev`        | Run all apps in dev mode                  |
| `pnpm build`      | Build all apps and packages               |
| `pnpm test`       | Run tests across the monorepo             |
| `pnpm lint`       | Lint everything                           |
| `pnpm typecheck`  | Typecheck all packages                    |
| `pnpm db:migrate` | Run Prisma migrations                     |
| `pnpm db:seed`    | Seed demo data                            |
| `pnpm db:reset`   | Drop, recreate, migrate, seed             |
| `pnpm docker:up`  | Start Postgres / Redis / MinIO            |

## License

Proprietary. Internal use only.
