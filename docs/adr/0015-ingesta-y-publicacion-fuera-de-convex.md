# La ingesta y la publicación, fuera de Convex: un servicio de NixOS con su estado en SQLite

Estado: aceptada el 08/10/2026. Se propuso el 28/09/2026, con las decisiones del usuario del mismo día, y corre en producción desde el 01/10/2026, como servicio de NixOS en el portátil de la ingesta nocturna (#42). Sale de la investigación de la ampliación a toda España (`docs/investigacion/espana.md`, apartado 2). Cambia el ADR 0003 (Convex deja de ser la fuente canónica de los emplazamientos) y la parte del ADR 0010 que dice dónde corre la publicación. Revisada el 02/10/2026: el ADR 0019 retira antenasmoviles.es de la base y del módulo de NixOS, el ADR 0018 lleva las copias de la base también a R2 y el 0020 fija qué hace Convex con las aportaciones. Revisada el 03/10/2026: el #51 retira de Convex las tablas, el cron y las funciones de la ingesta y la publicación (ver «Consecuencias»). Revisada el 20/10/2026: el [ADR 0029](0029-una-ejecucion-al-mes-en-fin-de-semana.md) cambia el temporizador de cada noche por una ejecución el primer sábado de cada mes y otra el domingo siguiente, y una ejecución perdida ya no se recupera al encender la máquina.

## Contexto

Hoy la ingesta corre en acciones de Convex lanzadas por sus crons. Guarda observaciones, puntos, emplazamientos y estaciones base en tablas y, al acabar, una acción de Node publica en R2. A escala España, con unos 69.700 registros y 42.000 emplazamientos, eso choca con el plan gratuito por cuatro lados (estimado sobre el código):

- **E/S.** Cada ejecución relee todas las tablas. Son unos 0,73 GB por noche y 22 GB al mes, frente a 1 GB gratis. La misma cuenta da unos 0,75 GB al mes con la caja de Barcelona.
- **Límites por transacción.** `cerrarBarrido` y `cerrarBarridoDePuntos` leen de una vez 69.700 y 42.855 documentos, por encima de los 32.000 documentos y 16 MiB por transacción.
- **Memoria.** La fusión junta todas las observaciones en una acción del runtime de Convex, con 64 MiB.
- **Duración.** Una noche de fichas dura horas; una acción, 10 o 30 minutos.

La investigación proponía un cron de GitHub Actions. El usuario lo descartó el 28/09/2026 y eligió un portátil suyo con NixOS, siempre encendido, con disco cifrado y un segundo disco reservado para copias de seguridad. Así no hay minutos que contar ni IP de centro de datos, y las noches pueden durar lo que haga falta.

## Decisión

### Qué corre y dónde

- La ingesta y la publicación son un programa de Node 24 con el mismo código de `packages/ingesta` y `packages/dominio`, con Effect. Corre cada noche en el portátil del usuario, lanzado por un temporizador de systemd.
- **El estado entre noches vive en SQLite**, en el portátil: observaciones por zona, teselas de cada celda (ADR 0014), fichas pendientes y cuándo se leyó cada una, puntos de antenasmoviles.es con su huella, ejecuciones con sus cambios y errores, y la huella de cada fichero publicado. La fusión se hace en memoria; la función ya es pura.
- La base se abre con el módulo `node:sqlite` de Node 24, sin extensiones nativas, para que el paquete de Nix no tenga que compilar nada. El #35 comprobó que basta. Se abre con el adaptador de SQLite de Effect, `@effect/sql-sqlite-node`, que en Effect 4 usa ese mismo módulo: no hay que elegir entre los dos.
- **Copia de seguridad.** Al acabar cada noche, el programa copia la base con `VACUUM INTO` a un directorio de copias y conserva las últimas catorce. El directorio lo elige quien configura la máquina. Perder la base no pierde el mapa, que está publicado en R2: se reconstruye con una pasada completa, pero las fichas tardarían otra vez días en leerse.
- La publicación escribe en R2 como hoy (`AlmacenDeFicheros`) y llama al deploy hook de Vercel para la copia de reserva.
- **Convex queda solo para las aportaciones compartidas**, cuando lleguen. La ingesta leerá de ahí las correcciones aprobadas; hasta entonces no habla con Convex.

### Qué exporta Celda en su flake

Celda sigue el patrón dendrítico que ya usa su flake: un fichero `*.mod.nix` por cosa.

- **Un paquete hermético de la ingesta.** Las dependencias de pnpm se fijan dentro de Nix con el fetcher de pnpm de nixpkgs (`pnpm.fetchDeps`, que en las versiones recientes se llama `fetchPnpmDeps`) y su hash va en el repositorio. El programa se empaqueta en un solo fichero y lo ejecuta el Node 24 de nixpkgs con un envoltorio. Da una orden con subórdenes: la noche entera, el estado, publicar a mano y la copia de seguridad.
- **Un módulo de NixOS genérico**, sin nada personal. Crea un usuario dedicado, un servicio `oneshot` y su temporizador, con opciones para:
  - activarlo y elegir el paquete;
  - el horario del temporizador, y si recupera una noche perdida al encenderse;
  - el directorio de estado, gestionado por systemd;
  - el directorio de copias y cuántas conservar;
  - el fichero de credenciales de R2 y el del deploy hook de Vercel, que se cargan como credenciales de systemd y nunca entran en el almacén de Nix;
  - el ritmo de peticiones de cada fuente y la ventana de fichas;
  - las zonas a barrer (ADR 0014) y la fuente de cada una, con antenasmoviles.es apagada por defecto.

  El servicio se endurece con las opciones de systemd habituales: sistema de ficheros de solo lectura salvo su estado, sin privilegios nuevos, solo red IP y un tiempo máximo que cubra la ventana de fichas.
- El estado para el mantenedor es la suborden de estado, que lee la base, y el diario de systemd. Se consulta por SSH.

### Qué va en la configuración del usuario

La configuración personal vive en el repositorio de NixOS del usuario, no en Celda: la entrada del flake de Celda, activar el módulo en el portátil, el horario, las rutas de los ficheros de credenciales y el directorio de copias en el disco de copias. Celda no sabe nada de esa máquina. Así, otra persona puede montar su propia ingesta con el mismo módulo.

## Consecuencias

- Se pierden las pruebas de la API de Convex en memoria para la ingesta. Se sustituyen por pruebas del proceso contra una base SQLite temporal y un `AlmacenDeFicheros` en carpeta, que ya existe para la publicación. El módulo de NixOS se prueba con una prueba de máquina virtual de NixOS que lanza el temporizador contra fuentes y almacén de prueba.
- Cada cambio del lockfile de pnpm que toque la ingesta obliga a actualizar el hash de sus dependencias en Nix. La construcción del paquete entra en las comprobaciones de Celda.
- **Riesgos de la máquina:**
  - si el portátil está apagado, el temporizador recupera la noche al volver;
  - si se reinicia y el disco cifrado espera a que lo abran, esa noche no corre;
  - un corte de luz a mitad deja la ejecución interrumpida, y la siguiente la retoma porque cada paso es idempotente.
- **Riesgo de red:** la conexión sale desde España. Durante un bloqueo de LaLiga caen R2 y Cloudflare. La noche se programa lejos de los partidos, y si publicar falla, se reintenta al cabo de una hora y, si no, la noche siguiente. Los datos no se pierden: quedan en SQLite.
- Las fuentes no ven una IP de centro de datos.
- Las tablas de Convex de la ingesta (`observaciones`, `puntos`, `emplazamientos`, `estacionesBase`, `ejecuciones`, `interruptores` y `versionesCapa`) y sus crons se iban a retirar cuando la ingesta del portátil publicase lo mismo que Convex durante una semana. El #51 los retiró el 03/10/2026, con sus funciones, sin esa semana: la ingesta del portátil ya corría desde el 01/10/2026 (#42), pero Convex nunca tuvo un despliegue en la nube con la ingesta, así que no había publicaciones de Convex con las que comparar. Lo que respaldaba que las dos publicaban lo mismo era `convex/test/nocturna.test.ts`, que hacía las mismas noches en las dos con las mismas respuestas grabadas y comparaba byte a byte lo publicado; se borró con la ingesta de Convex. Las pruebas de la publicación y de la ficha que corrían sobre Convex en memoria corren ahora sobre la base SQLite (`apps/nocturna/src/publicacion.test.ts`). Qué hacer con un despliegue de Convex que tuvo la ingesta: `docs/patterns/convex.md`, «Un despliegue que tuvo la ingesta».

## Alternativas descartadas

- **Seguir en Convex gratuito rehaciendo la ingesta**, con una huella por tesela, fusión y publicación por zona y acciones encadenadas. Es un diseño incremental hecho a mano contra límites que se descubren al chocar con ellos.
- **Convex Starter.** Paga la E/S pero no quita los límites por transacción, la memoria ni la duración de las acciones.
- **GitHub Actions con el estado en R2**, la propuesta de la investigación. Tiene 2.000 minutos al mes en un repositorio privado, sale desde IP de Azure y guarda el estado en ficheros sueltos. El usuario prefirió su portátil.
- **Poner la configuración personal en Celda.** Celda va a ser de código abierto y tiene que servir a cualquiera; las credenciales, el horario y las rutas de una máquina concreta no son suyos.
