#!/usr/bin/env bash
# Backend local de Convex sin cuenta (modo anónimo). Por defecto en los puertos 3240 (API) y 3241
# (acciones HTTP); CELDA_CONVEX_PUERTO=3250 lo mueve a 3250 y 3251, por ejemplo para tener dos
# copias del repositorio a la vez. Guarda el estado en .convex/ y la URL en .env.local, los dos
# fuera de git.
set -euo pipefail
cd "$(dirname "$0")/.."
puerto="${CELDA_CONVEX_PUERTO:-3240}"
pnpm exec confect codegen
CONVEX_AGENT_MODE=anonymous exec pnpm exec convex dev \
  --local-cloud-port "$puerto" --local-site-port "$((puerto + 1))" --typecheck disable "$@"
