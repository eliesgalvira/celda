#!/usr/bin/env bash
# Monta en una carpeta el sitio estático como lo sirve Vercel: la web construida y, en /capas, la
# versión vigente de lo publicado y las dos anteriores, con las cabeceras de vercel.json. El
# despliegue de verdad lo hace el build de Vercel (scripts/vercel.sh); esto sirve para verlo en
# local (ADR 0018).
#
#   ./scripts/sitio.sh <carpeta de lo publicado> <carpeta de destino>
set -euo pipefail
publicado="$(realpath "$1")"
destino="$(realpath -m "$2")"
cd "$(dirname "$0")/.."
env --unset=VITE_CAPAS_ORIGEN pnpm run build
rm -rf "$destino"
mkdir -p "$destino"
cp -r dist/. "$destino/"
CELDA_ALMACEN_CARPETA="$publicado" pnpm --filter @celda/nocturna run capas "$destino/capas"
# Lo que se sirve ya está construido: sin las órdenes de build del proyecto.
node --eval '
  const fs = require("node:fs");
  const { buildCommand, installCommand, outputDirectory, framework, ...sitio } =
    JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  fs.writeFileSync(process.argv[1], JSON.stringify(sitio, null, 2) + "\n");
' "$destino/vercel.json"
echo "Sitio listo en $destino"
