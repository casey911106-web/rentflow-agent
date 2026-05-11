# =============================================================================
# RentFlow Agent — API Dockerfile (production)
# Multi-stage build: deps → builder → runtime
# Works on Railway, Render, Fly.io, or any Docker-compatible host.
# =============================================================================

# ---- 1. Base: pnpm + Node 20 ------------------------------------------------
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
# Prisma's schema engine binary needs `openssl` + `ca-certificates` at runtime;
# the Debian slim base image ships only libssl3 by default. Without these,
# `prisma migrate deploy` fails with "Schema engine error: undefined".
#
# fontconfig + fonts-dejavu-core are required by sharp's SVG text rendering
# (librsvg → Pango → fontconfig). Without them, IG carousel overlay text
# renders blank with a "Cannot load default config file" warning at runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates fontconfig fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@9.12.0 --activate

# ---- 2. Dependencies (cached layer) -----------------------------------------
FROM base AS deps
WORKDIR /repo

# Copy ONLY workspace manifests so this layer caches independently from source.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/ai/package.json packages/ai/
COPY packages/database/package.json packages/database/
COPY packages/integrations/package.json packages/integrations/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/config/package.json packages/config/
COPY tsconfig.base.json ./

# Install with --ignore-scripts to skip native postinstalls. We re-run the ones
# we actually need (prisma generate) in a controlled step below.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- 3. Builder: copy source + build ----------------------------------------
FROM deps AS builder
WORKDIR /repo

COPY packages packages/
COPY apps/api apps/api/

# Generate Prisma client + build workspace packages + build the API
RUN pnpm --filter @rentflow/database exec prisma generate \
 && pnpm -r --filter='./packages/*' run build \
 && pnpm --filter @rentflow/api run build

# ---- 4. Runtime --------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Runtime needs the same packages as `base` — Prisma engine (openssl) plus
# the sharp/librsvg text-rendering stack (fontconfig + a font package).
# Without fonts, IG carousel overlay text renders blank.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates fontconfig fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# Bring over the entire installed workspace (node_modules + built dist + prisma)
COPY --from=builder /repo /repo

# Persistent uploads dir (Railway volume mount target)
RUN mkdir -p /repo/uploads
VOLUME ["/repo/uploads"]
ENV LOCAL_UPLOAD_DIR=/repo/uploads

# Healthcheck so Railway / Docker know when we're up
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3001

# Migrate on every boot, then start. Idempotent — Prisma skips already-applied
# migrations. The schema is the source of truth; failures abort the container
# so we never serve traffic against a drifted DB.
# Migrations are a separate operational step — run from a workstation that
# can reach Supabase's direct connection (IPv6 only since 2024). The pooler
# (DATABASE_URL) doesn't support schema DDL.
#
# Manual migrate workflow:
#   • From Mac with DIRECT_URL set:
#     pnpm --filter @rentflow/database exec prisma migrate deploy
#   • Or via this container, ad-hoc when the host has IPv6:
#     docker compose -f docker-compose.prod.yml run --rm api \
#       pnpm --filter @rentflow/database exec prisma migrate deploy
CMD ["pnpm", "--filter", "@rentflow/api", "run", "start"]
