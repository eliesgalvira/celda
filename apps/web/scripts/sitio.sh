#!/usr/bin/env bash
# Monta en una carpeta el sitio estático completo: la web construida y, en /capas, lo publicado
# (vigente.json, la capa y las fichas), con las cabeceras de vercel.json. Es lo que se sube a
# Vercel, como vista previa o como copia de reserva de las capas (ADR 0010).
#
#   ./scripts/sitio.sh <carpeta con lo publicado> <carpeta de destino>
#   npx vercel deploy <carpeta de destino>
set -euo pipefail
publicado="$(realpath "$1")"
destino="$(realpath -m "$2")"
cd "$(dirname "$0")/.."
test -f "$publicado/vigente.json" || { echo "No hay vigente.json en $publicado" >&2; exit 1; }
pnpm run build
rm -rf "$destino"
mkdir -p "$destino"
cp -r dist/. "$destino/"
cp -r "$publicado" "$destino/capas"
cp vercel.json "$destino/vercel.json"
echo "Sitio listo en $destino"
