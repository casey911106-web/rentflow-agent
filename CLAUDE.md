# rentflow-agent — Rental Conversion Operating System (Dubai)

**Familia de deploy:** **A (sub-variante git-pull)** — el deploy real corre en el VPS via `git fetch + reset --hard origin/main + docker compose build/up`, NO rsync from local.
**Audiencia (hoy):** **TEAM-INTERNAL** (ops + 2 publishers). Multi-tenant ready en el data model para futuros clientes externos pero NO hay tenant externo conectado todavía → deploy directo aplica. (Cuando entre primer cliente externo, mover a workflow staging-first.)
**URLs:**
- API: `rentflow-api.rentalho.com` (VPS, NestJS :3001)
- Web: `app.rentalho.com` (Vercel, Next.js)
- DB: Supabase Postgres (managed)
**Repo en GitHub** (no GitLab): `github.com/casey911106-web/rentflow-agent`
**Mapa del workspace:** `/Users/CARLOS/VAs/WORKSPACE.md`
**Credenciales:** `/Users/CARLOS/VAs/AUTH.md`

⚠️ **Bomba conocida — leer antes de tocar deploy:** `bin/deploy.sh` está diseñado para correr **DENTRO DEL VPS**. Hace `git reset --hard origin/main`. **NUNCA ejecutarlo desde tu laptop** — borraría tus cambios locales no commiteados. El shim `./deploy.sh` de la raíz es seguro porque hace push y SSH-and-run, no llama a bin/deploy.sh local.

VPS path: rentflow vive en **`/home/rentalho/apps/rentflow-agent/`** (misma convención que el resto del workspace). Si necesitás `ls` o `cat` algo en el VPS, ahí está.

## Qué es

> **"Rental conversion operating system"** — convertir social-rental inquiries en viewings calificadas y deals cerrados, manteniendo inventario verificado a diario.

NO es un posting tool. El posting solo alimenta el real producto: closed-loop intake → availability verification → WhatsApp lead capture → AI qualification → viewing → deal closed → commission collected, con attribution + scoring en cada paso.

Construido primero como plataforma ops INTERNA de un negocio Dubai (short-term + monthly + holiday). Multi-tenant **desde día uno** en el data model (`companyId` en todo) para hostear futuros third-party owners.

**Norte estratégico actual (2026-05-24, [[rentflow-north-2026-05-24]]):** pain top = más leads / más reach en publicaciones. **NO hardening enterprise.** Equipo = 2 publishers. Próxima sesión arranca por top-funnel.

## Estructura (monorepo turbo)

```
rentflow-agent/
├── apps/
│   ├── api/                — NestJS 10 REST API + WhatsApp webhooks + AI workflow runner (:3001)
│   ├── web/                — Next.js 14 operations dashboard → Vercel
│   └── mobile/             — Expo (RN) field-agent app
├── packages/
│   ├── database/           — Prisma schema + migrations + seed (Postgres)
│   ├── shared/             — Types, enums, DTOs, utils
│   ├── ai/                 — Provider abstraction (mock / OpenAI / Anthropic)
│   ├── integrations/       — WhatsApp Cloud API adapter (+ mock) + S3 adapter
│   ├── ui/                 — Web UI primitives (Tailwind + shadcn)
│   └── config/             — eslint / tsconfig / tailwind presets compartidos
├── bin/deploy.sh           — ⚠️ corre en VPS (git pull + docker), NO en local
├── deploy.sh               — shim seguro: git push + ssh-and-run (Familia A convención)
├── docker-compose.prod.yml — solo API (Postgres es Supabase, no local)
├── docker-compose.yml      — Postgres + Redis + MinIO local para dev
├── Makefile                — atajo `make deploy` (corre en VPS)
├── docs/                   — arquitectura, PRD, AI flows, scoring, compliance
│   └── superpowers/        — plans + specs (work-in-progress design docs)
└── turbo.json
```

## Stack (totalmente distinto a RentalHo)

| Layer | Tech |
|---|---|
| API | **NestJS 10**, TypeScript strict, **Postgres + Prisma**, Redis, **BullMQ**, Zod, Swagger |
| Web | Next.js 14, React 18, Tailwind, **shadcn/ui**, **TanStack Query**, Recharts |
| Mobile | Expo SDK **54** (alineado con RentalHo), RN, **NativeWind** styling |
| AI | Provider abstraction (default mock para dev) |
| Integrations | WhatsApp Cloud API (mockable), S3-compatible storage |
| Infra prod | Docker Compose en VPS (solo API) + Vercel (web) + **Supabase** (Postgres managed) |
| Infra dev | Docker Compose local (Postgres + Redis + MinIO) |

⚠️ **NO Mongo, NO Hostaway, NO 360dialog** — este repo no comparte stack con RentalHo más allá de la VPS host. **Cero cross-import** de código entre proyectos.

## Comandos

```bash
pnpm install                       # deps monorepo
pnpm typecheck                     # turbo run typecheck — OBLIGATORIO antes de deploy
pnpm build                         # turbo run build
pnpm dev                           # turbo run dev (todas las apps en paralelo)
pnpm test                          # turbo run test

# Database (Prisma)
pnpm db:generate                   # prisma generate
pnpm db:migrate                    # prisma migrate dev / deploy
pnpm db:seed                       # seed inicial
pnpm db:reset                      # ⚠️ DROP + recreate (dev only)

# Local stack
pnpm docker:up                     # Postgres + Redis + MinIO
pnpm docker:down
pnpm docker:logs

# Deploy
bash deploy.sh                     # shim seguro: push + ssh-and-run-bin/deploy.sh
```

> ⚠️ **`pnpm lint` y `pnpm test` están rotos** (ESLint legacy sin instalar en api/mobile; no hay tests → jest "No tests found"). No los arregles de pasada. El loop real es: editar → `pnpm typecheck` → commit → push.

**NO correr `bash bin/deploy.sh` desde local** (destruye cambios sin commitear). Solo el shim de raíz `./deploy.sh` o `make deploy` (ambos correctos).

## Sesión desde teléfono (cloud) vs PC (Mac local)

Este repo se trabaja desde **dos lugares**: la sesión de **PC** (Mac, este working tree) y **sesiones cloud desde el teléfono** (claude.ai/code, que **clonan `origin/main` de GitHub** — solo ven lo commiteado y empujado).

En sesiones cloud, el hook `.claude/hooks/session-start.sh` corre solo al arrancar y deja listo: `pnpm install` + `pnpm db:generate` (cliente Prisma, no necesita DB) + `eas-cli` global. No repitas esos pasos a mano.

### Qué hace cada sesión

| Tarea | Teléfono (cloud) | PC (Mac local) |
|---|---|---|
| Editar código + `pnpm typecheck` + commit + `git push` | ✅ sí | ✅ sí |
| Publicar app móvil OTA (`eas update`) | ✅ sí — requiere `EXPO_TOKEN` + dominios Expo en la allowlist | ✅ sí |
| Leer DB de prod (`psql` a Supabase) | ⚠️ **NO** — el cloud bloquea TCP Postgres `:6543` (probado con red Custom y Full); solo pasa HTTP(S). Usar la **Mac** o el **SQL editor de Supabase** (web, anda en el móvil) | ✅ sí (ya en `.env`) |
| Deploy API al VPS (`bash deploy.sh`) | ⚠️ **NO** — el shim hace SSH al VPS; hacelo desde **PC** | ✅ sí |
| Migrations Prisma a Supabase (`pnpm db:migrate`) | ⚠️ **NO** — usa `DIRECT_URL` (host **IPv6-only**) y el contenedor cloud es IPv4. Desde **PC** | ✅ sí |
| Refactors grandes / leer logs largos | preferible PC | ✅ |

**Regla de oro:** teléfono = **loop de código + publish OTA**. PC = **deploy de infra (API/VPS) + migrations Prisma + leer prod**. Para leer prod desde el móvil sin la Mac: **SQL editor de Supabase** en el navegador (el cloud no deja conectar a Postgres). El **web (Vercel) se auto-despliega en cualquier `git push origin main`**, desde donde sea.

> ⚠️ **Regla dura — trabajo desde el teléfono (cloud) = SIEMPRE PR + merge por Claude.** Cuando se desarrolla desde una sesión cloud, NO se pushea directo a `main`: se trabaja en la branch de la sesión, se **abre un Pull Request** y **Claude mismo lo mergea a `main`**, pero SOLO después de verificar que no rompe nada (`pnpm typecheck` verde como gate mínimo; build si aplica). El PR queda como registro del diff. El objetivo es dejar `main` **listo para deploy** — Carlos solo corre `bash deploy.sh` desde la PC. El deploy del API (`git reset --hard origin/main` en VPS) solo agarra lo que está en `main`, así que el merge es el gate antes de deployar. Esto pisa la default de "no crear PR salvo pedido": desde el cloud, PR + merge verificado es el flujo por defecto. (Establecido 2026-06-17 por Carlos.)

### Config de la sesión cloud (one-time, en la consola de claude.ai)

⚠️ Variables y allowlist viven **por environment**. Usá **siempre el mismo** environment para el teléfono y archivá los demás. Cambiar config aplica a **sesiones nuevas**, no a la ya abierta.

**Variables** (Settings → Environment variables):
- `EXPO_TOKEN` = personal access token de Expo (cuenta `casey911106`). Necesario para publicar OTA.
- ~~`DATABASE_URL`~~ — **no la pongas**: el cloud bloquea el puerto Postgres, así que `psql` nunca conecta (verificado 2026-06-17, red Custom y Full). Leé prod desde la Mac o el SQL editor de Supabase.

**Red** (Settings → Network → **Custom** alcanza, no hace falta Full):
```
api.expo.dev
u.expo.dev
expo.dev
storage.googleapis.com
```

### De dónde sacar cada valor

1. **`EXPO_TOKEN`** — https://expo.dev/settings/access-tokens (logueado como `casey911106`) → **Create token** → copiar. Es lo único que `eas update` necesita para autenticar sin browser. Proyecto: `rentflow-agent` · projectId `c5c8d6ab-a07d-447c-945a-9dfbcff771fe`.
2. **Dominios Expo** — fijos, los de arriba. `u.expo.dev` es el host OTA (ver `apps/mobile/app.json` → `updates.url`).
3. **Leer prod desde el móvil** — `psql`/Postgres **NO funciona** desde sesiones cloud: el entorno bloquea TCP al puerto `:6543` (probado con red Custom y Full, 2026-06-17); solo deja pasar HTTP(S). Vías reales:
   - **Mac** (sesión local): ya tiene el `DATABASE_URL` pooler en `.env` y conecta directo — lugar canónico para análisis de prod.
   - **SQL editor de Supabase** en el navegador (anda en el teléfono): `select ... from "Lead"`, sin config ni credenciales expuestas.
   - Prod-read **programático** desde el cloud (si algún día hace falta): única vía = **API REST de Supabase (PostgREST) sobre HTTPS**, que sí atraviesa el proxy, con key read-only. No implementado.

### Publicar la app desde el teléfono (OTA)
```bash
# scripts ya definidos en apps/mobile/package.json
pnpm --filter @rentflow/mobile update:preview -m "<qué cambió>"   # canal preview
pnpm --filter @rentflow/mobile update:prod    -m "<qué cambió>"   # canal production
```
Requiere `EXPO_TOKEN` + dominios Expo en la allowlist. `eas.json` tiene `requireCommit` → **commiteá y pusheá antes de publicar** (no publica con árbol sucio). `eas build` (APK/binario nativo) **solo** para cambios nativos, no para JS/OTA.

⚠️ **Regla de oro antes de `update:prod`:** la sesión cloud solo ve `origin/main`. Si desarrollás en paralelo desde la PC, **confirmá que la PC ya pusheó** — publicar desde un repo atrasado manda un bundle viejo a usuarios reales. Checklist: (1) repo al día vs PC · (2) `pnpm typecheck` pasa · (3) cambio es solo JS/assets · (4) mostrar el diff y esperar OK.

## Deploy real (3-tier)

| Componente | Cómo se despliega | Trigger |
|---|---|---|
| **API** (VPS) | `bin/deploy.sh` corre en VPS: `git fetch`, `git reset --hard origin/main`, `docker compose -f docker-compose.prod.yml build api`, `up -d --force-recreate api`, health-check a `:3001/health` | Manual desde laptop con `bash deploy.sh` (shim) |
| **Web** (Vercel) | Auto-deploy en push a `main` (asumido — verificar dashboard) | `git push origin main` |
| **DB** (Supabase) | `pnpm db:migrate` desde local apuntando a Supabase URL | Manual cuando hay migration nueva |

**Pre-flight (one-time, ya hecho):**
- DNS `rentflow-api.rentalho.com → 89.40.15.250`
- VPS: `/home/rentalho/apps/rentflow-agent/` clonado + permisos al user `rentalho` + `.env` lleno con `DATABASE_URL` (pooler URL de Supabase), `DIRECT_URL` (direct URL para migrations), `REDIS_URL`, secrets WhatsApp, AI keys, S3 creds, `JWT_SECRET`.
- Volumes Docker: `rentflow_uploads` montado en `/repo/uploads` (binario uploads compartido entre rebuilds).
- nginx-proxy network (igual que el resto del VPS) — auto-rutea por `VIRTUAL_HOST`.

## Diferencias clave con repos RentalHo

| Item | RentalHo (ai, ops-mobile, etc.) | RentFlow Agent |
|---|---|---|
| DB | MongoDB ai_db (en VPS) | **Postgres en Supabase** (managed) |
| ORM | mongodb driver oficial | **Prisma** |
| Web backend | Next.js API routes | **NestJS** (separado del frontend) |
| Queue | BullMQ local | BullMQ contra Redis local del VPS |
| Web frontend | Next.js en VPS | **Next.js en Vercel** |
| Mobile SDK | Expo 54 | **Expo 54** (no actualizar sin razón) |
| Mobile styling | StyleSheet / Tailwind RN | **NativeWind** |
| Deploy API | rsync from local | **git push + ssh-and-run** |
| VPS path | `/home/rentalho/apps/<app>/` | `/home/rentalho/apps/rentflow-agent/` |
| Remote | GitLab rhbnb/* | **GitHub casey911106-web/** |
| WhatsApp number | +971 58 514 9408 | **+971 58 506 3316** (separado, ver split) |
| Audiencia | Mix (interna + end-user) | Hoy interna, multi-tenant ready |

## WhatsApp — WABA propia e independiente

RentFlow tiene su **propia cuenta WhatsApp Business (WABA) desde día uno**, independiente de RentalHo. NO es un "split" de RentalHo — son dos proyectos distintos con cuentas Meta separadas.

| Proyecto | Número | Estado |
|---|---|---|
| **RentFlow** (este repo) | `+971 58 506 3316` | activo, documentado en `deploy/README.md` |
| RentalHo ops (otro proyecto) | `+971 58 514 9408` | activo, VAs Filipinas en device — ver [[rentalho-meta-whatsapp-ids]] |
| RentalHo marketing (otro proyecto) | — | aún sin comprar, plan interno de RentalHo, NO aplica aquí |

Para credenciales de Meta de este número, ver `AUTH.md` § WhatsApp Cloud (rentflow). Vars en `.env`:
- `WHATSAPP_BUSINESS_PHONE_E164=+971585063316`
- `WHATSAPP_CLOUD_API_PHONE_NUMBER_ID=...`
- `WHATSAPP_CLOUD_API_BUSINESS_ACCOUNT_ID=...`
- `WHATSAPP_CLOUD_API_ACCESS_TOKEN=...`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN=...`
- `WHATSAPP_APP_SECRET=...` (App Secret del FB app — para firma de webhooks)
- `WHATSAPP_ADAPTER` — `cloud` o `mock` (mock para dev sin credenciales reales)
- `OPERATOR_WHATSAPP_E164` — número del operador para alerts internas

## Documentación rica en `docs/`

Antes de cambios non-trivial, leer el doc correspondiente:
- `architecture.md` — diagrama de componentes
- `product-requirements.md` — PRD
- `database-schema.md` — modelo de datos
- `ai-agent-flows.md` — flows del AI qualification
- `scoring-system.md` — sistema de scoring de leads
- `posting-and-attribution.md` — cómo se rastrea fuente y conversión
- `whatsapp-integration.md` — handshake con Meta Cloud
- `security-and-compliance.md` — auth, tenant isolation, audit
- `mvp-roadmap.md` — qué es MVP vs nice-to-have
- `assumptions.md` — supuestos para diseño
- `api-reference.md` — endpoints
- `superpowers/{plans,specs}/` — diseños en progreso (revisar antes de iniciar feature nueva)

## Reglas duras

- ⚠️ **NO correr `bin/deploy.sh` desde laptop** — el `git reset --hard` destruye trabajo local. Solo el shim de raíz o `make deploy`.
- **NO cross-import con código RentalHo.** Stacks distintos, propósitos distintos. Comparten solo VPS host.
- ⚠️ **Multi-tenancy ya está en el data model** (`companyId` en todo) — toda query nueva debe scoper por tenant. Sin scope = leak entre clientes futuros.
- **No hardening enterprise prematuro** — norte top-funnel, no compliance / sec advanced. Foco en leads + reach. Ver [[rentflow-north-2026-05-24]].
- **Field agent strings en INGLÉS** (mobile + push + notifications + admin questions). Web admin puede seguir en español. Ver [[rentflow-field-agents-english]].
- **No persistir state en JSON plano** — siempre Postgres. Ver [[no-flat-json-persistence]].
- **No soluciones momentáneas** · [[no-temporary-fixes]]
- **Investigar profundo antes de proponer fix** · [[investigate-deeply-before-solving]]
- **NO mezclar con WhatsApp de RentalHo** — número distinto a propósito.

## Auth (credenciales)

Ver `/Users/CARLOS/VAs/AUTH.md`. Servicios este repo:
- **Supabase Postgres** — `DATABASE_URL` (pooler para runtime) + `DIRECT_URL` (direct para migrations Prisma)
- **Redis** local del VPS (`REDIS_URL=redis://redis:6379` interno; no expone fuera)
- **WhatsApp Cloud API** (segunda WABA — VER vars arriba)
- **AI provider** — `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` (genérico — puede ser OpenAI, Anthropic, mock)
- **S3-compatible storage** — `S3_ENDPOINT`, `S3_REGION`, S3 creds
- **JWT** propio (no comparte con RentalHo) — `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`
- **VPS deploy** — alias `rentalho-vps` (mismo VPS que RentalHo, distinto path)
- **Vercel** — auto-deploy (cuenta `casey911106-6293`)
- **GitHub** — `gh` keyring (cuenta `casey911106-web`)

## Skills, plugins y MCPs útiles

**Skills frecuentes:**
- Backend / DB: `claude-api`, `revops` (consultivo)
- UI (apps/web): `frontend-design`, `ui-styling`, `ui-ux-pro-max`, `design-system`
- UI (apps/mobile): igual + verificación de RN nuevas vs RN 0.81
- Conversion / Marketing (alineado con norte top-funnel): `lead-magnets`, `copywriting`, `social-content`, `paid-ads`, `ad-creative`, `marketing-ideas`, `customer-research`
- Lead/sales: `cold-email`, `email-sequence`, `sales-enablement`
- Compliance ligero: NO `seo-audit`/enterprise; el norte es leads, no SEO técnico.
- Verificación: `verify` antes de declarar terminado

**MCPs típicos:**
- `mcp__claude_ai_Vercel` — deploy + logs del web
- `mcp__claude_ai_Notion` — si el equipo de publishers escribe ahí
- `mcp__claude_ai_Google_Drive` — assets de publicación

**Workflow — NO ceremony (regla dura, ver WORKSPACE.md §"Procesos PROHIBIDOS"):**

- ⛔ **NO uses** `superpowers:writing-plans`, `superpowers:execute-plan`, `superpowers:subagent-driven-development`, `superpowers:brainstorming` salvo orden explícita de Carlos. (Pese a que `docs/superpowers/{plans,specs}/` existe en el repo, **eso son docs viejos**, no licencia para invocar la skill.)
- ⛔ **NO uses TodoWrite** por reflejo. Features cross-app (api ↔ web ↔ mobile) NO requieren plan generado por la skill; el patrón directo funciona.
- ✅ Patrón correcto: leer → editar → typecheck (turbo) → `bash deploy.sh` (push + ssh-and-run).
- ✅ Si la tarea cruza apps (api + web + mobile) Y cambia contratos: avisar y pedir confirmación antes.
- Ver [[skip-superpowers-ceremony]].

## Memorias claude-mem clave de este repo

Estrategia y producto: [[rentflow-north-2026-05-24]]
Contexto comparativo (WABA RentalHo, NO RentFlow): [[rentalho-meta-whatsapp-ids]]
Field agent UX: [[rentflow-field-agents-english]]
Operación universal (también aplica acá): [[no-temporary-fixes]] [[investigate-deeply-before-solving]] [[no-flat-json-persistence]] [[skip-superpowers-ceremony]]
Audience workflow: [[rentalho-landing-three-phase]] (cuando entre primer tenant externo, mover este repo a staging-first)
