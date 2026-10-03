#!/usr/bin/env bash
# El build de Celda en Vercel (ADR 0018). Lo lanza el deploy hook al que llama la ingesta nocturna
# tras publicar, y también cada push a la rama de producción.
#
# 1. Construye la web, que lee las capas y las fichas de /capas, en su mismo origen.
# 2. Monta en dist/capas, desde el cubo privado de R2 y por su API S3, la versión vigente y los
#    ficheros de las dos anteriores, con vigente.json escrito el último. Las credenciales son las de
#    una clave de R2 de solo lectura, en las variables de entorno del proyecto de Vercel:
#    CELDA_R2_CUENTA, CELDA_R2_CUBO, CELDA_R2_ID_CLAVE y CELDA_R2_SECRETO.
#
# Si no llega a R2, si falta un fichero o si alguno no coincide con su huella, el build falla y
# Vercel sigue sirviendo el despliegue anterior entero, web y capas.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CELDA_R2_CUENTA:?Falta CELDA_R2_CUENTA: la cuenta de Cloudflare del cubo de R2}"
: "${CELDA_R2_CUBO:?Falta CELDA_R2_CUBO: el cubo de R2 con lo publicado}"
: "${CELDA_R2_ID_CLAVE:?Falta CELDA_R2_ID_CLAVE: la clave de R2 de solo lectura}"
: "${CELDA_R2_SECRETO:?Falta CELDA_R2_SECRETO: el secreto de la clave de R2 de solo lectura}"
# La web no ve las credenciales, y sin VITE_CAPAS_ORIGEN lee de /capas aunque el proyecto la tenga.
env --unset=CELDA_R2_ID_CLAVE --unset=CELDA_R2_SECRETO --unset=VITE_CAPAS_ORIGEN pnpm run build
pnpm --filter @celda/nocturna run capas "$PWD/dist/capas"
