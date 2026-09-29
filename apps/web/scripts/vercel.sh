#!/usr/bin/env bash
# El build de Celda en Vercel (ADR 0010). Lo lanza el deploy hook al que llama la ingesta nocturna
# tras publicar, y también cada push a la rama de producción.
#
# 1. Construye la web, que lee las capas de R2 (VITE_CAPAS_ORIGEN) y, si R2 no contesta, de /capas
#    (VITE_CAPAS_RESERVA).
# 2. Monta en dist/capas la copia de reserva: la versión vigente de R2, y solo esa, con
#    vigente.json escrito el último.
#
# Si no llega a R2, si falta un fichero o si alguno no coincide con su huella, el build falla y
# Vercel sigue sirviendo el despliegue anterior entero, web y copia.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VITE_CAPAS_ORIGEN:?Falta VITE_CAPAS_ORIGEN, la URL pública de lo publicado en R2}"
export VITE_CAPAS_RESERVA=/capas
pnpm run build
pnpm --filter @celda/nocturna run reserva "$VITE_CAPAS_ORIGEN" "$PWD/dist/capas"
