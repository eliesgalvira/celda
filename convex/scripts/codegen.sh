#!/usr/bin/env bash
# `confect codegen` sin dejar restos.
#
# Confect carga cada tabla, spec e impl de `confect/` con bundle-require, que escribe el bundle
# junto al fuente (`confect/publicacion.impl.bundled_<id>.mjs`), lo importa y lo borra en un
# `finally`. Si el proceso muere de golpe entre escribirlo y borrarlo (SIGKILL: un `timeout -k`, el
# OOM killer, una tarea que se mata entera), ese `finally` no corre y el fichero se queda. Con
# Ctrl+C no suele pasar: Node espera a que acabe la importación y la borra. El que queda casi
# siempre es el de `publicacion.impl.ts`: pesa 2,3 MB porque arrastra `@effect/platform-node`, y su
# importación es la más lenta (unos 180 ms). Confect no deja cambiar dónde se escribe.
#
# Aquí se borran los restos al empezar y, si codegen falla o se corta, también al salir. Al empezar
# solo se borran los de más de un minuto: uno más nuevo puede ser de otro codegen que corre ahora
# mismo (`typecheck` en otra terminal) y borrárselo lo haría fallar. Si se mata también este
# script, quedan hasta el siguiente codegen; mientras, `.gitignore`, el lint y el formateador los
# ignoran (`vite.config.ts` de la raíz).
set -euo pipefail
cd "$(dirname "$0")/.."

restos() { find confect -name '*.bundled_*' -type f "$@"; }

restos -mmin +1 -delete
trap 'restos -delete; exit 130' INT
trap 'restos -delete; exit 143' TERM
if ! pnpm exec confect codegen "$@"; then
  restos -delete
  exit 1
fi
