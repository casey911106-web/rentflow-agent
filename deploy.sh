#!/usr/bin/env bash
# Convention shim — rentflow-agent usa git-push + VPS-pull (NO rsync from local).
# Este archivo existe para que "bash deploy.sh desde la raíz" funcione igual
# que en los otros repos Familia A del workspace (ver WORKSPACE.md §Familia A).
#
# Lo que hace:
#   1. git push origin main (sube tus commits a GitHub)
#   2. ssh al VPS y corre bin/deploy.sh allá (que hace git fetch + reset --hard
#      origin/main + docker compose build/up + health check)
#
# ⚠️ NUNCA ejecutar ./bin/deploy.sh desde tu laptop — hace `git reset --hard
# origin/main` lo que destruye tus cambios locales sin commitear. Ese script
# está diseñado para correr DENTRO del VPS.

set -euo pipefail

REMOTE_DIR=/home/rentalho/apps/rentflow-agent
SSH_ALIAS=rentalho-vps   # alias en ~/.ssh/config — rentalho@89.40.15.250:2224

echo "▶ Pushing commits locales a origin/main..."
git push origin main

echo "▶ Disparando deploy en VPS ($SSH_ALIAS:$REMOTE_DIR/bin/deploy.sh)..."
ssh "$SSH_ALIAS" "cd $REMOTE_DIR && bash bin/deploy.sh"
