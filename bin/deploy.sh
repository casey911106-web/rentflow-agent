#!/usr/bin/env bash
# =============================================================================
# RentFlow Agent — VPS deploy script
# =============================================================================
# Run on the VPS after pushing to main. Idempotent — safe to re-run.
#
#   1. Pull latest code
#   2. Build the API image
#   3. Recreate the container
#   4. Tail the first ~30s of logs so you can confirm it boots
#
# Usage:  ./bin/deploy.sh
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

echo "▶ Pulling latest from origin/main..."
git fetch origin
git reset --hard origin/main

echo "▶ Building API image (this can take 1-3 min on first run)..."
docker compose -f docker-compose.prod.yml build api

echo "▶ Recreating container..."
docker compose -f docker-compose.prod.yml up -d --force-recreate api

echo "▶ Waiting 5s for boot..."
sleep 5

echo "▶ Health check:"
if curl -fsS http://127.0.0.1:3001/health | head -c 200; then
  echo
  echo "✅ API is healthy."
else
  echo "⚠ Health check failed — tailing logs:"
  docker compose -f docker-compose.prod.yml logs --tail=80 api
  exit 1
fi

echo "▶ Recent logs:"
docker compose -f docker-compose.prod.yml logs --tail=30 api
