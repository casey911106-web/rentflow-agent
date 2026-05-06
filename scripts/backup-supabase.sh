#!/usr/bin/env bash
# Manual full-database backup using pg_dump against Supabase direct URL.
# Usage:  ./scripts/backup-supabase.sh
#
# Output:  backups/rentflow-YYYYMMDD-HHMMSS.sql.gz
# Schedule via cron on a workstation that has IPv6 outbound (Mac is fine).
# Run weekly or before risky migrations as a belt-and-suspenders complement
# to Supabase's managed daily backups.

set -euo pipefail

# Supabase runs Postgres 17. Force pg_dump 17 from Homebrew if available.
if [[ -x /opt/homebrew/opt/postgresql@17/bin/pg_dump ]]; then
  export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
fi

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Error: .env not found. Run from repo root." >&2
  exit 1
fi

DIRECT_URL=$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '"')
if [[ -z "$DIRECT_URL" ]]; then
  echo "Error: DIRECT_URL not set in .env" >&2
  exit 1
fi

mkdir -p backups
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT="backups/rentflow-${TIMESTAMP}.sql.gz"

echo "→ Dumping to ${OUTPUT}"
pg_dump "$DIRECT_URL" \
  --no-owner --no-privileges --clean --if-exists \
  --exclude-schema=pg_catalog \
  --exclude-schema=information_schema \
  | gzip > "$OUTPUT"

SIZE=$(du -h "$OUTPUT" | cut -f1)
echo "✓ Backup complete (${SIZE})"
echo "  Restore with:  gunzip -c ${OUTPUT} | psql \"\$DIRECT_URL\""
