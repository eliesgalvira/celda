#!/usr/bin/env bash
# Monta en una carpeta el sitio estático como lo sirve Vercel: la web construida y, en /capas, la
# versión vigente de lo publicado, con las cabeceras de vercel.json. El despliegue de verdad lo
# hace el build de Vercel (scripts/vercel.sh); esto sirve para verlo en local o para subirlo a
# mano si el deploy hook falla (ADR 0010).
#
#   ./scripts/sitio.sh <carpeta o URL de lo publicado> <carpeta de destino>
#   npx vercel deploy <carpeta de destino>
set -euo pipefail
publicado="$1"
destino="$(realpath -m "$2")"
cd "$(dirname "$0")/.."
case "$publicado" in
  http://* | https://*) ;;
  *) publicado="$(realpath "$publicado")" ;;
esac
pnpm run build
rm -rf "$destino"
mkdir -p "$destino"
cp -r dist/. "$destino/"
pnpm --filter @celda/nocturna run reserva "$publicado" "$destino/capas"
# Lo que se sube ya está construido: sin las órdenes de build del proyecto.
node --eval '
  const fs = require("node:fs");
  const { buildCommand, installCommand, outputDirectory, framework, ...sitio } =
    JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  fs.writeFileSync(process.argv[1], JSON.stringify(sitio, null, 2) + "\n");
' "$destino/vercel.json"
echo "Sitio listo en $destino"
