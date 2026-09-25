#!/usr/bin/env bash
# Backend local de Convex sin cuenta (modo anónimo), en los puertos 3240 (API) y 3241 (acciones
# HTTP). Guarda el estado en .convex/ y la URL en .env.local, los dos fuera de git.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm exec confect codegen
CONVEX_AGENT_MODE=anonymous exec pnpm exec convex dev \
  --local-cloud-port 3240 --local-site-port 3241 --typecheck disable "$@"
