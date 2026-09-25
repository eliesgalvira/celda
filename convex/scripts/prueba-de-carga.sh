#!/usr/bin/env bash
# Prueba de carga contra el backend local (scripts/backend.sh): guarda 2400 observaciones
# sintéticas de la fuente «opencellid» y fusiona dos veces. La segunda fusión no debe escribir
# nada. Deja datos falsos en la base: úsala solo en un backend local que se pueda borrar.
set -euo pipefail
cd "$(dirname "$0")/.."
for lote in $(seq 0 11); do
  pnpm exec convex run ingesta:aplicarListado "$(jq -nc --argjson l "$lote" '{
    fuente: "opencellid",
    fecha: 1,
    registros: [range($l * 200; $l * 200 + 200) | {
      clave: "SINTETICO - X\(.)",
      compania: (["movistar", "orange", "vodafone"][. % 3]),
      codigo: "X\(.)",
      posicion: {
        longitud: (2.06 + ((. * 7919) % 1600) / 10000),
        latitud: (41.32 + ((. * 104729) % 1400) / 10000)
      },
      direccion: "CL X, 1. BARCELONA, BARCELONA",
      municipio: "BARCELONA",
      url: "https://example.invalid/\(.)"
    }]
  }')"
done
time pnpm exec convex run ingesta:recalcularFusion '{"fecha": 2}'
time pnpm exec convex run ingesta:recalcularFusion '{"fecha": 3}'
