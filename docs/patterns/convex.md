# Convex e ingesta

Cómo están montados la ingesta, la publicación y Convex, cómo se arrancan en local y cómo se prueban. Las decisiones están en los ADR 0003 (Confect), 0009 (ingesta), 0012 (fusión), 0015 (ingesta fuera de Convex) y 0020 (buzón de aportaciones).

Dónde corre cada cosa:

- **La ingesta y la publicación** corren en la ingesta nocturna de `apps/nocturna`, un programa de Node 24 con su estado en SQLite que lanza cada noche un temporizador de systemd ([nixos.md](nixos.md)). Publica en R2, y el build de Vercel sirve lo publicado (ADR 0018).
- **Convex** tiene un solo papel desde el #51: el buzón de las aportaciones compartidas (#56, ADR 0020). El mapa no lee de él. Ver [Convex](#convex).

## Dónde está cada cosa

```
apps/nocturna/             la ingesta nocturna: base SQLite, noche, estado y órdenes
apps/moderacion/           la herramienta de moderación del buzón y su cliente de Convex con la clave de administración
packages/ingesta/          el extractor del registro oficial (registro-oficial/), el cliente de las fuentes y la cola de fichas
packages/ingesta/src/barrido.ts   el barrido por zonas y la noche sobre una BaseDeBarrido
packages/ingesta/src/guardado.ts  qué cambia en una observación con el listado, la ficha o un barrido
packages/publicacion/      la publicación, el almacén en carpeta o en R2 y la retención
packages/publicacion/datos/  los límites de barrio y de municipios y el padrón del INE, en git
packages/publicacion/datos/barrios.json   los límites de barrio que usa la publicación
packages/dominio/          esquemas y la fusión, sin E/S
tools/capas/               los límites de barrio y de municipios, la España sintética y el origen estático local
convex/confect/            tablas (tables/), API (*.spec.ts y *.impl.ts) y crons de Confect: el buzón
convex/src/                la clave, la huella de la IP, el token de identidad y los límites del buzón
convex/convex/             generado por Confect y Convex; no se edita
```

## Ingesta nocturna

`apps/nocturna` es la ingesta y la publicación fuera de Convex (ADR 0015). Es un programa de Node 24 que hace la noche entera y se para: el registro oficial de las zonas de barrido de la noche (una de las siete de España cada noche, por defecto), la publicación, el build de Vercel si aún no sirve la versión vigente y una copia de la base, en el disco y en R2. El paquete de Nix y el módulo de NixOS que la lanzan cada noche están en [nixos.md](nixos.md).

### Lanzarla en local

Desde la raíz de Celda, dentro de `nix develop`:

```sh
pnpm run ingesta noche      # ingesta, publicación, build de Vercel y copia de seguridad
pnpm run ingesta estado     # última ejecución de cada fuente, fichas en cola, errores y lo publicado
pnpm run ingesta publicar   # publica lo que haya en la base, sin pedir nada a las fuentes
pnpm run ingesta copia      # copia la base a la carpeta de copias y, con R2, también allí
pnpm run ingesta cuadros-de-borde borde.json   # pide una vez los cuadros de borde, con peticiones reales
```

Cada orden construye `apps/nocturna/dist/nocturna.js`, un solo fichero, y lo ejecuta en `apps/nocturna`. Las rutas relativas de la configuración cuentan desde ahí: sin tocar nada, la base es `apps/nocturna/datos/ingesta.sqlite` y las copias van a `apps/nocturna/datos/copias/`, las dos fuera de git.

`noche` hace peticiones reales y, con los valores por defecto, dura seis horas de fichas. Para probar contra el geoportal sin leer fichas, que son la mayor parte de las peticiones:

```sh
CELDA_INGESTA_MAX_FICHAS=0 \
CELDA_ALMACEN_CARPETA=$PWD/tools/capas/salida \
pnpm run ingesta noche
```

Con los valores por defecto, la primera noche en una base nueva barre Cataluña: 38 peticiones, `robots.txt` y 37 de listado, y unos 2 min 30 s. La del 29/09/2026 trajo 10.305 registros de los 9 cuadros y publicó 5.049 emplazamientos en 40 lotes (investigación 08, «Primera pasada real de Cataluña»). La noche siguiente barre la zona `centro` (la pasada real del 29/09, con los diez cuadros que tenía entonces, fueron 40 peticiones y 12.528 registros), y así hasta las siete. Cuando una zona vuelve a tocar, se piden solo sus cajas guardadas: 30 en Cataluña y 24 en `centro`. Con `pnpm run servir` en `tools/capas`, la web en desarrollo lee esa carpeta.

### Configuración

Todo va en variables de entorno, con los valores de hoy por defecto (`apps/nocturna/src/configuracion.ts`):

| Variable | Por defecto | Qué es |
|---|---|---|
| `CELDA_INGESTA_BASE` | `datos/ingesta.sqlite` | La base SQLite |
| `CELDA_INGESTA_COPIAS` | `datos/copias` | Carpeta de las copias de seguridad |
| `CELDA_INGESTA_COPIAS_CONSERVADAS` | 14 | Copias que se conservan |
| `CELDA_INGESTA_MAX_FICHAS` | sin tope | Tope de fichas por noche; con 0 no se lee ninguna |
| `CELDA_PUBLICAR_REINTENTO_MINUTOS` | 60 | Espera antes de repetir una publicación fallida |
| `CELDA_REGISTRO_ACTIVO` | `true` | Interruptor del registro oficial |
| `CELDA_REGISTRO_MOTIVO` | | Lo que se apunta si está apagado |
| `CELDA_REGISTRO_ZONAS` | `ninguna` | Zonas de barrido de cada noche, separadas por comas, o `ninguna` |
| `CELDA_REGISTRO_ZONAS_EN_TURNO` | las siete, de `cataluna` a `oeste-y-canarias` | Zonas que se turnan |
| `CELDA_REGISTRO_ZONAS_POR_NOCHE` | 1 | Cuántas de las que se turnan se barren cada noche |
| `CELDA_REGISTRO_PAUSA_SEGUNDOS` | 3 | Pausa entre peticiones del listado; nunca baja de 3 |
| `CELDA_REGISTRO_MAX_PETICIONES` | 400 | Tope de peticiones del listado por noche, `robots.txt` y reintentos incluidos. Deja barrer toda España en una noche |
| `CELDA_REGISTRO_FICHAS_RITMO_SEGUNDOS` | 3 | Pausa entre el final de una ficha y la siguiente; nunca baja de 1 |
| `CELDA_REGISTRO_FICHAS_VENTANA_MINUTOS` | 360 | Minutos de fichas, desde que empieza la noche |
| `CELDA_REGISTRO_FICHAS_RELECTURA_DIAS` | 30 | Días tras los que se vuelve a leer una ficha |
| `CELDA_REGISTRO_FICHAS_PRIORIDAD` | `08,17,25,43` | Provincias cuyas fichas van primero, por código INE y separadas por comas, o `ninguna` |
| `CELDA_REGISTRO_REINTENTOS` | 3 | Reintentos de un fallo pasajero |
| `CELDA_REGISTRO_ESPERA_SEGUNDOS` | 10 | Tiempo máximo de una respuesta |
| `CELDA_REGISTRO_USER_AGENT` | `Celda (ingesta; contacto en celda.elies.site)` | Se envía en cada petición |
| `CELDA_CONVEX_SITE_URL` | | Las acciones HTTP del buzón de Convex, `https://<nombre>.convex.site`, de las que se lee lo aceptado en la moderación |
| `CELDA_PUBLICACION_CLAVE` | | La clave de publicación del buzón. Con las dos, la comunidad tiene el interruptor encendido; sin ellas, apagado. Nunca una clave de despliegue. Ver [Moderar](#moderar) |

Las zonas son `cataluna`, `centro` (Madrid y Castilla-La Mancha), `andalucia` (con Ceuta y Melilla), `levante` (Comunitat Valenciana, Murcia e Illes Balears), `norte` (Galicia, Asturias, Cantabria y País Vasco), `ebro-y-duero` (Castilla y León, Aragón, Navarra y La Rioja) y `oeste-y-canarias` (Extremadura y Canarias), con sus cuadros en `ZONAS_DE_BARRIDO` (`packages/dominio/src/barrido.ts`). Un nombre que no está ahí para el programa al arrancar. De las que se turnan va primero la que quedó a medias, luego las que nunca se han completado, en el orden de la configuración, y luego las que llevan más tiempo sin completarse.

Por defecto se turnan las siete, una por noche: toda España en siete noches, unas 31 peticiones de listado cada noche (34 de media la primera semana, que divide los cuadros). Una alta tarda hasta una semana en verse y una baja, dos. Hay otras dos formas, cambiando solo la configuración:

```sh
# Cataluña todas las noches y las otras seis por turnos: unas 61 peticiones, toda España en seis noches.
CELDA_REGISTRO_ZONAS=cataluna pnpm run ingesta noche

# Toda España cada noche: unas 215 peticiones y 15 minutos (250 la primera vez).
CELDA_REGISTRO_ZONAS_POR_NOCHE=7 pnpm run ingesta noche
```

Por qué siete noches y no todas cada noche: el listado entero son 43 MB por noche, casi tanto como las 5.500 fichas (unos 50 MB), para un registro que cambia poco de un día para otro, y las bandas de cada ficha ya se releen solo cada 30 días. Las cifras están en la investigación 08, «Toda España en la ingesta nocturna».

`robots.txt` se respeta siempre. El grupo que se aplica es el del primer producto del `User-Agent`, así que cambiarlo cambia también con qué nombre se busca a Celda en él. El almacén se elige con `CELDA_ALMACEN_CARPETA` o con las cuatro de R2 (`CELDA_R2_CUENTA`, `CELDA_R2_CUBO`, `CELDA_R2_ID_CLAVE` y `CELDA_R2_SECRETO`), y `CELDA_ALMACEN_ORIGEN` (`almacenDesdeConfig` en `packages/publicacion`). Sin almacén, la noche ingiere y apunta `sin-almacen`.

Las variables también pueden llegar como credenciales de systemd: el programa lee cada fichero de `$CREDENTIALS_DIRECTORY` en formato `.env`, detrás de las variables de entorno (`apps/nocturna/src/credenciales.ts`). Así pasa el módulo de NixOS los secretos de R2 sin ponerlos en el entorno.

### La base

La base se abre con el módulo `node:sqlite` de Node 24 a través de `@effect/sql-sqlite-node`, que en Effect 4 usa ese módulo y no trae extensiones nativas. Tablas (`apps/nocturna/src/base.ts`):

- `observaciones`: lo último que dice cada fuente de cada estación base, con las bandas y las medidas de exposición del ministerio de su ficha, cuándo se leyó su ficha y con qué versión de la lectura, si está retirada, su cuadro, cuándo la trajo un listado por última vez y, si su ficha falló, cuántas veces seguidas, hasta cuándo espera y el último error;
- `cuadros`: las cajas en que se dividió cada cuadro la última vez;
- `barridos` y `cuadros_barridos`: cada barrido de una zona, con sus cuadros, y los cuadros que ya ha guardado;
- `emplazamientos`: los de la última fusión, con la fecha en que cambió cada uno;
- `ejecuciones`: cada pasada de un extractor, con sus cambios, sus errores, lo que hizo cada zona (cuadros, peticiones, bytes, registros y cambios) y cómo acabó la publicación de su noche;
- `publicaciones`: cada intento de publicar;
- `versiones` y `ficheros_publicados`: lo publicado, con el SHA-256 de cada fichero;
- `aportaciones_aceptadas`: lo aceptado en la moderación que la noche ha leído del buzón, con su emplazamiento, el seudónimo de quien lo envió, cuándo se aceptó y la fecha de la ejecución que lo trajo (versión 6 del esquema, #57). Ni la identidad ni la huella de la IP salen del buzón.

El esquema lleva su versión en `PRAGMA user_version`, y una base vieja se pone al día al abrirla. La versión 5 borra la tabla `puntos` de la web de antenas que retiró el ADR 0019, y las observaciones, los barridos y las ejecuciones de las fuentes que ya no están en `Fuente`. La versión 7 añade a `observaciones` la versión de la lectura de cada ficha (`ficha_leida_con`, #73), y las leídas antes se quedan con la 1 ([Cuando cambia la lectura de la ficha](#cuando-cambia-la-lectura-de-la-ficha)). Cada paso de la noche escribe en su propia transacción. Si la noche se corta, su ejecución queda en curso; la siguiente la da por interrumpida y rehace el trabajo, y acaba igual que si no se hubiera cortado.

### El barrido por zonas

Cada zona de barrido tiene sus cuadros de 1° (ADR 0014). En cada cuadro la noche pide las cajas guardadas de la vez anterior, o el cuadro entero la primera vez. Una caja que llega a los 1000 registros no se guarda ni se usa: se piden sus cuatro cuartos, hasta ocho divisiones (cajas de unos 400 m). Si aún llega al tope, el cuadro falla, porque le faltarían registros sin que nadie lo supiera.

Cada cuadro se guarda en una transacción, con sus registros, sus cajas y la marca de hecho. Si la noche se corta a mitad de una zona, el barrido queda a medias y la noche siguiente sigue por el primer cuadro sin guardar. Cuando todas las zonas de la noche han acabado, se cierran sus barridos. Cerrar cuenta una ausencia a las observaciones vigentes de sus cuadros que ningún listado ha traído desde que empezó el barrido. Por eso una estación que se mueve a un cuadro de otra zona no se retira: el listado de la otra zona la trae, y su cuadro pasa a ser el nuevo.

Un barrido falla, y no cuenta ausencias, si un cuadro falla o si vuelve vacío cuando la base tiene estaciones en él. Las demás zonas siguen. El tope de peticiones, `robots.txt`, una fuente que no responde ni tras los reintentos, una que pide esperar o una que bloquea a Celda paran las zonas que quedan y las fichas. La ejecución queda completada si alguna zona se ha barrido.

### Los cuadros de las zonas

Los cuadros de `ZONAS_DE_BARRIDO` salen del listado propio del registro oficial de toda España (ADR 0019), no de otra web. `packages/dominio/datos/cuadros-del-registro.json` guarda, por cuadro, sus registros, sus registros por provincia, las provincias que toca y su zona con la regla del ADR 0014 (`zonaDelCuadro`): la comunidad con más registros, salvo si toca Cataluña. Una prueba de `@celda/dominio` comprueba que `ZONAS_DE_BARRIDO` lleva esos cuadros en esas zonas, y la España sintética de las pruebas reparte sus registros con esas cifras.

El fichero lo escribe `pnpm run cuadros <ingesta.sqlite> [pasada-de-borde.json]`, desde `apps/nocturna`, con una base de la ingesta nocturna que tenga barridas las siete zonas; la abre solo para leer y falla si le falta alguna. Dice los registros de cada zona, los cuadros nuevos y los que cambian de zona, y `ZONAS_DE_BARRIDO` se pone al día a mano con eso.

Un cuadro que no está en ninguna zona nunca se pide, así que un registro que caiga en él no aparece en la base. `celda-nocturna cuadros-de-borde <fichero>` pide una vez, con el extractor del registro y su configuración, cada cuadro que toca alguna provincia y no está en ninguna zona, y escribe lo que trae cada uno. No abre la base ni el almacén. Con los límites del IGN de hoy son cuatro cuadros: `robots.txt` y cuatro peticiones. Cómo se lanza en la máquina de la ingesta está en [nixos.md](nixos.md#los-cuadros-de-borde), y lo que dio, en la investigación 08, apartado 7.

### Las fichas

Las fichas del registro dan las bandas y las medidas de exposición del ministerio. Tras el barrido, la noche las lee una a una hasta que se acaba la cola o se cierra su ventana (ADR 0014, ticket 41). Con los valores por defecto son una cada 3 s durante las 6 primeras horas de la noche. El geoportal tarda casi un segundo en contestar cada una, así que salen unas 5.500. La última empieza antes del cierre; las que no caben esperan a la noche siguiente.

La cola no es una tabla aparte. Sale de `observaciones` cada noche con `ordenarFichas` (`packages/ingesta/src/fichas.ts`), una función pura:

1. las de las provincias de `CELDA_REGISTRO_FICHAS_PRIORIDAD`, en su orden: por defecto Barcelona (08), Girona (17), Lleida (25) y Tarragona (43). La provincia sale de los límites del IGN, como en la publicación;
2. las de cada zona de barrido, en el orden de `CELDA_REGISTRO_ZONAS` y `CELDA_REGISTRO_ZONAS_EN_TURNO`;
3. las de fuera de esas zonas.

Dentro de cada grupo van primero las nuevas y las de listado cambiado, en el orden en que llegaron, y luego las de relectura, de la más vieja a la más nueva: las leídas hace más de 30 días y las leídas con una versión anterior de la lectura. Cada ficha se guarda en cuanto llega. Una noche cortada no pierde nada, y la siguiente sigue por la misma cola.

De cada ficha se guardan sus bandas y sus medidas de exposición del ministerio, que sustituyen a las de la lectura anterior. La fecha de la observación cambia si cambia alguna de las dos, así que es desde cuándo dice el registro lo que se guarda; el ministerio no fecha las medidas. Las primeras medidas que Celda lee de una ficha se publican sin mover la fecha, porque el registro ya las tenía antes. Una observación leída antes del #73 no tiene la clave `medidasDeExposicion`, que no es lo mismo que una lista vacía: con la clave, el registro no publica ninguna. Qué son y qué no significan, en la investigación del registro oficial (apartado 6, «Medidas de exposición del ministerio»).

Las fichas usan su propio cliente sobre la misma conexión que el listado: su pausa es el ritmo, y su tope, las peticiones que caben en la ventana a ese ritmo: 7.200 a 3 s y 21.600 a 1 s. Comparten `robots.txt` y la hora de la última respuesta, así que la primera ficha también espera su pausa desde la última caja. Cuando algo falla:

- una ficha que no se puede leer apunta el fallo y espera un día antes de volver a la cola; dos días si falla otra vez, luego cuatro, y así hasta 30;
- una ficha con el aviso «Código de emplazamiento no válido» espera igual, y además deja la estación base sin ficha en el registro, con la fecha de la noche (`SinFichaEnElRegistro`). La ficha publicada lo dice. La siguiente lectura buena quita la marca;
- un fallo pasajero (red, 408, 5xx) se reintenta tres veces con espera exponencial. Si sigue, cuenta como fallo pero no hace esperar a la ficha;
- un 429, o un 503 con `Retry-After`, es la fuente pidiendo que se espere. Si `Retry-After` pide un minuto o menos, la conexión espera lo que pide y repite, dentro de los mismos tres reintentos. Si pide más, si un 429 no dice cuánto o si lo sigue pidiendo tras los reintentos, se deja de pedir en el acto (`FuentePideEsperar`). Vale también para el listado: se deja de pedir el de las zonas que quedan;
- tres fallos seguidos paran las fichas de la noche. Una ficha sin ficha en el registro no cuenta ni corta la cuenta, porque es lo que dice el registro y no un fallo; pero 20 seguidas (`SIN_FICHA_SEGUIDAS`) también las paran, y el diario dice que puede haber cambiado la URL de la ficha. Entonces ninguna de esas 20 queda marcada: esperan y se reintentan como cualquier fallo;
- un 401 o un 403, una página que no es una ficha del geoportal (todas llevan la tabla `tablaDetalleEstacion`) o un listado en HTML son la fuente bloqueando a Celda (`FuenteBloqueada`). Se deja de pedir en el acto, sin reintentos.

Lo que para las fichas queda en los errores de la ejecución («Fichas paradas hasta la próxima noche: …»), y cada ficha que falla, con su clave y su motivo. El diario tiene una línea de aviso por ficha que falla, con su clave, su URL, el motivo, el intento y desde cuándo se vuelve a pedir, o que no espera si el fallo era pasajero:

```
Ficha fallida, intento 1: VODAFONE ESPAÑA, S.A.U. - 061723 (https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?…): SinFichaEnElRegistro: La ficha dice «Código de emplazamiento no válido»; se vuelve a pedir desde 2026-10-04 01:02:03 UTC
```

Al final dice cuántas se leyeron, cuántas fallaron y cuáles, con su motivo, cuántas quedan y por qué pararon. La orden `estado` dice cuántas quedan en cada parte de la cola: sin leer, por releer y esperando tras fallar. De las que esperan tras un fallo enseña las diez primeras en volver a pedirse, con su motivo y su próximo intento, así que no hace falta abrir la base para leer `ficha_error`. También las da por zona de barrido, junto a la fecha de su último barrido completo, contando las de sus provincias con prioridad, y dice qué zonas barre la noche siguiente.

#### Cuando cambia la lectura de la ficha

Cada ficha leída guarda con qué versión de la lectura se leyó (`ficha_leida_con`), y `VERSION_DE_LECTURA`, junto a `leerFicha` en `packages/ingesta/src/registro-oficial/normalizar.ts`, dice cuál es la de hoy. Una ficha leída con una versión anterior entra en la cola como si tocara releerla, aunque no hayan pasado los 30 días, con su fecha de lectura de siempre. Así, cuando la lectura saca algo nuevo de la ficha, lo nuevo llega a todas en unas noches y no en un mes. Para eso se sube `VERSION_DE_LECTURA` y se dice en su comentario qué trae la versión nueva. La 1 son las bandas, y la 2, las medidas de exposición del ministerio (#73).

Las releídas por versión van en la misma cola, por provincias con prioridad y por zonas, detrás de las nuevas, y al ritmo y en la ventana de siempre. La orden `estado` las cuenta entre las de relectura. Con los valores de la máquina de producción (una cada 3 s, unos 0,9 s de respuesta y 480 minutos de ventana) caben unas 7.400 fichas por noche, así que las unas 69.600 fichas de toda España se releen en unas diez noches, Cataluña en las dos primeras. Después de esa pasada, las relecturas de los 30 días se juntan en las mismas diez noches, que también caben.

Al pasar la mitad de la ventana con alguna ficha leída, la noche fusiona y publica, sin esperar ni repetir si falla. Si la noche se corta después, lo leído hasta entonces ya está publicado. La primera fusión lleva la fecha de inicio de la ejecución, como todos sus datos; la del cierre lleva la hora a la que se hace, para que la versión de los datos avance. Así una noche con fichas publica dos versiones, y las ocho que se conservan cubren unas cuatro noches.

`node:sqlite` es síncrono. Si una conexión espera el cerrojo de otra del mismo proceso, bloquea el bucle de eventos y la otra no puede soltarlo. Por eso abrir una base al día no toma el cerrojo de escritura, y `estado` se puede lanzar en mitad de una noche desde otro proceso.

### Publicar y copias

Al final de la noche se publica siempre, además de a mitad de la ventana de fichas: sin cambios no se escribe nada, y si la noche anterior no pudo publicar, esta lo hace. Si falla porque el almacén o la base no responden, o porque los datos se movieron a mitad, se apunta en `publicaciones` y en las ejecuciones de la noche, se espera una hora y se intenta otra vez. Si vuelve a fallar, queda para la noche siguiente. Los datos ya están en la base.

Después, `VACUUM INTO` copia la base a `ingesta-<fecha>.sqlite` en la carpeta de copias, y se borran las más viejas hasta dejar catorce. Con un cubo de R2 configurado, la copia se sube también, comprimida con gzip, a `copias/ingesta-<fecha>.sqlite.gz` del mismo cubo, y allí se borran las más viejas hasta dejar otras tantas (`subirCopia`, ADR 0018). Si la subida falla, lo dice el diario y la noche sigue. Para restaurar, para la ingesta y copia una de ellas encima de la base (una de R2, descomprimida con `gzip --decompress`):

```sh
cp datos/copias/ingesta-2026-09-28T21-40-45.318Z.sqlite datos/ingesta.sqlite
rm -f datos/ingesta.sqlite-wal datos/ingesta.sqlite-shm
```

### Toda España: memoria y tiempo

Medido el 03/10/2026 en un portátil con Node 24, con la España sintética de `apps/nocturna/src/pruebas/espana.ts` (69.612 registros, 42.089 emplazamientos) y el programa de la noche de verdad, salvo el geoportal, que contesta al momento. Los tiempos no cuentan las pausas entre peticiones. La medida del 29/09/2026, con los 69.770 registros previstos de la investigación 08, dio 630, 750 y 761 MB con el límite, y sin él, de 1,3 a 2 GB.

| Noche | Sin las pausas | RSS máximo, con el montón de V8 a 512 MB |
|---|---|---|
| Toda España, primera pasada, sin fichas | 19 s | 628 MB |
| Las 69.612 fichas en una noche, y publicar todos los lotes con bandas | 114 s | 734 MB |
| Por defecto: una zona y 5.500 fichas que cambian | 26 s | 748 MB |

Sin límite, V8 deja crecer el montón con la basura de la publicación antes de recogerla, y el RSS pasa de 1,1 a 2 GB según la noche y cuándo recoja. Lo que sigue vivo es mucho menos: las tres noches caben con el montón limitado a 512 MB, y la noche por defecto no cabe en 384. De ese montón, 47 MB son la España sintética de la medida, y 77 MB los límites de municipios que carga cualquier orden. La fusión y la publicación leen las observaciones y los emplazamientos de 2.000 en 2.000 (`PAGINA` en `apps/nocturna/src/base.ts`); leyéndolos de una vez, la noche de las fichas no cabía en 512 MB.

Por eso el módulo de NixOS limita el montón a 512 MB (`memoria.monton`) y el servicio a 1.536 MB (`memoria.maxima`, [nixos.md](nixos.md#opciones)). En local, `NODE_OPTIONS=--max-old-space-size=512 pnpm run ingesta noche` hace lo mismo.

La noche por defecto son unos 2 minutos de listado, las 6 horas de fichas y dos publicaciones de unos 10 s. La base con las bandas de toda España ocupa unos 190 MB, y sus catorce copias, unos 2,6 GB.

Para repetir la medida, las tres fases en orden sobre la misma carpeta, cada una en su proceso:

```sh
cd apps/nocturna
pnpm run medir-espana /tmp/espana primera   # toda España en una noche, sin fichas
pnpm run medir-espana /tmp/espana fichas    # todas las fichas
pnpm run medir-espana /tmp/espana turno     # una noche por defecto
```

Para ver lo que cabe, `node --max-old-space-size=512 src/medida/espana.ts /tmp/espana turno`.

### Pruebas

`apps/nocturna/src/programa.test.ts` lanza noches enteras con una base en una carpeta temporal, el almacén en carpeta y el registro oficial grabado de Campus Nord, que contesta cada caja como el geoportal (`capaGrabadaPorCajas`). Comprueba que una noche publica la capa y sus fichas, que repetirla sin cambios no escribe nada, que una noche cortada se retoma y deja la misma base y el mismo almacén, que una baja pide dos barridos, que las copias se abren y se restauran y solo quedan catorce, también las comprimidas en un R2 de prueba, que una subida fallida no tumba la noche, que una publicación fallida se repite a la hora o la noche siguiente, y el interruptor, el estado y la configuración. Las esperas de la publicación se prueban con el `TestClock`; la base y el almacén son ficheros de verdad, así que esas pruebas esperan también con el reloj real (`TestClock.withLive`) a que la noche llegue a publicar.

`apps/nocturna/src/barrido.test.ts` prueba el barrido por zonas con dos zonas de un cuadro: que una pasada sin cambios pide solo las cajas guardadas, que una zona que falla no cuenta ausencias en ninguna, que retirar pide dos barridos de la misma zona también por turnos, que una estación que cambia de zona no se retira, que un cuadro vacío con estaciones es un fallo, que un barrido cortado se retoma sin repetir cuadros y deja la misma base, el tope tras ocho divisiones y una base de la versión 1 del esquema. `packages/ingesta/src/fichas.test.ts` prueba el orden de la cola y la lectura en la ventana con el extractor real, fichas grabadas y el reloj de prueba: el ritmo, el cierre de la ventana con el resto pendiente, la publicación a mitad, unas 5.500 fichas con los valores por defecto y respuestas de 0,9 s, una ficha cada segundo desde el final de la anterior y, a ese ritmo, el bloqueo por 401, 403 o una página que no es una ficha, el 429 y el 503 con `Retry-After`, los tres fallos seguidos, la espera tras un fallo y el tope. `apps/nocturna/src/fichas.test.ts` hace lo mismo con la base SQLite: una noche que cierra la ventana y la siguiente que sigue por donde iba, la provincia con prioridad, un bloqueo que queda en la ejecución, una ficha que espera un día tras fallar, unas fichas leídas con una versión anterior de la lectura que se releen al día siguiente, guardan sus medidas de exposición y las publican, y una base de la versión 3 del esquema que se pone al día sin perder su cola, y sin la tabla `puntos` ni nada de las fuentes retiradas. `packages/ingesta/src/barrido.test.ts` recorre con el extractor real los listados grabados de Barcelona y del centro de Madrid, servidos como el geoportal, con el tope de 1000: no pierde ningún registro y hace las mismas peticiones que la división en cuatro simulada en la prueba, la de la investigación 08.

`apps/nocturna/src/comunidad.test.ts` prueba lo aceptado con un buzón de prueba: que una corrección aceptada aparece en la ficha la noche siguiente, con el registro igual al lado, y una rechazada nunca; que leer dos veces lo mismo no duplica nada y una corroboración suma una persona; y que la noche sin Convex publica igual, queda fallida en la ejecución de la comunidad, lo dice el diario y la siguiente recoge lo que faltaba. Lee lo publicado con el mismo lector que la herramienta de moderación. `apps/nocturna/src/buzon.test.ts` prueba su cliente HTTP: la clave como `Bearer`, el cursor, un 401, una respuesta que no se entiende y los reintentos.

`apps/nocturna/src/espana.test.ts` prueba toda España con la España sintética, que copia emplazamientos de los listados grabados de Barcelona y Valencia y los reparte por los municipios del padrón con los registros de cada cuadro en el listado propio del registro (`cuadros-del-registro.json`). Comprueba que por defecto se barre una zona cada noche, en su orden; que una provincia queda cubierta en el resumen cuando se han barrido todos sus cuadros, y antes no; que toda España cabe en una noche con `CELDA_REGISTRO_ZONAS_POR_NOCHE=7` y dentro del tope de peticiones; el orden de las fichas, y lo que dice `estado` de cada zona. Con los listados grabados de Barcelona y del centro de Madrid, la primera noche barre Cataluña, la segunda `centro`, y publican los 1.294 y 1.331 emplazamientos de la revisión de la fusión. Tarda unos 30 s.

`apps/nocturna/src/publicacion.test.ts` publica a mano lo que una noche ha dejado en la base, con límites de prueba que parten la muestra del Campus Nord entre dos provincias. Comprueba lo que escribe la publicación y en qué orden, el índice de claves, el manifiesto, la tabla de municipios y que cada emplazamiento tiene su ficha en su lote, igual que la da la base y con su lugar; que sin cambios no escribe nada y que una provincia sin cambios reutiliza su capa y sus lotes; que no pisa un fichero con otro contenido, no retrocede ante una vigente posterior y vuelve a publicar una vigente del formato 4; el contenido de la ficha, y la retención.

## Publicación

La web no lee nada de Convex: descarga `vigente.json`, el resumen nacional, la capa de cada provincia que ve y sus lotes de fichas de un almacén de ficheros estático (ADR 0004, 0008, 0010 y 0016). Los escribe `publicar` (`packages/publicacion/src/publicar.ts`), que lee la instantánea de un servicio `DatosPublicables`: la base SQLite de la ingesta nocturna, o la España sintética de `tools/capas`. Así:

1. Lee la versión de los datos y la cobertura: las zonas de barrido con la fecha de su último barrido completo. Si `vigente.json` del almacén ya apunta a esa versión, rehace su resumen con la cobertura de ahora sin leer la instantánea: si sale el mismo fichero, no escribe nada (`al-dia`); si no, por ejemplo porque hay un barrido nuevo sin cambios en los datos, escribe el resumen nuevo y `vigente.json` (`barrido`). Si `vigente.json` apunta a una versión posterior, falla (`VigentePosterior`): no retrocede.
2. Lee la instantánea (la base la lee por páginas de 2.000 emplazamientos) con sus compañías y las bandas conocidas de cada una, y vuelve a leer la versión. Si ha cambiado entre medias, falla sin escribir nada (`InstantaneaMovida`) y basta con repetir.
3. Sitúa cada emplazamiento en su municipio y su provincia con `packages/publicacion/datos/municipios.json` (`situarEmplazamientos`). Uno sin provincia, en el mar lejos de la costa o en un territorio sin provincia, va a la capa de la provincia de etiqueta más cercana, pero su ficha no dice ninguna.
4. En cada provincia, reparte sus emplazamientos en lotes de 128 por la curva de Hilbert, lee las fichas de cada lote, les pone su lugar y escribe `fichas/<provincia>/<huella>.json`, cuatro lotes a la vez. La huella es la de su contenido (SHA-256, 16 cifras). Si falta alguna ficha, los datos han cambiado.
5. Escribe la capa de cada provincia, `provincias/<provincia>/<huella>.json`: las columnas de siempre, el municipio de cada emplazamiento con la tabla de municipios de la provincia (habitantes, área, número de emplazamientos y compañías) y, en Barcelona, sus barrios. Un fichero que ya está en el almacén no se vuelve a escribir: una provincia sin cambios reutiliza su capa y sus lotes.
6. Vuelve a comprobar la versión, escribe el manifiesto `ficheros@<fecha>.json` con las capas y los lotes de la versión, el resumen `resumen@<fecha>.<huella>.json` y lo registra en la base (tablas `versiones` y `ficheros_publicados`).
7. Escribe `vigente.json`, el último, con el nombre del resumen.
8. Borra las versiones que sobran: se quedan la vigente y las 7 anteriores (`VERSIONES_ANTERIORES`). Lo hace también cuando no había nada que publicar, así que un borrado fallido se repite la noche siguiente sin más.

Ningún fichero se pisa con otro contenido: si existe distinto, falla con `FicheroInmutable` y `vigente.json` no cambia. La fecha es la de la versión de los datos, al segundo.

El resumen dice, de cada provincia, si está cubierta: si se han barrido todos los cuadros con datos que la tocan (`coberturaDeProvincia`, con los 94 cuadros de `ZONAS_DE_BARRIDO`), y la fecha del último barrido de lo que se sabe de ella. La nocturna da las zonas que ha empezado a barrer (tabla `barridos`).

El paso 8 (`retirarVersionesViejas`) lista el almacén entero y mira el sello de lo que es de una sola versión (`resumen@<fecha>…`, `ficheros@<fecha>.json` y, del formato 4, `sitios@<fecha>.json` y `fichas@<fecha>/<lote>.json`). Nunca borra la vigente ni una versión posterior, que puede ser otra publicación a medias. De cada versión retirada va primero lo que la abre (su resumen), después las capas y los lotes de su manifiesto que no lista ninguna versión que se queda, y al final el manifiesto. Si el manifiesto de una versión que se queda no se entiende, no borra nada compartido. Un fallo al borrar no hace fallar la publicación: sale como aviso en el registro. Por qué siete, en el ADR 0010.

Publica la noche, a mitad de la ventana de fichas y al final, y `pnpm run ingesta publicar` a mano ([Publicar y copias](#publicar-y-copias)). Dónde escribe lo dice su configuración: `CELDA_ALMACEN_CARPETA` o el cubo de R2. Sin almacén, `publicar` devuelve `sin-almacen` y no escribe nada.

Para la web en desarrollo, publica en `tools/capas/salida` y sírvela desde `tools/capas`:

```sh
CELDA_ALMACEN_CARPETA=$PWD/tools/capas/salida pnpm run ingesta publicar   # lo que haya en la base
pnpm --filter @celda/capas run sintetica   # o una España sintética, sin base ni red
pnpm --filter @celda/capas run servir      # sirve salida/ en http://127.0.0.1:8852, déjalo abierto
```

`servir` da a `vigente.json` una caché de cero segundos y al resto un año, como Vercel. La web en desarrollo lee de `VITE_CAPAS_ORIGEN`, que `apps/web/.env.development` pone en ese puerto; en la build, sin la variable, lee de `/capas` en su mismo origen, como en producción (ADR 0018). `CELDA_CAPAS_CARPETA` y `CELDA_CAPAS_ORIGEN` cambian la carpeta y el puerto de `servir` y de `sintetica`.

Los límites de barrio se descargan de Open Data BCN con `pnpm run barrios`, también desde `tools/capas`. Son dos peticiones con 10 s entre ellas; hazlo solo cuando el Ayuntamiento publique límites nuevos y revisa el diff de `packages/publicacion/datos/barrios.json` antes del commit. `CELDA_BARRIOS` cambia la ruta del fichero. Por qué se guardan en git y no van en la ingesta: ADR 0004.

Los municipios, las provincias y el padrón se descargan con `pnpm run municipios`, desde `tools/capas`. Lánzala cuando el IGN cambie la fecha de su canal o cuando el INE publique el padrón del año, hacia diciembre. Pide el `robots.txt` de cada sitio, espera 5 s entre dos peticiones al mismo y hace siete como mucho. El ZIP del IGN (66 MB) se queda en `~/.cache/celda` (o en `CELDA_CACHE`) con la fecha del canal en el nombre, así que repetir la orden sin cambios en el IGN solo pide cinco cosas pequeñas. `CELDA_MUNICIPIOS` y `CELDA_PADRON` cambian las rutas de los dos ficheros. Si la licencia deja de ser CC BY 4.0, si falta una fecha o si un municipio no está a los dos lados, falla sin escribir nada. Con el mismo ZIP y el mismo CSV salen los mismos bytes: revisa el diff antes del commit. `tools/capas/src/municipiosReales.test.ts` comprueba los ficheros del repositorio con puntos conocidos (Ceuta, Melilla, Llívia, Treviño, El Hierro, Bardenas Reales, el mar de la Barceloneta) y que la orden los volvería a escribir igual. Por qué se guardan en git: ADR 0017.

Después de `municipios`, lanza `pnpm run capitales`, también desde `tools/capas`. Pide al WFS INSPIRE del Nomenclátor Geográfico Básico de España del IGN sus capacidades, para comprobar que sigue en CC BY 4.0, y las capitales de municipio en páginas de 1.000: once peticiones con el `robots.txt`, con 5 s entre una y otra. Asigna cada capital al municipio de `municipios.json` en que cae, o al de su nombre si cae en un vecino de la misma provincia, y escribe `packages/publicacion/datos/capitales.json` (o `CELDA_CAPITALES`). Si un municipio se queda sin capital o con dos, falla sin escribir nada y dice cuáles. Con ellas la publicación pone cada municipio en su punto (ADR 0017), y `pnpm run centros` las usa para la tabla de ciudades, así que lánzala después. `tools/capas/src/capitalesReales.test.ts` comprueba que hay una por municipio.

Después de `municipios`, lanza también `pnpm run zonas` desde `tools/capas`. No pide nada a la red: escribe desde `municipios.json` el índice de municipios y el contorno de cada provincia a 200 m que la web descarga al abrir el ejercicio de emplazamientos, en `apps/web/src/ejercicio/zonas` (o en `CELDA_ZONAS`). `tools/capas/src/zonasReales.test.ts` falla si esos ficheros no son los que escribiría la orden.

La versión de los datos es la fecha de la última ejecución que cambió los emplazamientos. Un emplazamiento retirado se borra y no deja versión, así que la base también mira la última ejecución completada con retiradas. Sin eso, una noche que solo retirase emplazamientos daría el mismo nombre de capa con otro contenido.

### Las capas en Vercel

La web, las capas y las fichas se sirven solo desde Vercel, en el mismo origen (ADR 0018). El almacén de producción es un cubo privado de R2: la noche publica ahí, y el build de Vercel (`apps/web/scripts/vercel.sh`) monta las capas en `dist/capas` con la orden `capas`, que no abre la base:

```sh
pnpm --filter @celda/nocturna run capas <carpeta vacía>
```

Lee del almacén de la configuración, el cubo de R2 por la API S3 (en Vercel, con una clave de solo lectura) o `CELDA_ALMACEN_CARPETA`. Monta la versión vigente y los ficheros de las dos anteriores, según sus manifiestos (`ANTERIORES_EN_VERCEL` en `packages/publicacion/src/vercel.ts`), para que una pestaña abierta con un `vigente.json` viejo siga encontrando sus provincias y sus lotes. Comprueba la huella de cada fichero nombrado por su contenido, reintenta tres veces un fallo del almacén y escribe `vigente.json` el último; si falta algo, falla sin escribirlo, y Vercel sigue sirviendo el despliegue anterior. Una versión posterior a la vigente, que puede ser otra publicación a medias, no se monta.

Tras publicar, la noche y `pnpm run ingesta publicar` comparan el `vigente.json` del almacén con el que sirve Vercel en `CELDA_ALMACEN_ORIGEN` (`https://celda.elies.site/capas`) y, si no coinciden o Vercel no contesta, llaman al deploy hook (`CELDA_VERCEL_DEPLOY_HOOK`). Sin el hook no lanzan ningún build. El diario lo dice en los dos casos.

Las pruebas están en `apps/nocturna/src/vercel.test.ts`, con un Vercel de mentira que construye cada despliegue con la misma orden: que monta la vigente y las dos anteriores y nada de la cuarta, que una pestaña con cualquiera de los resúmenes que ha servido encuentra sus provincias, sus lotes y su índice de claves, que falta un fichero de la vigente o de una anterior y el build falla sin `vigente.json`, y que `vigente.json` es lo último que escribe. Qué pone quien administra las cuentas de R2 y Vercel: [nixos.md](nixos.md#las-cuentas-de-r2-y-vercel).

### Vista previa

`apps/web/scripts/sitio.sh <carpeta publicada> <destino>` construye la web y monta en `<destino>` el sitio como lo sirve Vercel: la web, las capas de lo publicado en `/capas` (la vigente y las dos anteriores) y las cabeceras de `apps/web/vercel.json`. `tools/rendimiento` sirve una carpeta así con esas cabeceras. Subirla con `npx vercel deploy <destino>` solo cabe con capas pequeñas, como las de Barcelona: una subida por la CLI admite 100 MB, y las fichas de toda España son unos 135 MB. El primer despliegue de un proyecto nuevo de Vercel va a producción aunque no se pida; para una vista previa en un proyecto nuevo, despliega con `--target preview` desde el principio.

## Ficha

La publicación pide a la base la `Ficha` de `packages/dominio/src/ficha.ts` de cada emplazamiento, que sale de `fichaDe` con el emplazamiento y las observaciones de sus estaciones. La ficha lleva la dirección y el municipio tal como los escribe la fuente, cada estación base con sus bandas ordenadas por frecuencia, sus medidas de exposición del ministerio por acimut (`medidasDeExposicion`, sin repetir entre sus observaciones, y sin la clave si ninguna ficha suya se ha leído desde el #73) y, por cada código, la observación de la que sale, con su fuente, su enlace y desde cuándo lo dice. Su `version` es la del emplazamiento, que cambia también cuando cambia una de sus estaciones. Ninguna fuente da nombre ni barrio a los emplazamientos, así que la ficha tampoco los tiene. El municipio y la provincia del IGN (`lugar`) no salen de la base: los pone la publicación, y el lote cita su fuente una vez.

La web la lee con el servicio `FichasPublicadas` (`apps/web/src/ficha/servicio.ts`): busca el lote en la capa del mapa, lo descarga una vez por visita y, si el origen ya no tiene esa versión, lee la vigente. Así la marca de agua solo es posterior al mapa en ese caso (ADR 0004).

## Pruebas

Las de la ingesta y la publicación tienen tres niveles, todos con `@effect/vitest` y sin mocks de módulos.

**Dominio.** La fusión se compara con ficheros de referencia en `packages/dominio/src/referencia/` y `packages/ingesta/src/registro-oficial/referencia/` (`toMatchFileSnapshot`). Si cambias la regla a propósito, regenera con `pnpm exec vp test run -u` en el paquete y revisa el diff de los JSON en el commit.

**Extractor.** `packages/ingesta/src/registro-oficial/extractor.test.ts` monta el extractor real sobre un `HttpClient` de prueba (una `Layer`) que apunta cada petición con la hora del `TestClock`. Así se comprueban el `User-Agent`, `robots.txt`, la pausa entre peticiones, los reintentos con espera exponencial, el tope de peticiones y los bloqueos del geoportal. Las esperas se encadenan tras respuestas asíncronas, y un solo `TestClock.adjust` no las ve todas; `esperarConReloj` (`packages/ingesta/src/pruebas/reloj.ts`) adelanta el reloj de segundo en segundo hasta que la fibra termina.

**La noche y la publicación.** Las de `apps/nocturna`, sobre una base SQLite y un almacén en carpetas temporales, con el registro grabado de la investigación (`muestraCampusNord`) servido por `capaGrabadaPorCajas`: ver [Pruebas](#pruebas) de la ingesta nocturna. Las versiones viejas de las pruebas de retención se escriben a mano en la carpeta, sin publicarlas. `packages/publicacion/src/almacenes/r2.test.ts` prueba la firma con dos casos de la batería de AWS (uno con consulta) y el almacén de R2 contra un cubo S3 de prueba en memoria, que lista de dos en dos claves para obligar a pedir varias páginas.

Todas corren en orden aleatorio. Si una falla, el registro dice la semilla; `pnpm exec vp test run --sequence.seed=<semilla>` repite ese orden. Una carrera no siempre sale con la misma semilla: la de la retención (dos borrados que quitaban a la vez la carpeta de lotes, septiembre de 2026) necesitaba carga, y salió con cuatro bucles de la suite a la vez y `--pool=threads` o `--no-file-parallelism`. Si una prueba falla una vez y luego pasa, búscala así antes de repetirla.

## Convex

Desde el #51 la ingesta y la publicación corren en la nocturna (ADR 0015). En Convex solo está el buzón de las aportaciones compartidas (#56, ADR 0020).

- Las tablas van en `convex/confect/tables/`, una por fichero con esquema Effect, y la API en pares `*.spec.ts`/`*.impl.ts` por grupo (ADR 0003). Los crons, en `convex/confect/crons.ts`.
- `convex/convex/` y `convex/confect/_generated/` son código generado y se guardan en git: las pruebas en memoria los necesitan. `pnpm run typecheck` ejecuta `confect codegen` antes de `tsc`, así que un cambio en una spec sin regenerar sale en los tipos. La excepción es `convex/convex/convex.config.ts`, que se escribe a mano: instala el componente `@convex-dev/rate-limiter`, y Confect lo lee para tipar `confect/_generated/components.ts`.
- `convex/convex/_generated/` lo escribe `convex dev`, no Confect, y `convex codegen` necesita un despliegue. Tras añadir o quitar un grupo de funciones, regenéralo con el backend local de una vez: `CELDA_CONVEX_PUERTO=3290 pnpm run backend --once`.

Codegen se lanza siempre con `convex/scripts/codegen.sh` (`pnpm run codegen`, `typecheck` y `backend` lo usan). Confect importa cada fichero de `confect/` escribiendo antes su bundle al lado, `<fichero>.bundled_<id>.mjs`, y lo borra al acabar. Un codegen matado con SIGKILL justo entonces lo deja, sobre todo el de la impl que más tarde en importarse. El script borra los restos, y `.gitignore`, el lint y el formateador no los miran.

### Backend local

Sin cuenta, con el modo anónimo de Convex, en los puertos 3240 (API) y 3241 (acciones HTTP). Desde `convex/`, dentro de `nix develop`:

```sh
pnpm run backend        # codegen + convex dev; déjalo en otra terminal
CELDA_CONVEX_PUERTO=3250 pnpm run backend   # en 3250 y 3251, si 3240 está ocupado
```

Guarda el estado en `.convex/` y la URL en `.env.local`, los dos fuera de git. Para empezar de cero, para el backend y borra `.convex/local` y `.env.local`. `convex dev` no siempre vuelve a desplegar cuando cambian los paquetes del monorepo. Si el log no dice «Convex functions ready» con la hora nueva, toca un fichero de `convex/convex/` o reinicia el backend.

Para probar el buzón en local hace falta su clave. En el backend local, y nunca en uno de la nube desde aquí:

```sh
pnpm exec convex env set CELDA_BUZON_CLAVE "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
```

La web lo usa si se construye con `VITE_CELDA_CONVEX_URL=http://127.0.0.1:3240` (la URL de `convex/.env.local`).

### El buzón

Lo que decide el ADR 0020 y cómo quedó, en su apartado «Cómo quedó en el #56». Dónde está cada cosa:

| Qué | Dónde |
|---|---|
| Las cuatro mutaciones públicas y sus errores tipados | `confect/buzon.spec.ts` y `buzon.impl.ts` |
| Lo que necesita la moderación (#57) | `confect/moderacion.spec.ts` y `moderacion.impl.ts`, todas internas |
| Los esquemas de la moderación, el veredicto propuesto y cómo lo aceptado llega a la ficha | `packages/dominio/src/moderacion.ts` |
| La herramienta de moderación y su cliente de Convex | `apps/moderacion/src/` |
| La acción HTTP de la noche y su clave | `confect/http.ts` y `src/publicacion.ts`; el cliente, en `apps/nocturna/src/buzon.ts` |
| La limpieza de las huellas de más de 24 horas, cada hora | `confect/limpieza.*.ts` y `confect/crons.ts` |
| La clave del despliegue y el HMAC | `src/claves.ts` |
| La sal del día y la huella de la IP | `src/huella.ts` |
| El token de identidad y los vetos | `src/identidad.ts` |
| Los límites, con sus números | `src/limites.ts` |
| Lo que comprueba el buzón además del esquema | `packages/dominio/src/buzon.ts` |
| El servicio `Sincronizacion` de la web y su cliente de Convex | `apps/web/src/buzon/sincronizacion.ts` y `convex.ts` |

Un envío pasa, en este orden, por la clave, el token, la huella, los vetos, el esquema del dominio, si ya estaba, si es verosímil y los tres límites. Un rechazo deshace todo lo anterior, también las fichas gastadas.

Variables de entorno:

| Variable | Dónde | Qué |
|---|---|---|
| `CELDA_BUZON_CLAVE` | El despliegue de Convex (`convex env set`) | Firma los tokens y calcula las huellas. 32 caracteres o más. Sin ella el buzón está cerrado. Cambiarla deja sin valor los tokens de todos los dispositivos, que piden otro solos, y cambia las huellas del día. |
| `VITE_CELDA_CONVEX_URL` | El build de la web (Vercel) | La URL del despliegue, `https://<nombre>.convex.cloud`. Sin ella la web dice que el buzón está cerrado. |
| `CELDA_PUBLICACION_CLAVE` | El despliegue de Convex (`convex env set`) y la credencial de la noche | Abre solo `GET /aportaciones/aceptadas`, lo aceptado para publicar. 32 caracteres o más. Sin ella, esa acción contesta 401 a todo. |

### Antes del primer despliegue del buzón

Esto lo hace el usuario: el #56 no despliega nada.

1. Crea el despliegue de producción y anota su región. Si Convex ofrece región en la UE, elígela; si no, anótalo en el ADR 0020.
2. Pon la clave: `pnpm exec convex env set CELDA_BUZON_CLAVE "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')" --prod`. No la guardes en ningún fichero del repositorio.
3. En el panel de Convex, en el uso del equipo, pon los umbrales del despliegue por debajo de los topes del plan gratuito, para que se apague el buzón antes que el plan: llamadas a funciones, E/S de base de datos y transferencia de salida al 80 % del tope del mes, y almacenamiento de base de datos al 50 %. Comprueba que al pasarlos el panel desactiva el despliegue y no solo avisa, y apunta en el ADR 0020 qué permite el plan gratuito.
4. Despliega con `pnpm exec convex deploy` desde `convex/`.
5. Comprueba `X-Forwarded-For`: llama dos veces a `buzon:pedirIdentidad` por HTTP (`POST https://<nombre>.convex.cloud/api/mutation` con `{"path":"buzon:pedirIdentidad","args":{},"format":"json"}`), una con `X-Forwarded-For: 198.51.100.66` y otra sin ella, y mira en `huellasDeIp` si sale una huella o dos. Anótalo en el ADR 0020 y borra esas dos identidades.
6. Pon `VITE_CELDA_CONVEX_URL` en las variables de build de Vercel y vuelve a construir la web.
7. Para moderar (#57), crea en el panel de Convex una clave de despliegue de producción (*Settings → Deploy keys*) y guárdala en tu gestor de contraseñas, en tu portátil. Es la `CELDA_CONVEX_CLAVE` de [Moderar](#moderar). Lo puede todo en el despliegue: nunca va a la máquina de la ingesta nocturna.
8. Para la noche, pon la clave de publicación en el despliegue: `pnpm exec convex env set CELDA_PUBLICACION_CLAVE "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')" --prod`. Ponla también, con `CELDA_CONVEX_SITE_URL=https://<nombre>.convex.site`, en el fichero de `credenciales.convex` de la máquina de la noche ([nixos.md](nixos.md#credenciales)). Para cambiarla, cámbiala en los dos sitios.

### Moderar

Modera el usuario solo, con la ayuda de Claude (ADR 0020). La herramienta es `apps/moderacion`, y se lanza desde la raíz de Celda, dentro de `nix develop`:

```sh
pnpm -s moderar pendientes                 # las pendientes, con su contexto
pnpm -s moderar pendientes --tipo correccion-propuesta --limite 20
pnpm -s moderar ver <id>…                   # unas concretas, estén como estén
pnpm -s moderar proponer                   # un veredicto propuesto para cada pendiente, sin cambiar nada
pnpm -s moderar aceptar <id>… --motivo "Se ve en la foto aérea"
pnpm -s moderar rechazar <id>… --motivo "El punto cae en el mar"
pnpm -s moderar vetar identidad <_id> --motivo "Envía puntos en el mar"
pnpm -s moderar vetar ip <huella> --motivo "Cientos de envíos en una hora"
pnpm -s moderar aceptadas [--despues-de <ms>]   # exporta lo aceptado, como lo lee la noche
```

`-s` quita las líneas que añade pnpm, así que la salida es solo la de la orden. `--help` en cada orden dice sus opciones.

De cada aportación, la lista da:

- lo que propone, con la nota si la tiene;
- la ficha publicada de su emplazamiento en la versión vigente: lo que dice el registro oficial de cada compañía, con su fecha y su enlace, y las correcciones ya publicadas;
- la distancia de la posición publicada al punto propuesto (la posición nueva o la medida); de un emplazamiento que falta, los publicados a menos de 300 m y la distancia al más cercano;
- la identidad y la huella de la IP que la enviaron, con cuántas aportaciones suyas se han aceptado, rechazado o esperan, y si están vetadas;
- las demás correcciones propuestas y corroboraciones del mismo emplazamiento, en cualquier estado (de uno que falta, las que dicen que falta uno a menos de 60 m).

**Para un agente.** Con `--json`, cada orden escribe un solo objeto JSON con `formato: 1` y los esquemas de `packages/dominio/src/moderacion.ts` (`AportacionConContexto`, `VeredictoPropuesto`, `AportacionEnCola`). `proponer --json` da cada pendiente con su contexto, un veredicto (`aceptar`, `rechazar` o `mirar`) y sus razones, y no cambia nada. El agente lo lee, lo explica al usuario y, si el usuario lo confirma, lanza `aceptar` o `rechazar` con el motivo. Los errores salen por la salida de errores, con código 1. `aceptar` y `rechazar` con varios identificadores siguen con los demás si uno falla, dicen cuál en `resultados` y acaban con código 1.

**Reglas.** Aceptar, rechazar y vetar piden siempre un motivo con texto. Un veredicto no se cambia: aceptar otra vez una aceptada no hace nada, y rechazar una aceptada falla con `AportacionYaModerada`, porque puede haber salido ya en la publicación. El veto de una identidad no caduca; el de una huella dura lo que ella, 24 horas. Una corroboración se acepta como una corrección propuesta y cuenta una persona más (ADR 0020).

**Conexión.** La herramienta habla con las funciones internas `moderacion:*` por la API HTTP de Convex (`POST <url>/api/query` y `/api/mutation`), con la clave en la cabecera `Authorization: Convex <clave>`, como el cliente de Convex con `setAdminAuth`. No usa el paquete de Convex. Lee:

| Variable | Qué |
|---|---|
| `CELDA_CONVEX_URL` | La URL del despliegue, la misma que `VITE_CELDA_CONVEX_URL`: `https://<nombre>.convex.cloud` |
| `CELDA_CONVEX_CLAVE` | Una clave de despliegue de producción (panel de Convex, *Settings → Deploy keys*). Da acceso a todo el despliegue: no se guarda en ningún fichero del repositorio |
| `CELDA_MODERACION_CAPAS` | De dónde lee lo publicado: una URL o una carpeta. Por defecto, `https://celda.elies.site/capas` |

Para no escribirla a mano en cada terminal, guárdala en un gestor de contraseñas y cárgala al empezar, por ejemplo `export CELDA_CONVEX_CLAVE="$(pass celda/convex-deploy-key)"`. Con el backend local, la clave de administración está en `convex/.convex/local/default/config.json` (`adminKey`):

```sh
export CELDA_CONVEX_URL=http://127.0.0.1:3240
export CELDA_CONVEX_CLAVE="$(jq -r .adminKey convex/.convex/local/default/config.json)"
export CELDA_MODERACION_CAPAS=$PWD/tools/capas/salida
```

La clave de despliegue es para quien modera, en su portátil. **Nunca va a la máquina de la ingesta nocturna**: esa máquina tiene solo la clave de publicación.

**Hacia la publicación.** La noche no habla con las funciones internas. Lee una acción HTTP del despliegue (`convex/confect/http.ts`) con su propia clave:

```
GET https://<nombre>.convex.site/aportaciones/aceptadas?despues-de=<ms>
Authorization: Bearer <CELDA_PUBLICACION_CLAVE>
```

Contesta una `PaginaParaPublicar` (`packages/dominio/src/moderacion.ts`, de `moderacion:publicables`): solo las correcciones propuestas y corroboraciones aceptadas, sin la nota, sin la huella de la IP y sin la identidad. En su lugar va `persona`, el HMAC de la identidad con `CELDA_BUZON_CLAVE`, que cuenta a cada persona una vez y del que no se puede volver a la identidad. Las medidas no salen. Sin la clave, con otra o sin la variable en el despliegue, contesta un 401 vacío, siempre igual; las dos claves se comparan por su SHA-256, sin que el tiempo diga cuánto se parecen. Quien tenga esa clave solo puede leer lo que se va a publicar con licencia CC0.

Cada noche, antes del registro oficial, la ingesta nocturna lee esa acción desde la última aceptada que tiene su base y guarda lo nuevo en `aportaciones_aceptadas`, página a página, como una ejecución de la fuente `comunidad` (`recogerAceptadas` en `apps/nocturna/src/programa.ts`, con el cliente de `apps/nocturna/src/buzon.ts`). El buzón da a cada aceptada una hora propia, posterior a la de la anterior, así que seguir desde la última no se salta ninguna; y una que ya estaba no se guarda dos veces. La publicación pone en la ficha de cada emplazamiento sus correcciones (`correccionesDeFicha`): las propuestas que dicen lo mismo son una, con la clave de la primera, y cuentan cada persona una vez, con las corroboraciones que la citan. El emplazamiento pasa de verificado a corregido, el registro sigue igual al lado y la ficha toma la fecha de la noche que trajo la corrección. Un emplazamiento que falta no se publica: aún no hay dónde enseñarlo, porque no tiene ficha.

Para probarla con el backend local, pon la clave en él (`pnpm exec convex env set CELDA_PUBLICACION_CLAVE …` desde `convex/`) y lanza la noche con `CELDA_CONVEX_SITE_URL=http://127.0.0.1:3241` y la misma clave.

Si Convex no contesta, la ejecución de la comunidad queda fallida con el motivo, el diario dice «El buzón de Convex no está disponible: …. La noche publica lo demás» y la noche sigue. Lo que falte llega la noche siguiente. En la máquina de la ingesta, la conexión es la credencial `credenciales.convex` del módulo de NixOS ([nixos.md](nixos.md#credenciales)).

### Pruebas de Convex

Las pruebas usan el Convex en memoria de convex-test con el esquema, los módulos generados y el componente de límites (`@convex-dev/rate-limiter/test`). `@confect/test` no deja registrar componentes ni fijar la IP, así que `convex/test/TestConfect.ts` repite su envoltorio (`Ref.runWithCodec` y `mutationLayer`) sobre un convex-test que sí lo hace, con la misma interfaz y `desde(ip)` para la IP de la petición. El glob de la documentación de Confect no encuentra `convex/_generated` con Vite 8; `TestConfect.ts` usa `import.meta.glob(["../convex/**/*.ts", "../convex/**/*.js", "!../convex/**/*.d.ts"])`.

El limitador lee la hora con `Date.now()`, que el `TestClock` de Effect no mueve. `convex/test/ayudas.ts` falsea solo `Date` con `vi.useFakeTimers({ toFake: ["Date"] })` y la mueve con `vi.setSystemTime`, así convex-test sigue con sus temporizadores de verdad. La clave de prueba se pone con `vi.stubEnv`. Llenar un cubo de cientos de fichas con envíos tarda en convex-test, así que las pruebas de los límites grandes envían uno, gastan las demás de golpe con el limitador y comprueban que el siguiente envío pasa y el de después no.

- `despliegue.test.ts`: las tablas, que las únicas funciones públicas son las cuatro mutaciones y que solo devuelven un token o si era nueva.
- `buzon.test.ts`: la identidad, cada límite de la tabla del ADR 0020, la idempotencia, la validación y los vetos.
- `huellas.test.ts`: que la IP no está en claro en ninguna tabla, la sal de cada día y la limpieza a las 24 horas.
- `moderacion.test.ts`: que nada llega a lo que lee la noche sin aceptarlo, y las funciones de la moderación: el contexto, el motivo obligatorio también saltándose el cliente, que un veredicto no se cambia, que dos aceptadas en el mismo milisegundo no se saltan y los vetos.
- `publicacion.test.ts`: la acción HTTP de la noche: un 401 vacío sin clave, con otra, sin `Bearer` o sin la variable; con la clave, solo lo aceptado para publicar, sin la medida, la rechazada ni la pendiente, y sin ninguna identidad, huella ni nota en la respuesta; el cursor y un `despues-de` que no es un número.
- `herramienta.test.ts`: la herramienta de moderación entera, con su cliente HTTP, contra el Convex en memoria. Un `HttpClient` de prueba hace de la API HTTP de Convex: lleva cada petición a la función interna que nombra, solo con la clave de prueba. Lanza las órdenes como desde la terminal (`@celda/moderacion/pruebas/orden`): la lista con su contexto, el veredicto propuesto sin cambiar nada, aceptar y rechazar sin motivo, aceptar, rechazar, vetar, exportar y una clave que no vale.

`pnpm run test:repetido` (desde `convex/`) pasa las pruebas de Convex cinco veces con semillas seguidas a partir de una al azar, y la CI lo hace en cada push.

### Un despliegue que tuvo la ingesta

Un despliegue de Convex en la nube con la ingesta de antes del #51 guarda sus tablas (`observaciones`, `emplazamientos`, `estacionesBase`, `ejecuciones`, `interruptores`, `versionesCapa` y, si es de antes del #55, `puntos`), su cron y sus variables de entorno. Nada de eso hace falta: la nocturna tiene su propio estado en SQLite y publica lo mismo. El cron desaparece al desplegar el código nuevo. Antes de desplegarlo, o justo después:

1. Si se quieren guardar los datos, `pnpm exec convex export --path ~/celda-convex.zip`. `unzip` rechaza ese zip como posible bomba; se abre con `UNZIP_DISABLE_ZIPBOMB_DETECTION=TRUE unzip`.
2. Borra esas tablas desde el panel de Convex. El esquema nuevo no las describe y nadie las lee.
3. Borra las variables de entorno del despliegue que eran de la ingesta y la publicación (`pnpm exec convex env list`): `CELDA_R2_*`, que es una clave de escritura del cubo de R2, `CELDA_ALMACEN_*`, `CELDA_INGESTA_*` y `CELDA_REGISTRO_*`.
