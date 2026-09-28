# La ingesta y la publicación, como trabajo programado fuera de Convex, con su estado en R2

Estado: propuesta (28/09/2026). Sale de la investigación de la ampliación a toda España (`docs/investigacion/espana.md`, apartado 2). Si se acepta, cambia el ADR 0003 (Convex deja de ser la fuente canónica de los emplazamientos) y la parte del ADR 0010 que dice dónde corre la publicación.

## Contexto

Hoy la ingesta corre en acciones de Convex lanzadas por sus crons, guarda observaciones, puntos, emplazamientos y estaciones base en tablas y, al acabar, una acción de Node publica en R2. A escala España, con unos 69.700 registros y 42.000 emplazamientos, eso choca con el plan gratuito por cuatro lados (estimado sobre el código):

- **E/S.** Cada ejecución relee todas las tablas: el listado lee por clave cada observación, el cierre del barrido las vuelve a leer, la fusión lee todo y escribe comparando cada emplazamiento con el suyo, y la publicación lee la instantánea y las fichas. Son unos 0,73 GB por noche y 22 GB al mes, frente a 1 GB gratis. La misma cuenta da unos 0,75 GB al mes con la caja de Barcelona.
- **Límites por transacción.** `cerrarBarrido` y `cerrarBarridoDePuntos` leen de una vez 69.700 y 42.855 documentos, por encima de los 32.000 documentos y 16 MiB por transacción.
- **Memoria.** La fusión junta todas las observaciones en una acción del runtime de Convex, con 64 MiB.
- **Duración.** Una noche con 2.440 fichas a una cada 5 s dura 4 horas; una acción, 10 o 30 minutos.

El almacenamiento sí cabría: unos 160 MB de documentos, 420 MB si cada índice cuenta como una copia de la tabla. Starter solo resuelve la E/S, por unos 4,6 $ al mes, y deja los otros tres problemas.

## Decisión

- La ingesta y la publicación son un proceso de Node que lanza un cron de GitHub Actions cada noche. Usa el mismo código de `packages/ingesta` y `packages/dominio`, con Effect. Los extractores no cambian; lo que cambia es dónde se guarda lo que traen.
- **El estado vive en R2**, en ficheros con prefijo propio, fuera de lo que se publica:
  - las observaciones de cada zona de barrido (ADR 0014), una por fichero;
  - las hojas de cada celda de la rejilla;
  - los puntos de antenasmoviles.es con su huella;
  - el registro de ejecuciones: fuente, fechas, cambios y errores, igual que la tabla de hoy.

  Cada ejecución lee lo que necesita, trabaja en memoria y escribe solo los ficheros que cambian. Hoy serían unos 90 MB sin comprimir y 12 MB con gzip (estimado).
- La fusión se hace entera en memoria. El ejecutor de GitHub tiene 7 GB, y la función de fusión ya es pura.
- La publicación escribe en R2 como hoy (`AlmacenDeFicheros`) y luego llama al deploy hook de Vercel para la copia de reserva.
- El interruptor de cada fuente es una variable del repositorio o un fichero en R2. Apagarlo no requiere desplegar.
- **Convex se queda para lo que le va bien:** las aportaciones compartidas, cuando lleguen, con sus límites (ADR 0008). La ingesta lee de Convex las correcciones compartidas aprobadas con una consulta interna por páginas, y ese es el único tráfico nocturno hacia Convex.
- El estado de la ingesta para el mantenedor es el registro de ejecuciones en R2 y el propio historial de GitHub Actions. `ingesta:estado` deja de existir.

## Consecuencias

- **Minutos de GitHub Actions.** Un repositorio privado de una cuenta gratuita tiene 2.000 minutos al mes y se bloquea al acabarlos. Con 4 horas de fichas por noche son 7.200. Hasta que Celda tenga su repositorio público, donde los ejecutores normales no tienen tope de minutos, la ventana de fichas se queda en unos 40 minutos por noche.
- Los ejecutores de GitHub salen desde IP de Azure. Una fuente que bloquee centros de datos dejaría la ingesta sin datos; el extractor ya lo trata como fuente bloqueada y no como zona vacía.
- Se pierden las pruebas de la API de Convex en memoria para la ingesta. Se sustituyen por pruebas del proceso contra un `AlmacenDeFicheros` en carpeta, que ya existe para la publicación.
- Las tablas `observaciones`, `puntos`, `emplazamientos`, `estacionesBase`, `ejecuciones`, `interruptores` y `versionesCapa` se vacían y se borran tras migrar su contenido a R2.
- Se puede hacer por pasos. Primero el mismo trabajo para la caja de Barcelona, comparando la capa con la que publica Convex la misma noche. Después, la ampliación.

## Alternativas descartadas

- **Seguir en Convex gratuito rehaciendo la ingesta**, con una huella por tesela, fusión y publicación por zona y acciones encadenadas. Es posible, pero es un diseño incremental hecho a mano contra límites que se descubren al chocar con ellos, y la E/S seguiría creciendo con cada fuente nueva.
- **Convex Starter.** Paga la E/S pero no quita los límites por transacción, la memoria ni la duración de las acciones.
- **Un servidor propio.** Resuelve todo, pero añade una máquina que mantener, y Celda no tiene ninguna.
