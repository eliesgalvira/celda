# La web en Vercel, las capas y las fichas en R2 con copia en Vercel, y aviso ante bloqueos

Estado: aceptada el 28/09/2026, tras la exploración técnica 05 (issue #7, rama `spike/celda-cloudflare`). Sustituye la decisión 10 de `../arquitectura.md`, que ponía la web en Cloudflare Pages. Falta la parte con cuentas reales, que es el ticket #14. Revisada el mismo día con la retención de versiones que decidió el #14.

## Contexto

En España los operadores bloquean IP de Cloudflare durante los partidos de LaLiga, por orden judicial y al menos hasta junio de 2027. En 2026 los cortes han durado entre 3 y 6 horas. Con la web en Cloudflare, quien abre Celda por primera vez durante un partido no recibe ni el HTML (`ERR_CONNECTION_RESET` en la prueba 08 de la exploración), y ningún código del cliente puede avisarle.

`elies.site` tiene el DNS en Vercel, y un comodín `*.elies.site` que ya lleva `celda.elies.site` a Vercel. R2 solo acepta un dominio propio si la zona está en Cloudflare, y `r2.dev` no es para producción. Una Pages Function o un Worker con binding a R2 sí funcionan sin tocar el DNS. OpenFreeMap, el mapa base, también está detrás de Cloudflare.

Desde el ADR 0008, lo que se publica son ficheros JSON inmutables, no PMTiles: la capa (ADR 0004), los lotes de fichas de su misma versión y `vigente.json`, el único que cambia. Nada necesita peticiones por rangos.

## Decisión

- La web estática se sirve desde Vercel en `celda.elies.site`.
- La publicación escribe la capa, las fichas y `vigente.json` en un cubo de R2, por su API compatible con S3 (`convex/src/almacenes/r2.ts`). Un Worker o una Pages Function con binding a R2 los sirve con sus cabeceras. Es el origen principal de las capas.
- Vercel tiene una copia de los mismos ficheros en `/capas`, en el mismo origen que la web. Es el origen de reserva. `apps/web/scripts/sitio.sh` monta ese sitio: la web construida, lo publicado y `apps/web/vercel.json`.
- Cabeceras: los ficheros con versión en el nombre llevan `public, max-age=31536000, immutable`; `vigente.json`, `public, max-age=0, must-revalidate`. Una petición de un fichero que no existe da 404, no la página de la web.
- Los ficheros con versión no cambian nunca y `vigente.json` se escribe el último, cuando la capa y todas sus fichas ya están. El cliente no compara ETag entre orígenes: el nombre versionado basta.
- El cliente pide cada fichero al origen activo con un tiempo límite de 3 s. Un error de red, un tiempo agotado, un 5xx, un 429 o el error 1027 de Cloudflare lo hacen pasar al otro. Recuerda durante una hora que el principal falló y lo vuelve a sondear en segundo plano.
- Si no responde ningún origen, la interfaz lo dice y no pinta un mapa vacío.
- Si el mapa base no carga, se pintan los emplazamientos sobre un fondo liso y se dice.

## Cómo se publica

La publicación es automática: al acabar cada ejecución de ingesta completada, la acción de la ingesta llama a `publicacion:publicar`, una acción de Node de Convex. Si los datos no han cambiado desde la versión de `vigente.json`, no escribe nada; si la anterior falló, la repite. Detrás hay un servicio `AlmacenDeFicheros` con dos implementaciones:

- `almacenEnCarpeta`, para el backend local, las pruebas y la vista previa. Se activa con `CELDA_ALMACEN_CARPETA`.
- `almacenEnR2`, para producción. Se activa con `CELDA_R2_CUENTA`, `CELDA_R2_CUBO`, `CELDA_R2_ID_CLAVE` y `CELDA_R2_SECRETO`. Sube cada fichero con `If-None-Match: *`; si R2 contesta 412, lo lee y solo lo da por bueno si es igual.

`CELDA_ALMACEN_ORIGEN` es la URL pública de lo publicado. Sin almacén, la publicación no hace nada y lo apunta en el registro.

## Consecuencias

- No hay que cambiar el DNS de `elies.site`.
- Cada petición a la función de R2 gasta cuota gratuita de Workers (100.000 al día), también los aciertos de caché. Al agotarla, el tráfico pasa a Vercel.
- Publicar es escribir en R2 y, además, volver a desplegar la copia de Vercel con los ficheros nuevos. La publicación de R2 ya está hecha y probada contra un cubo S3 de prueba; conectarla a un cubo real y hacer el despliegue de la copia tras cada publicación, por ejemplo con un deploy hook de Vercel cuyo build descargue lo vigente de R2, es el ticket #14. Hasta entonces la copia de Vercel se hace a mano con `sitio.sh`.
- Retención (issue #14, 28/09/2026): el almacén guarda la versión vigente y las 7 anteriores. Al acabar cada publicación, también cuando ya estaba al día, `retirarVersionesViejas` lista el almacén y borra las versiones más viejas, primero la capa y luego sus lotes. Nunca toca la vigente ni una posterior a ella, que puede ser otra publicación a medias que aún no ha escrito `vigente.json`. Si el borrado falla, la publicación sigue siendo buena: queda en el registro y la siguiente lo repite. Una pestaña que lleve abierta más de ocho publicaciones lee la ficha de la vigente y lo dice (ADR 0004). Con toda España serían unos 800 lotes y 190 MB sin comprimir por versión, unos 1,5 GB con ocho, dentro de los 10 GB gratis de R2. Para listar, R2 usa ListObjectsV2 con la consulta firmada, y para borrar, DELETE. La copia de Vercel sale de la misma carpeta y guarda lo mismo. Para España no cabría: una subida por CLI en Hobby admite 100 MB y 15.000 ficheros, así que habrá que subir los ficheros comprimidos o generar la copia en el build.
- Una pestaña que lleva abierta desde antes de una publicación puede pedir un lote de una versión que la reserva ya no tiene. El servicio de fichas lo resuelve leyendo la vigente, y la marca de agua lo dice (ADR 0004).
- Vercel también ha sido bloqueado alguna vez. Si caen los dos orígenes, Celda lo dice. Un Service Worker que guarde la web queda como mejora.
- Un extracto propio del mapa base de Barcelona (24 MB) puede seguir el mismo camino que las capas. Queda fuera de este ADR.

## Alternativas descartadas

- Web en Cloudflare Pages con CNAME desde Vercel: la primera visita durante un partido no recibe nada.
- R2 con dominio propio: exige mover los servidores de nombres de `elies.site` a Cloudflare.
- `r2.dev`: no es para producción.
- Solo Vercel: sirve para los datos de Barcelona, pero el mapa base propio y los datos de España gastarían la transferencia y los límites de subida de Hobby.
- La ficha en vivo desde Convex: ver ADR 0008.
