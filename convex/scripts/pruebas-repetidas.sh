#!/usr/bin/env bash
# Pasa las pruebas de Convex varias veces, cada una en otro orden. Una prueba que depende del
# orden o de una carrera suele salir en alguna de las vueltas; la semilla que la hizo fallar se
# puede repetir con `pnpm exec vp test run --sequence.seed=<semilla>`.
#
#   ./scripts/pruebas-repetidas.sh [vueltas] [primera semilla] [opciones de vp test run]
#
# Sin primera semilla sale una al azar, así que cada ejecución de la CI prueba órdenes nuevos.
set -euo pipefail
cd "$(dirname "$0")/.."
vueltas="${1:-5}"
primera="${2:-$((RANDOM * 32768 + RANDOM))}"
for ((i = 0; i < vueltas; i++)); do
  semilla=$((primera + i))
  if ! pnpm exec vp test run --sequence.seed="$semilla" --reporter=dot "${@:3}"; then
    echo "Las pruebas de Convex fallan con --sequence.seed=$semilla" >&2
    exit 1
  fi
done
echo "Pruebas de Convex en verde en $vueltas órdenes, semillas $primera a $((primera + vueltas - 1))"
