# Convex e ingesta

Cómo está montado el backend, cómo se arranca en local y cómo se prueba. Las decisiones están en los ADR 0003 (Confect), 0009 (ingesta) y 0012 (fusión).

## Dónde está cada cosa

```
convex/confect/tables/     una tabla por fichero, con esquema Effect
convex/confect/*.spec.ts   la API de cada grupo (ingesta, datos)
convex/confect/*.impl.ts   su implementación
convex/confect/crons.ts    el cron nocturno de la ingesta
convex/src/proceso.ts      el proceso de una ejecución, fuera de Convex (por fichas y por puntos)
convex/src/publicacion.ts  la publicación de la capa y las fichas
convex/src/almacenes/      dónde se publica: una carpeta o R2
convex/datos/barrios.json  los límites de barrio que usa la publicación
tools/capas/               la publicación a mano y el origen estático local
convex/convex/             generado por Confect y Convex; no se edita
packages/ingesta/          extractores (registro-oficial/, antenasmoviles/), sin nada de Convex
packages/dominio/          esquemas y la fusión, sin E/S
```

`convex/convex/` y `convex/confect/_generated/` se guardan en git: las pruebas en memoria los necesitan. `pnpm run typecheck` ejecuta `confect codegen` antes de `tsc`, así que un cambio en una spec sin regenerar sale en los tipos.

Codegen se lanza siempre con `convex/scripts/codegen.sh` (`pnpm run codegen`, `typecheck` y `backend` lo usan). Confect importa cada fichero de `confect/` escribiendo antes su bundle al lado, `<fichero>.bundled_<id>.mjs`, y lo borra al acabar. Un codegen matado con SIGKILL justo entonces lo deja, casi siempre el de `publicacion.impl.ts` (2,3 MB, la importación más lenta). El script borra los restos, y `.gitignore`, el lint y el formateador no los miran.

La acción `ingesta:registroOficial` es fina: lee la configuración, monta el extractor real sobre `FetchHttpClient` y llama a `ejecutarIngesta`. Todo lo que hace el proceso pasa por funciones internas de Convex (`MutationRunner` y `QueryRunner` de Confect), y así se prueba igual en memoria que en el backend real.

## Backend local

Sin cuenta, con el modo anónimo de Convex, en los puertos 3240 (API) y 3241 (acciones HTTP). Desde `convex/`, dentro de `nix develop`:

```sh
pnpm run backend        # codegen + convex dev; déjalo en otra terminal
CELDA_CONVEX_PUERTO=3250 pnpm run backend   # en 3250 y 3251, si 3240 está ocupado
```

Guarda el estado en `.convex/` y la URL en `.env.local`, los dos fuera de git. Para empezar de cero, para el backend y borra `.convex/local` y `.env.local`.

Nada más desplegar, el cron queda programado para las 2:15 UTC. Si no quieres que el backend local descargue de verdad esa noche, apaga el interruptor:

```sh
pnpm exec convex run ingesta:cambiarInterruptor '{"fuente":"registro-oficial","activo":false,"motivo":"backend local"}'
```

Otras órdenes útiles:

```sh
pnpm exec convex env set CELDA_INGESTA_MAX_FICHAS 5   # pocas fichas en una prueba real
pnpm exec convex run ingesta:registroOficial          # una ejecución ahora, con descarga real
pnpm exec convex run ingesta:estado                   # interruptores y últimas ejecuciones
pnpm exec convex run datos:version                    # versión de los datos y «consultado el»
pnpm exec convex run datos:ficha '{"clave":"movistar-0802532"}'
pnpm exec convex run ingesta:recalcularFusion         # vuelve a fusionar sin descargar nada, y publica
pnpm exec convex export --path /tmp/celda.zip         # todas las tablas en JSONL
```

`unzip` rechaza el zip de `convex export` como posible bomba; se abre con `UNZIP_DISABLE_ZIPBOMB_DETECTION=TRUE unzip`. Para no volver a descargar el registro oficial, un backend nuevo se puede llenar con la exportación de otro: `pnpm exec convex import --replace -y /tmp/celda.zip`.

Una descarga real del registro oficial hace unas 11 peticiones con 5 fichas: `robots.txt`, 5 de listado y las fichas, con 3 s entre cada una. Hazla solo cuando haga falta y con el interruptor apagado después.

### Lo que hay que saber

- `convex dev` no siempre vuelve a desplegar cuando cambian `src/` o los paquetes del monorepo. Si el log no dice «Convex functions ready» con la hora nueva, toca un fichero de `convex/convex/` o reinicia el backend.
- Convex corta una función que lee más de 4096 documentos. Por eso la fusión lee las observaciones y las claves por páginas de 1000 y escribe los emplazamientos en lotes de 100. `cerrarBarrido` lee de una vez las observaciones de una fuente (unas 2400 en la caja de Barcelona); para una zona más grande habría que repartirlo.
- La primera descarga real, sin el parámetro `zoom` y con las coordenadas tal cual, recibió `{}`. Con `zoom=4` y seis decimales, como el visor y los scripts de la investigación, llegaron los 2380 registros. Por eso una zona entera vacía cuenta como fallo de la fuente y no como «no hay estaciones».
- `TextDecoder` en el runtime de Convex solo garantiza UTF-8; el Latin-1 del geoportal se decodifica a mano (`packages/ingesta/src/texto.ts`).

## antenasmoviles.es

> **El interruptor de antenasmoviles.es empieza apagado y así tiene que quedarse.** La investigación de fuentes comunitarias recomienda escribir a `admin@antenasmoviles.es` antes de publicar nada suyo, y el autor aún no ha decidido. Hasta entonces no lo enciendas en ningún despliegue público. En local, enciéndelo solo para una prueba y apágalo después.

El extractor y la fusión están completos. Sin fila en `interruptores`, `INTERRUPTOR_POR_DEFECTO` (`confect/tables/interruptores.ts`) deja el registro oficial encendido y antenasmoviles.es y OpenCelliD apagados. El cron `ingesta de antenasmoviles.es` corre a las 3:15 UTC, una hora después del registro, y con el interruptor apagado solo apunta una ejecución omitida.

```sh
pnpm exec convex run ingesta:cambiarInterruptor '{"fuente":"antenasmoviles","activo":true,"motivo":"prueba local"}'
pnpm exec convex run ingesta:antenasMoviles     # una ejecución ahora, con peticiones reales
pnpm exec convex run ingesta:cambiarInterruptor '{"fuente":"antenasmoviles","activo":false,"motivo":"apagado tras la prueba"}'
```

Cómo funciona:

- La fuente no tiene una ficha por estación sino puntos, los marcadores de su mapa. `GET /v1/showf?er5` da todos los de España de una vez (4 MB). El extractor busca con una expresión regular el principio de cada fila y solo analiza las de la caja de Barcelona, porque el runtime de Convex tiene poca memoria. La descarga del 26/09/2026 dio 42.851 filas y 1309 puntos en la caja.
- La fuente no manda `ETag`. Cada punto guarda la huella FNV-1a de su fila (`packages/ingesta/src/huella.ts`) en la tabla `puntos`. Un punto nuevo o con otra huella queda pendiente de leer su detalle (`GET /v1/markers?id=<códigos>`).
- Cada noche se leen como mucho 100 detalles (`CELDA_ANTENASMOVILES_MAX_DETALLES`), a una petición cada 5 s: unos 8 minutos, dentro del límite de una acción. Primero las ER5, luego los nuevos o cambiados y luego los leídos hace más de 14 días. Las fotos nuevas no cambian la huella, y esa vuelta cada 14 días es lo que las encuentra. El tope de peticiones por ejecución es 110 (`CELDA_ANTENASMOVILES_MAX_PETICIONES`).
- Del detalle solo se guardan las correcciones: cada ER5 como observación `presente` y cada estación del registro cuya foto más reciente lleva `desmantelada` como `desmontada`. Lo demás copia el registro y no se guarda. Tampoco se copian fotos ni historial: `/archive` está en `Disallow` y no hacen falta para el estado.
- Un 403 o una página HTML donde debería haber JSON cuenta como fuente bloqueada. Si pasa en el listado, la ejecución queda fallida sin tocar nada. Si pasa en un detalle, se deja de pedir y los pendientes quedan para la noche siguiente.
- Un punto que falta en dos barridos seguidos se retira con sus observaciones. Cada observación apunta el punto del que salió (`punto`), así que si la fuente reagrupa códigos y otro punto se la queda, retirar el viejo no la borra.
- La ejecución apunta los puntos creados, cambiados y retirados en `cambios.puntos`, y los detalles leídos en `cambios.fichas`.

Recuento con la descarga del 26/09/2026 y el registro oficial de ese día, en la caja de Barcelona: 42 ER5, dos sin compañía (`er5` a secas) y 40 con ella. Con la fusión salen 1354 emplazamientos: 1317 verificados, 36 nuevos (tres compartidos por dos compañías) y uno corregido, Urquinaona, donde una ER5 de Orange queda a 7 m de Movistar. No hay conflictos. Las fotos «desmantelada» no se pueden contar sin leer los ~1300 detalles, y en los cinco detalles grabados no hay ninguna.

## Publicación

La web no lee nada de Convex: descarga `vigente.json`, la capa y los lotes de fichas de un almacén de ficheros estático (ADR 0004, 0008 y 0010). Los escribe `publicar` (`convex/src/publicacion.ts`), así:

1. Lee `datos:version`. Si `vigente.json` del almacén ya apunta a esa versión, termina sin escribir nada. Si apunta a una posterior, falla (`VigentePosterior`): no retrocede.
2. Lee la instantánea con `capas:instantanea`, por páginas de 250 emplazamientos con sus compañías y las bandas conocidas de cada una, y vuelve a leer `datos:version`. Si ha cambiado entre medias, falla sin escribir nada (`InstantaneaMovida`) y basta con repetir.
3. Genera la capa, con el barrio de cada emplazamiento según `convex/datos/barrios.json` y su lote de fichas.
4. Lee las fichas de cada lote con `capas:fichas` y escribe `fichas@<fecha>/<lote>.json`, cuatro lotes a la vez. Si falta alguna ficha, los datos han cambiado.
5. Vuelve a comprobar la versión, escribe `sitios@<fecha>.json` y la registra con `capas:registrar`.
6. Escribe `vigente.json`, el último.
7. Borra las versiones que sobran: se quedan la vigente y las 7 anteriores (`VERSIONES_ANTERIORES`). Lo hace también cuando no había nada que publicar, así que un borrado fallido se repite la noche siguiente sin más.

Ningún fichero se pisa con otro contenido: si existe distinto, falla con `FicheroInmutable` y `vigente.json` no cambia. La fecha es la de la versión de los datos, al segundo.

El paso 7 (`retirarVersionesViejas`) lista el almacén entero y mira el sello de cada fichero (`sitios@<fecha>.json`, `fichas@<fecha>/<lote>.json`). Nunca borra la vigente ni una versión posterior, que puede ser otra publicación a medias. De cada versión retirada va primero la capa y después los lotes. Un fallo al borrar no hace fallar la publicación: sale como aviso en el registro. Por qué siete, en el ADR 0010.

La publicación es automática. `ejecutarIngesta` y `ejecutarIngestaDePuntos` llaman al servicio `Publicacion` al acabar cada ejecución completada (no las omitidas ni las fallidas), y `ingesta:recalcularFusion` también. En las acciones, ese servicio lanza `publicacion:publicar`, una acción de Node. Un fallo al publicar no deshace la ejecución: se apunta en el registro y la siguiente ingesta lo repite.

Dónde escribe lo dicen las variables de entorno del despliegue:

```sh
pnpm exec convex env set CELDA_ALMACEN_CARPETA /ruta/absoluta/capas   # backend local: una carpeta
pnpm exec convex env set CELDA_ALMACEN_ORIGEN http://127.0.0.1:8852    # URL pública de esa carpeta
# producción: CELDA_R2_CUENTA, CELDA_R2_CUBO, CELDA_R2_ID_CLAVE y CELDA_R2_SECRETO (ADR 0010)
pnpm exec convex run publicacion:publicar                             # publicar ahora, a mano
```

Sin ninguna, `publicar` devuelve `sin-almacen` y no escribe nada. La carpeta solo tiene sentido con el backend local, porque la acción de Node corre en tu máquina.

Para publicar desde un despliegue sin configurarle almacén, `tools/capas` hace lo mismo por la API HTTP de Convex con la clave de administración. En local, desde `tools/capas`:

```sh
pnpm run publicar:local   # construye, lee la URL y la clave del backend local y publica en salida/
pnpm run servir           # sirve salida/ en http://127.0.0.1:8852, déjalo abierto
```

`servir` da a `vigente.json` una caché de cero segundos y al resto un año, como la CDN. La web en desarrollo lee de `VITE_CAPAS_ORIGEN`, que `apps/web/.env.development` pone en ese puerto; en la build, sin la variable, lee de `/capas` en su mismo origen.

Para otro despliegue, `pnpm run publicar` con `CELDA_CONVEX_URL`, `CELDA_CONVEX_CLAVE_ADMIN`, `CELDA_CAPAS_ORIGEN` (la URL desde la que la web descargará los ficheros) y `CELDA_CAPAS_CARPETA`. `servir` escucha en el puerto de `CELDA_CAPAS_ORIGEN`.

Los límites de barrio se descargan de Open Data BCN con `pnpm run barrios`, también desde `tools/capas`. Son dos peticiones con 10 s entre ellas; hazlo solo cuando el Ayuntamiento publique límites nuevos y revisa el diff de `convex/datos/barrios.json` antes del commit. `CELDA_BARRIOS` cambia la ruta del fichero. Por qué se guardan en git y no van en la ingesta: ADR 0004.

`datos:version` es la fecha de la última ejecución que cambió los emplazamientos. Un emplazamiento retirado se borra y no deja versión, así que la consulta también mira la última ejecución completada con retiradas. Sin eso, una noche que solo retirase emplazamientos daría el mismo nombre de capa con otro contenido.

### Vista previa

`apps/web/scripts/sitio.sh <publicado> <destino>` construye la web y monta en `<destino>` el sitio entero: la web, lo publicado en `/capas` y `apps/web/vercel.json` con las cabeceras. Después, `npx vercel deploy <destino>` lo sube como vista previa. El primer despliegue de un proyecto nuevo de Vercel va a producción aunque no se pida; para una vista previa en un proyecto nuevo, despliega con `--target preview` desde el principio.

## Ficha

`datos:ficha` (interna) y `capas:fichas` dan la `Ficha` de `packages/dominio/src/ficha.ts`, que sale de `leerFicha` (`convex/src/lecturas.ts`). La ficha lleva la dirección y el municipio, cada estación base con sus bandas ordenadas por frecuencia y, por cada código, la observación de la que sale, con su fuente, su enlace y desde cuándo lo dice. Su `version` es la del emplazamiento, que cambia también cuando cambia una de sus estaciones. No lleva los `_id` de Convex. Ninguna fuente da nombre ni barrio a los emplazamientos, así que la ficha tampoco los tiene.

La web la lee con el servicio `FichasPublicadas` (`apps/web/src/ficha/servicio.ts`): busca el lote en la capa del mapa, lo descarga una vez por visita y, si el origen ya no tiene esa versión, lee la vigente. Así la marca de agua solo es posterior al mapa en ese caso (ADR 0004).

## Pruebas

Tres niveles, todos con `@effect/vitest` y sin mocks de módulos.

**Dominio.** La fusión se compara con ficheros de referencia en `packages/dominio/src/referencia/` y `packages/ingesta/src/registro-oficial/referencia/` (`toMatchFileSnapshot`). Si cambias la regla a propósito, regenera con `pnpm exec vp test run -u` en el paquete y revisa el diff de los JSON en el commit.

**Extractor.** `packages/ingesta/src/registro-oficial/extractor.test.ts` monta el extractor real sobre un `HttpClient` de prueba (una `Layer`) que apunta cada petición con la hora del `TestClock`. Así se comprueban el `User-Agent`, `robots.txt`, la pausa entre peticiones, los reintentos con espera exponencial y el tope de peticiones. Las esperas se encadenan tras respuestas asíncronas, y un solo `TestClock.adjust` no las ve todas; `esperarConReloj` (`packages/ingesta/src/pruebas/reloj.ts`) adelanta el reloj de segundo en segundo hasta que la fibra termina.

**antenasmoviles.es.** Las muestras de `docs/investigacion/muestras/antenasmoviles/` pasan por el analizador real en `packages/ingesta/src/antenasmoviles/`. No hay ninguna foto real con `desmantelada` puesta, así que `desmantelar` (`src/pruebas/antenasmoviles.ts`) añade una a un detalle grabado. `muestraAntenasMoviles` junta los 41 puntos de Campus Nord, el detalle real de la entrada del campus con Vodafone desmontada y dos ER5 reales. `convex/test/antenasmoviles.test.ts` la usa con `ejecutarDePuntos` para probar el interruptor, la idempotencia, la huella, el tope de detalles y la retirada.

**API de Convex.** `convex/test/` usa `@confect/test` (convex-test en memoria). `ejecutar(extractor)` en `convex/test/ayudas.ts` lanza `ejecutarIngesta` con `MutationRunner` y `QueryRunner` sacados del `TestConfect`, y el extractor que se le pase. El de prueba es `capaGrabada` con `muestraCampusNord`, el registro grabado en la investigación. Para comprobar que una ejecución no escribe nada, adelanta el reloj un día y compara `instantanea` antes y después: cualquier escritura por cambio habría movido una fecha.

El glob de la documentación de Confect no encuentra `convex/_generated` con Vite 8. `convex/test/TestConfect.ts` usa `import.meta.glob(["../convex/**/*.ts", "../convex/**/*.js", "!../convex/**/*.d.ts"])`.

`convex/test/publicacion.test.ts` publica sobre el Convex en memoria y el almacén en una carpeta temporal, envuelto para apuntar cada fichero que escribe. Comprueba que cada clave de la capa tiene su ficha en su lote, que publicar sin cambios no escribe nada, que la ingesta publica sola tras cada ejecución completada y no tras una omitida, que un fichero ocupado con otro contenido para la publicación sin tocar `vigente.json`, y que la retención deja la vigente, sus siete anteriores y las posteriores. Las versiones viejas de esa prueba se escriben a mano en la carpeta, sin publicarlas. `almacenR2.test.ts` prueba la firma con dos casos de la batería de AWS (uno con consulta) y el almacén de R2 contra un cubo S3 de prueba en memoria, que lista de dos en dos claves para obligar a pedir varias páginas.

Las pruebas de Convex corren en orden aleatorio. `pnpm run test:repetido` (desde `convex/`) las pasa cinco veces con semillas seguidas a partir de una al azar, y la CI lo hace en cada push. Si falla, el registro dice la semilla; `pnpm exec vp test run --sequence.seed=<semilla>` repite ese orden. Una carrera no siempre sale con la misma semilla: la de la retención (dos borrados que quitaban a la vez la carpeta de lotes, septiembre de 2026) necesitaba carga, y salió con cuatro bucles de la suite a la vez y `--pool=threads` o `--no-file-parallelism`. Si una prueba falla una vez y luego pasa, búscala así antes de repetirla.

La prueba de carga `convex/scripts/prueba-de-carga.sh` mete 2400 observaciones falsas en el backend local y fusiona dos veces. Deja basura: úsala en un backend que vayas a borrar.
