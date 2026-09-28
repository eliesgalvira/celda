# Convex e ingesta

Cómo está montado el backend, cómo se arranca en local y cómo se prueba. Las decisiones están en los ADR 0003 (Confect), 0009 (ingesta), 0012 (fusión) y 0015 (ingesta fuera de Convex).

La ingesta corre hoy en dos sitios que publican lo mismo: en Convex, con sus crons, y en la ingesta nocturna de `apps/nocturna`, un programa de Node con su estado en SQLite. Convex se retira cuando la nocturna lleve una semana publicando lo mismo (#51). Mientras tanto, cualquier cambio en el proceso o en la publicación vale para las dos, porque comparten el código.

## Dónde está cada cosa

```
convex/confect/tables/     una tabla por fichero, con esquema Effect
convex/confect/*.spec.ts   la API de cada grupo (ingesta, datos)
convex/confect/*.impl.ts   su implementación
convex/confect/crons.ts    el cron nocturno de la ingesta
convex/src/proceso.ts      la BaseDeIngesta sobre Convex y el proceso por puntos
convex/src/publicacion.ts  los datos de la publicación sacados de Convex
tools/capas/               la publicación a mano y el origen estático local
convex/convex/             generado por Confect y Convex; no se edita
packages/ingesta/          extractores (registro-oficial/, antenasmoviles/), sin nada de Convex
packages/ingesta/src/proceso.ts   el proceso de una ejecución sobre una BaseDeIngesta
packages/ingesta/src/guardado.ts  qué cambia en una observación con el listado, la ficha o un barrido
packages/publicacion/      la publicación, el almacén en carpeta o en R2 y la retención
packages/publicacion/datos/  los límites de barrio y de municipios y el padrón del INE, en git
packages/publicacion/datos/barrios.json   los límites de barrio que usa la publicación
packages/dominio/          esquemas y la fusión, sin E/S
apps/nocturna/             la ingesta nocturna: base SQLite, noche, estado y órdenes
```

`convex/convex/` y `convex/confect/_generated/` se guardan en git: las pruebas en memoria los necesitan. `pnpm run typecheck` ejecuta `confect codegen` antes de `tsc`, así que un cambio en una spec sin regenerar sale en los tipos.

Codegen se lanza siempre con `convex/scripts/codegen.sh` (`pnpm run codegen`, `typecheck` y `backend` lo usan). Confect importa cada fichero de `confect/` escribiendo antes su bundle al lado, `<fichero>.bundled_<id>.mjs`, y lo borra al acabar. Un codegen matado con SIGKILL justo entonces lo deja, casi siempre el de `publicacion.impl.ts` (2,3 MB, la importación más lenta). El script borra los restos, y `.gitignore`, el lint y el formateador no los miran.

La acción `ingesta:registroOficial` es fina: lee la configuración, monta el extractor real sobre `FetchHttpClient` y llama a `ejecutarIngesta`. El proceso (`packages/ingesta/src/proceso.ts`) no sabe dónde guarda: pide cada paso a una `BaseDeIngesta`. En Convex, esa base son sus funciones internas (`MutationRunner` y `QueryRunner` de Confect), y así se prueba igual en memoria que en el backend real. En la ingesta nocturna es la base SQLite.

## Ingesta nocturna

`apps/nocturna` es la ingesta y la publicación fuera de Convex (ADR 0015). Es un programa de Node 24 que hace la noche entera y se para: el registro oficial de las zonas de barrido de la noche (Cataluña, por defecto), la publicación y una copia de la base. El paquete de Nix y el módulo de NixOS que la lanzan cada noche están en [nixos.md](nixos.md). antenasmoviles.es llega con el #48 y el deploy hook de Vercel con el #46.

### Lanzarla en local

Desde la raíz de Celda, dentro de `nix develop`:

```sh
pnpm run ingesta noche      # ingesta, publicación y copia de seguridad
pnpm run ingesta estado     # última ejecución de cada fuente, fichas pendientes, errores y lo publicado
pnpm run ingesta publicar   # publica lo que haya en la base, sin pedir nada a las fuentes
pnpm run ingesta copia      # copia la base a la carpeta de copias
```

Cada orden construye `apps/nocturna/dist/nocturna.js`, un solo fichero, y lo ejecuta en `apps/nocturna`. Las rutas relativas de la configuración cuentan desde ahí: sin tocar nada, la base es `apps/nocturna/datos/ingesta.sqlite` y las copias van a `apps/nocturna/datos/copias/`, las dos fuera de git.

`noche` hace peticiones reales. Para probar contra el geoportal sin leer fichas, que son la mayor parte de las peticiones:

```sh
CELDA_INGESTA_MAX_FICHAS=0 \
CELDA_ALMACEN_CARPETA=$PWD/tools/capas/salida \
pnpm run ingesta noche
```

Con la zona de Cataluña por defecto, la primera noche son 38 peticiones, `robots.txt` y 37 de listado, y unos 2 min 30 s. La del 29/09/2026 trajo 10.305 registros de los 9 cuadros y publicó 5.049 emplazamientos en 40 lotes (investigación 08, «Primera pasada real de Cataluña»). Las noches siguientes piden solo las 30 cajas guardadas. Con `pnpm run servir` en `tools/capas`, la web en desarrollo lee esa carpeta.

### Configuración

Todo va en variables de entorno, con los valores de hoy por defecto (`apps/nocturna/src/configuracion.ts`):

| Variable | Por defecto | Qué es |
|---|---|---|
| `CELDA_INGESTA_BASE` | `datos/ingesta.sqlite` | La base SQLite |
| `CELDA_INGESTA_COPIAS` | `datos/copias` | Carpeta de las copias de seguridad |
| `CELDA_INGESTA_COPIAS_CONSERVADAS` | 14 | Copias que se conservan |
| `CELDA_INGESTA_MAX_FICHAS` | 250 | Fichas por noche |
| `CELDA_PUBLICAR_REINTENTO_MINUTOS` | 60 | Espera antes de repetir una publicación fallida |
| `CELDA_REGISTRO_ACTIVO` | `true` | Interruptor del registro oficial |
| `CELDA_REGISTRO_MOTIVO` | | Lo que se apunta si está apagado |
| `CELDA_REGISTRO_ZONAS` | `cataluna` | Zonas de barrido de cada noche, separadas por comas, o `ninguna` |
| `CELDA_REGISTRO_ZONAS_EN_TURNO` | `ninguna` | Zonas que se turnan |
| `CELDA_REGISTRO_ZONAS_POR_NOCHE` | 1 | Cuántas de las que se turnan se barren cada noche |
| `CELDA_REGISTRO_PAUSA_SEGUNDOS` | 3 | Pausa entre peticiones; nunca baja de 3 |
| `CELDA_REGISTRO_MAX_PETICIONES` | 300 | Tope de peticiones por noche, `robots.txt` y reintentos incluidos |
| `CELDA_REGISTRO_REINTENTOS` | 3 | Reintentos de un fallo pasajero |
| `CELDA_REGISTRO_ESPERA_SEGUNDOS` | 10 | Tiempo máximo de una respuesta |
| `CELDA_REGISTRO_USER_AGENT` | `Celda (ingesta; contacto en celda.elies.site)` | Se envía en cada petición |

Las zonas son `cataluna`, `centro` (Madrid y Castilla-La Mancha), `andalucia` (con Ceuta y Melilla), `levante` (Comunitat Valenciana, Murcia e Illes Balears), `norte` (Galicia, Asturias, Cantabria y País Vasco), `ebro-y-duero` (Castilla y León, Aragón, Navarra y La Rioja) y `oeste-y-canarias` (Extremadura y Canarias), con sus cuadros en `ZONAS_DE_BARRIDO` (`packages/dominio/src/barrido.ts`). Un nombre que no está ahí para el programa al arrancar. De las que se turnan va primero la que quedó a medias, luego las que nunca se han completado y luego las que llevan más tiempo sin completarse. Toda España en siete noches y Cataluña todas:

```sh
CELDA_REGISTRO_ZONAS=cataluna \
CELDA_REGISTRO_ZONAS_EN_TURNO=centro,andalucia,levante,norte,ebro-y-duero,oeste-y-canarias \
pnpm run ingesta noche
```

`robots.txt` se respeta siempre. El grupo que se aplica es el del primer producto del `User-Agent`, así que cambiarlo cambia también con qué nombre se busca a Celda en él. El almacén se elige como en Convex: `CELDA_ALMACEN_CARPETA` o las cuatro de R2, con `CELDA_ALMACEN_ORIGEN` (`almacenDesdeConfig` en `packages/publicacion`). Sin almacén, la noche ingiere y apunta `sin-almacen`.

Las variables también pueden llegar como credenciales de systemd: el programa lee cada fichero de `$CREDENTIALS_DIRECTORY` en formato `.env`, detrás de las variables de entorno (`apps/nocturna/src/credenciales.ts`). Así pasa el módulo de NixOS los secretos de R2 sin ponerlos en el entorno.

### La base

La base se abre con el módulo `node:sqlite` de Node 24 a través de `@effect/sql-sqlite-node`, que en Effect 4 usa ese módulo y no trae extensiones nativas. Tablas (`apps/nocturna/src/base.ts`):

- `observaciones`: lo último que dice cada fuente de cada estación base, cuándo se leyó su ficha, si está retirada, su cuadro y cuándo la trajo un listado por última vez;
- `cuadros`: las cajas en que se dividió cada cuadro la última vez;
- `barridos` y `cuadros_barridos`: cada barrido de una zona, con sus cuadros, y los cuadros que ya ha guardado;
- `emplazamientos`: los de la última fusión, con la fecha en que cambió cada uno;
- `ejecuciones`: cada pasada de un extractor, con sus cambios, sus errores, lo que hizo cada zona (cuadros, peticiones, bytes, registros y cambios) y cómo acabó la publicación de su noche;
- `publicaciones`: cada intento de publicar;
- `versiones` y `ficheros_publicados`: lo publicado, con el SHA-256 de cada fichero.

El esquema lleva su versión en `PRAGMA user_version`, y una base vieja se pone al día al abrirla. Cada paso de la noche escribe en su propia transacción. Si la noche se corta, su ejecución queda en curso; la siguiente la da por interrumpida y rehace el trabajo, y acaba igual que si no se hubiera cortado.

### El barrido por zonas

Cada zona de barrido tiene sus cuadros de 1° (ADR 0014). En cada cuadro la noche pide las cajas guardadas de la vez anterior, o el cuadro entero la primera vez. Una caja que llega a los 1000 registros no se guarda ni se usa: se piden sus cuatro cuartos, hasta ocho divisiones (cajas de unos 400 m). Si aún llega al tope, el cuadro falla, porque le faltarían registros sin que nadie lo supiera.

Cada cuadro se guarda en una transacción, con sus registros, sus cajas y la marca de hecho. Si la noche se corta a mitad de una zona, el barrido queda a medias y la noche siguiente sigue por el primer cuadro sin guardar. Cuando todas las zonas de la noche han acabado, se cierran sus barridos. Cerrar cuenta una ausencia a las observaciones vigentes de sus cuadros que ningún listado ha traído desde que empezó el barrido. Por eso una estación que se mueve a un cuadro de otra zona no se retira: el listado de la otra zona la trae, y su cuadro pasa a ser el nuevo.

Un barrido falla, y no cuenta ausencias, si un cuadro falla o si vuelve vacío cuando la base tiene estaciones en él. Las demás zonas siguen. El tope de peticiones, `robots.txt` o una fuente que no responde ni tras los reintentos paran las zonas que quedan y las fichas. La ejecución queda completada si alguna zona se ha barrido.

`node:sqlite` es síncrono. Si una conexión espera el cerrojo de otra del mismo proceso, bloquea el bucle de eventos y la otra no puede soltarlo. Por eso abrir una base al día no toma el cerrojo de escritura, y `estado` se puede lanzar en mitad de una noche desde otro proceso.

### Publicar y copias

Al final de la noche se publica siempre: sin cambios no se escribe nada, y si la noche anterior no pudo publicar, esta lo hace. Si falla porque el almacén o la base no responden, o porque los datos se movieron a mitad, se apunta en `publicaciones` y en las ejecuciones de la noche, se espera una hora y se intenta otra vez. Si vuelve a fallar, queda para la noche siguiente. Los datos ya están en la base.

Después, `VACUUM INTO` copia la base a `ingesta-<fecha>.sqlite` en la carpeta de copias, y se borran las más viejas hasta dejar catorce. Para restaurar, para la ingesta y copia una de ellas encima de la base:

```sh
cp datos/copias/ingesta-2026-09-28T21-40-45.318Z.sqlite datos/ingesta.sqlite
rm -f datos/ingesta.sqlite-wal datos/ingesta.sqlite-shm
```

### Pruebas

`apps/nocturna/src/programa.test.ts` lanza noches enteras con una base en una carpeta temporal, el almacén en carpeta y el registro oficial grabado de Campus Nord, que contesta cada caja como el geoportal (`capaGrabadaPorCajas`). Comprueba que una noche publica la capa y sus fichas, que repetirla sin cambios no escribe nada, que una noche cortada se retoma y deja la misma base y el mismo almacén, que una baja pide dos barridos, que las copias se abren y se restauran y solo quedan catorce, que una publicación fallida se repite a la hora o la noche siguiente, y el interruptor, el estado y la configuración. Las esperas de la publicación se prueban con el `TestClock`; la base y el almacén son ficheros de verdad, así que esas pruebas esperan también con el reloj real (`TestClock.withLive`) a que la noche llegue a publicar.

`apps/nocturna/src/barrido.test.ts` prueba el barrido por zonas con dos zonas de un cuadro: que una pasada sin cambios pide solo las cajas guardadas, que una zona que falla no cuenta ausencias en ninguna, que retirar pide dos barridos de la misma zona también por turnos, que una estación que cambia de zona no se retira, que un cuadro vacío con estaciones es un fallo, que un barrido cortado se retoma sin repetir cuadros y deja la misma base, el tope tras ocho divisiones y una base de la versión 1 del esquema. `packages/ingesta/src/barrido.test.ts` recorre con el extractor real los listados grabados de Barcelona y del centro de Madrid, servidos como el geoportal, con el tope de 1000: no pierde ningún registro y hace las mismas peticiones que la simulación de `muestras/espana/teselas.mjs`.

`convex/test/nocturna.test.ts` comprueba que las dos ingestas publican lo mismo. Hace las mismas noches en Convex en memoria y en la nocturna, con las mismas respuestas grabadas y a la misma hora, y compara byte a byte las dos carpetas tras cada noche: con cambios, una baja, una alta y las fichas repartidas en varias noches. Se borra con la ingesta de Convex (#51).

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

La web no lee nada de Convex: descarga `vigente.json`, la capa y los lotes de fichas de un almacén de ficheros estático (ADR 0004, 0008 y 0010). Los escribe `publicar` (`packages/publicacion/src/publicar.ts`), que lee la instantánea de un servicio `DatosPublicables`: Convex en `convex/src/publicacion.ts` y la base SQLite en la ingesta nocturna. Así:

1. Lee `datos:version`. Si `vigente.json` del almacén ya apunta a esa versión, termina sin escribir nada. Si apunta a una posterior, falla (`VigentePosterior`): no retrocede.
2. Lee la instantánea (en Convex, con `capas:instantanea`, por páginas de 250 emplazamientos) con sus compañías y las bandas conocidas de cada una, y vuelve a leer `datos:version`. Si ha cambiado entre medias, falla sin escribir nada (`InstantaneaMovida`) y basta con repetir.
3. Genera la capa, con el barrio de cada emplazamiento según `packages/publicacion/datos/barrios.json` y su lote de fichas.
4. Lee las fichas de cada lote con `capas:fichas`, les pone el municipio y la provincia según `packages/publicacion/datos/municipios.json` y escribe `fichas@<fecha>/<lote>.json`, cuatro lotes a la vez. Si falta alguna ficha, los datos han cambiado.
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

Los límites de barrio se descargan de Open Data BCN con `pnpm run barrios`, también desde `tools/capas`. Son dos peticiones con 10 s entre ellas; hazlo solo cuando el Ayuntamiento publique límites nuevos y revisa el diff de `packages/publicacion/datos/barrios.json` antes del commit. `CELDA_BARRIOS` cambia la ruta del fichero. Por qué se guardan en git y no van en la ingesta: ADR 0004.

Los municipios, las provincias y el padrón se descargan con `pnpm run municipios`, desde `tools/capas`. Lánzala cuando el IGN cambie la fecha de su canal o cuando el INE publique el padrón del año, hacia diciembre. Pide el `robots.txt` de cada sitio, espera 5 s entre dos peticiones al mismo y hace siete como mucho. El ZIP del IGN (66 MB) se queda en `~/.cache/celda` (o en `CELDA_CACHE`) con la fecha del canal en el nombre, así que repetir la orden sin cambios en el IGN solo pide cinco cosas pequeñas. `CELDA_MUNICIPIOS` y `CELDA_PADRON` cambian las rutas de los dos ficheros. Si la licencia deja de ser CC BY 4.0, si falta una fecha o si un municipio no está a los dos lados, falla sin escribir nada. Con el mismo ZIP y el mismo CSV salen los mismos bytes: revisa el diff antes del commit. `tools/capas/src/municipiosReales.test.ts` comprueba los ficheros del repositorio con puntos conocidos (Ceuta, Melilla, Llívia, Treviño, El Hierro, Bardenas Reales, el mar de la Barceloneta) y que la orden los volvería a escribir igual. Por qué se guardan en git: ADR 0017.

`datos:version` es la fecha de la última ejecución que cambió los emplazamientos. Un emplazamiento retirado se borra y no deja versión, así que la consulta también mira la última ejecución completada con retiradas. Sin eso, una noche que solo retirase emplazamientos daría el mismo nombre de capa con otro contenido.

### Vista previa

`apps/web/scripts/sitio.sh <publicado> <destino>` construye la web y monta en `<destino>` el sitio entero: la web, lo publicado en `/capas` y `apps/web/vercel.json` con las cabeceras. Después, `npx vercel deploy <destino>` lo sube como vista previa. El primer despliegue de un proyecto nuevo de Vercel va a producción aunque no se pida; para una vista previa en un proyecto nuevo, despliega con `--target preview` desde el principio.

## Ficha

`datos:ficha` (interna) y `capas:fichas` dan la `Ficha` de `packages/dominio/src/ficha.ts`, que sale de `leerFicha` (`convex/src/lecturas.ts`). La ficha lleva la dirección y el municipio tal como los escribe la fuente, cada estación base con sus bandas ordenadas por frecuencia y, por cada código, la observación de la que sale, con su fuente, su enlace y desde cuándo lo dice. Su `version` es la del emplazamiento, que cambia también cuando cambia una de sus estaciones. No lleva los `_id` de Convex. Ninguna fuente da nombre ni barrio a los emplazamientos, así que la ficha tampoco los tiene. El municipio y la provincia del IGN (`lugar`) no salen de Convex: los pone la publicación, y el lote cita su fuente una vez.

La web la lee con el servicio `FichasPublicadas` (`apps/web/src/ficha/servicio.ts`): busca el lote en la capa del mapa, lo descarga una vez por visita y, si el origen ya no tiene esa versión, lee la vigente. Así la marca de agua solo es posterior al mapa en ese caso (ADR 0004).

## Pruebas

Las de Convex tienen tres niveles, todos con `@effect/vitest` y sin mocks de módulos.

**Dominio.** La fusión se compara con ficheros de referencia en `packages/dominio/src/referencia/` y `packages/ingesta/src/registro-oficial/referencia/` (`toMatchFileSnapshot`). Si cambias la regla a propósito, regenera con `pnpm exec vp test run -u` en el paquete y revisa el diff de los JSON en el commit.

**Extractor.** `packages/ingesta/src/registro-oficial/extractor.test.ts` monta el extractor real sobre un `HttpClient` de prueba (una `Layer`) que apunta cada petición con la hora del `TestClock`. Así se comprueban el `User-Agent`, `robots.txt`, la pausa entre peticiones, los reintentos con espera exponencial y el tope de peticiones. Las esperas se encadenan tras respuestas asíncronas, y un solo `TestClock.adjust` no las ve todas; `esperarConReloj` (`packages/ingesta/src/pruebas/reloj.ts`) adelanta el reloj de segundo en segundo hasta que la fibra termina.

**antenasmoviles.es.** Las muestras de `docs/investigacion/muestras/antenasmoviles/` pasan por el analizador real en `packages/ingesta/src/antenasmoviles/`. No hay ninguna foto real con `desmantelada` puesta, así que `desmantelar` (`src/pruebas/antenasmoviles.ts`) añade una a un detalle grabado. `muestraAntenasMoviles` junta los 41 puntos de Campus Nord, el detalle real de la entrada del campus con Vodafone desmontada y dos ER5 reales. `convex/test/antenasmoviles.test.ts` la usa con `ejecutarDePuntos` para probar el interruptor, la idempotencia, la huella, el tope de detalles y la retirada.

**API de Convex.** `convex/test/` usa `@confect/test` (convex-test en memoria). `ejecutar(extractor)` en `convex/test/ayudas.ts` lanza `ejecutarIngesta` con `MutationRunner` y `QueryRunner` sacados del `TestConfect`, y el extractor que se le pase. El de prueba es `capaGrabada` con `muestraCampusNord`, el registro grabado en la investigación. Para comprobar que una ejecución no escribe nada, adelanta el reloj un día y compara `instantanea` antes y después: cualquier escritura por cambio habría movido una fecha.

El glob de la documentación de Confect no encuentra `convex/_generated` con Vite 8. `convex/test/TestConfect.ts` usa `import.meta.glob(["../convex/**/*.ts", "../convex/**/*.js", "!../convex/**/*.d.ts"])`.

`convex/test/publicacion.test.ts` publica sobre el Convex en memoria y el almacén en una carpeta temporal, envuelto para apuntar cada fichero que escribe. Comprueba que cada clave de la capa tiene su ficha en su lote, que publicar sin cambios no escribe nada, que la ingesta publica sola tras cada ejecución completada y no tras una omitida, que un fichero ocupado con otro contenido para la publicación sin tocar `vigente.json`, y que la retención deja la vigente, sus siete anteriores y las posteriores. Las versiones viejas de esa prueba se escriben a mano en la carpeta, sin publicarlas. `packages/publicacion/src/almacenes/r2.test.ts` prueba la firma con dos casos de la batería de AWS (uno con consulta) y el almacén de R2 contra un cubo S3 de prueba en memoria, que lista de dos en dos claves para obligar a pedir varias páginas.

Las pruebas de Convex corren en orden aleatorio. `pnpm run test:repetido` (desde `convex/`) las pasa cinco veces con semillas seguidas a partir de una al azar, y la CI lo hace en cada push. Si falla, el registro dice la semilla; `pnpm exec vp test run --sequence.seed=<semilla>` repite ese orden. Una carrera no siempre sale con la misma semilla: la de la retención (dos borrados que quitaban a la vez la carpeta de lotes, septiembre de 2026) necesitaba carga, y salió con cuatro bucles de la suite a la vez y `--pool=threads` o `--no-file-parallelism`. Si una prueba falla una vez y luego pasa, búscala así antes de repetirla.

La prueba de carga `convex/scripts/prueba-de-carga.sh` mete 2400 observaciones falsas en el backend local y fusiona dos veces. Deja basura: úsala en un backend que vayas a borrar.
