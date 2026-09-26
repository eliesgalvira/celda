#!/usr/bin/env bash
# Lanza el generador contra el backend local de Convex (convex/scripts/backend.sh). Lee su URL de
# convex/.env.local y su clave de administración de convex/.convex/local/default/config.json.
# Hay que construir antes: `pnpm run publicar:local` lo hace.
set -euo pipefail
cd "$(dirname "$0")/.."
convex=../../convex
url=$(sed -n 's/^CONVEX_URL=//p; s/^VITE_CONVEX_URL=//p' "$convex/.env.local" | head -n 1)
clave=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).adminKey)' \
  "$convex/.convex/local/default/config.json")
CELDA_CONVEX_URL="$url" CELDA_CONVEX_CLAVE_ADMIN="$clave" exec node dist/capas.js "$@"
