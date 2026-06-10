#!/bin/bash
#
# SessionStart hook — bootstraps a Claude Code on the web session so the repo
# is immediately ready to typecheck, build, develop and commit.
#
# What it does (idempotent, non-interactive):
#   1. Installs the pnpm workspace dependencies.
#   2. Generates the Prisma client (required before typecheck / build / dev).
#
# It does NOT touch a database or any production secrets. Prod credentials
# (DATABASE_URL, AI_API_KEY, WhatsApp tokens, …) are injected as environment
# variables from the Claude Code environment config — never written here.
#
set -euo pipefail

# Only bootstrap in the remote (web) environment. Local CLI sessions on a
# laptop already have their own working tree set up.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Make sure pnpm is on PATH (no-op if corepack/pnpm are already available).
corepack enable >/dev/null 2>&1 || true

# 1. Install dependencies. `pnpm install` (not `--frozen-lockfile`) so the
#    install benefits from the cached container state between sessions.
echo "[session-start] Installing workspace dependencies…"
pnpm install

# 2. Generate the Prisma client. Reads the schema only — needs no DB
#    connection — and unblocks typecheck / build across the monorepo.
echo "[session-start] Generating Prisma client…"
pnpm db:generate

# 3. Make the EAS CLI available so OTA updates (`eas update`) can be run from
#    the session. Optional convenience — never blocks startup if it fails.
#    Auth happens via the EXPO_TOKEN env var (set in the environment config).
if ! command -v eas >/dev/null 2>&1; then
  echo "[session-start] Installing eas-cli (for OTA updates)…"
  npm install -g eas-cli >/dev/null 2>&1 || echo "[session-start] eas-cli install skipped (continuing)."
fi

echo "[session-start] Ready. Run 'pnpm typecheck' or 'pnpm build' to verify."
