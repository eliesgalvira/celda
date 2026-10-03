# La web en Vercel, las capas y las fichas en R2 con copia en Vercel, y aviso ante bloqueos

Estado: aceptada el 28/09/2026, tras la exploración técnica 05 (issue #7, rama `spike/celda-cloudflare`). Sustituye la decisión 10 de `../arquitectura.md`, que ponía la web en Cloudflare Pages. Falta la parte con cuentas reales, que es el ticket #14. Revisada el mismo día con la retención de versiones que decidió el #14, y el 29/09/2026 con la copia de reserva que se construye en Vercel desde R2 (#46). Sustituida en parte por el [ADR 0018](0018-capas-solo-desde-vercel.md) (02/10/2026): las capas y las fichas se sirven solo desde Vercel, R2 es un almacén privado y desaparecen el Worker, la copia de reserva y el cliente con dos orígenes. Siguen valiendo el contexto de los bloqueos, las cabeceras, la publicación con `AlmacenDeFicheros` y la retención en R2. Revisada el 03/10/2026 con el #51: publica la ingesta nocturna, y ya no Convex.

## Contexto

En España los operadores bloquean IP de Cloudflare durante los partidos de LaLiga, por orden judicial y al menos hasta junio de 2027. En 2026 los cortes han durado entre 3 y 6 horas. Con la web en Cloudflare, quien abre Celda por primera vez durante un partido no recibe ni el HTML (`ERR_CONNECTION_RESET` en la prueba 08 de la exploración), y ningún código del cliente puede avisarle.

`elies.site` tiene el DNS en Vercel, y un comodín `*.elies.site` que ya lleva `celda.elies.site` a Vercel. R2 solo acepta un dominio propio si la zona está en Cloudflare, y `r2.dev` no es para producción. Una Pages Function o un Worker con binding a R2 sí funcionan sin tocar el DNS. OpenFreeMap, el mapa base, también está detrás de Cloudflare.

Desde el ADR 0008, lo que se publica son ficheros JSON inmutables, no PMTiles: la capa (ADR 0004), los lotes de fichas de su misma versión y `vigente.json`, el único que cambia. Nada necesita peticiones por rangos.

## Decisión

- La web estática se sirve desde Vercel en `celda.elies.site`.
- La publicación escribe la capa, las fichas y `vigente.json` en un cubo de R2, por su API compatible con S3 (`packages/publicacion/src/almacenes/r2.ts`). Un Worker o una Pages Function con binding a R2 los sirve con sus cabeceras. Es el origen principal de las capas.
- Vercel tiene en `/capas`, en el mismo origen que la web, una copia de la versión vigente de R2, y solo de esa. Es el origen de reserva. La construye el build de Vercel (#46, «La copia de reserva» abajo).
- Cabeceras: los ficheros con versión en el nombre llevan `public, max-age=31536000, immutable`; `vigente.json`, `public, max-age=0, must-revalidate`. Una petición de un fichero que no existe da 404, no la página de la web.
- Los ficheros con versión no cambian nunca y `vigente.json` se escribe el último, cuando la capa y todas sus fichas ya están. El cliente no compara ETag entre orígenes: el nombre versionado basta.
- El cliente pide cada fichero al origen activo con un tiempo límite de 3 s. Un error de red, un tiempo agotado, un 5xx, un 429 o el error 1027 de Cloudflare lo hacen pasar al otro. Recuerda durante una hora que el principal falló y lo vuelve a sondear en segundo plano.
- Si no responde ningún origen, la interfaz lo dice y no pinta un mapa vacío.
- Si el mapa base no carga, se pintan los emplazamientos sobre un fondo liso y se dice.

## Cómo se publica

La publicación es automática y la hace la ingesta nocturna (ADR 0015), un programa de Node que corre cada noche en una máquina con NixOS: publica a mitad de la ventana de fichas y al final de la noche, y `celda-nocturna publicar` publica a mano. Hasta el #51 (03/10/2026) publicaba `publicacion:publicar`, una acción de Node de Convex, al acabar cada ejecución de ingesta completada. Si los datos no han cambiado desde la versión de `vigente.json`, no escribe nada; si la anterior falló, la repite. Detrás hay un servicio `AlmacenDeFicheros` con dos implementaciones:

- `almacenEnCarpeta`, para el desarrollo en local, las pruebas y la vista previa. Se activa con `CELDA_ALMACEN_CARPETA`.
- `almacenEnR2`, para producción. Se activa con `CELDA_R2_CUENTA`, `CELDA_R2_CUBO`, `CELDA_R2_ID_CLAVE` y `CELDA_R2_SECRETO`. Sube cada fichero con `If-None-Match: *`; si R2 contesta 412, lo lee y solo lo da por bueno si es igual.

`CELDA_ALMACEN_ORIGEN` es la URL pública de lo publicado. Sin almacén, la publicación no hace nada y lo apunta en el registro. Las variables son de la configuración de la ingesta nocturna; las credenciales de R2 le llegan como credenciales de systemd (`docs/patterns/nixos.md`).

## La copia de reserva (#46, 29/09/2026)

La copia de Vercel ya no se sube a mano ni guarda ocho versiones. Con toda España no cabían: una subida por CLI en Hobby admite 100 MB y 15.000 ficheros, y ocho versiones eran unos 580 MB. Ahora la monta el build de Vercel con la versión vigente de R2:

1. Tras publicar, la noche lee el `vigente.json` de R2 y el de la copia (`CELDA_RESERVA_ORIGEN`, `https://celda.elies.site/capas`). Si no dicen la misma versión con el mismo resumen, o la copia no contesta, llama al deploy hook de Vercel (`CELDA_VERCEL_DEPLOY_HOOK`, una credencial de systemd). Si coinciden, no hace nada. Lo hace también si la publicación de esa noche falló, porque la copia sigue a lo que haya en R2. Un hook que falla queda en el diario y la noche siguiente vuelve a comparar (`actualizarReserva` en `packages/publicacion/src/reserva.ts`).
2. El build (`apps/web/scripts/vercel.sh`) construye la web con `VITE_CAPAS_ORIGEN` apuntando a R2 y `VITE_CAPAS_RESERVA=/capas`, y lanza `celda-nocturna reserva <R2> dist/capas` (`copiarVigente`). La orden lee `vigente.json` una vez y copia su resumen, su manifiesto y las capas y los lotes que lista el manifiesto. Comprueba que el resumen es de esa versión y que cada fichero nombrado por su contenido coincide con su huella. Escribe `vigente.json` el último.
3. Si no llega a R2, si falta algo o si una huella no cuadra, la orden falla y el build con ella. Vercel no publica un despliegue que no ha terminado, así que sigue sirviendo el anterior entero, web y copia.

Así la copia nunca anuncia en su `vigente.json` una versión que no tiene entera, y nunca mezcla ficheros de dos versiones. Mientras el build corre, o si falla, la copia sirve la versión anterior. El cliente lo aguanta: un fichero que la reserva no tiene da 404, y los servicios de capa y de fichas leen entonces la vigente de ese origen (ADR 0004).

Con los 42.900 emplazamientos sintéticos de `tools/capas` (`pnpm run sintetica`), la copia son 415 ficheros y 24 MB. Con las fichas de verdad serían unos 400 ficheros y 72 MB sin comprimir (investigación 08). La salida de un build no tiene el tope de ficheros de la subida por CLI.

`apps/web/vercel.json` lleva el build (`buildCommand`, `installCommand`, `outputDirectory`), así que el proyecto de Vercel tiene que tener como raíz `apps/web`. `sitio.sh` usa la misma orden para montar el sitio en local o subirlo a mano si el hook falla.

## Consecuencias

- No hay que cambiar el DNS de `elies.site`.
- Cada petición a la función de R2 gasta cuota gratuita de Workers (100.000 al día), también los aciertos de caché. Al agotarla, el tráfico pasa a Vercel.
- Publicar es escribir en R2 y, si la copia de Vercel no está al día, llamar a su deploy hook. Cada build lee de R2 unos 400 ficheros por el Worker, que cuentan en la cuota diaria de 100.000. Conectarlo a las cuentas reales es cosa del usuario (#42).
- Retención (issue #14, 28/09/2026): el almacén guarda la versión vigente y las 7 anteriores. Al acabar cada publicación, también cuando ya estaba al día, `retirarVersionesViejas` lista el almacén y borra las versiones más viejas, primero la capa y luego sus lotes. Nunca toca la vigente ni una posterior a ella, que puede ser otra publicación a medias que aún no ha escrito `vigente.json`. Si el borrado falla, la publicación sigue siendo buena: queda en el registro y la siguiente lo repite. Una pestaña que lleve abierta más de ocho publicaciones lee la ficha de la vigente y lo dice (ADR 0004). Con toda España serían unos 800 lotes y 190 MB sin comprimir por versión, unos 1,5 GB con ocho, dentro de los 10 GB gratis de R2. Para listar, R2 usa ListObjectsV2 con la consulta firmada, y para borrar, DELETE. Desde el formato 5 las versiones comparten capas de provincia y lotes: la retirada lee los manifiestos y solo borra lo que no lista ninguna versión que se queda (ADR 0016). La copia de Vercel no retira nada: cada despliegue solo lleva la vigente.
- Una pestaña que lleva abierta desde antes de una publicación puede pedir a la reserva un lote de una versión que ya no tiene, porque solo guarda la vigente. El servicio de fichas lo resuelve leyendo la vigente, y la marca de agua lo dice (ADR 0004).
- El cliente con los dos orígenes está en `apps/web/src/capa/origenes.ts`. Pide a R2 primero, pasa a `/capas` en los casos de arriba y guarda en `localStorage` hasta cuándo va primero a la reserva. Mientras tanto prueba R2 cada cinco minutos con `vigente.json`. Sus pruebas repasan los escenarios de la exploración 05.
- Vercel también ha sido bloqueado alguna vez. Si caen los dos orígenes, Celda lo dice. Un Service Worker que guarde la web queda como mejora.
- Un extracto propio del mapa base de Barcelona (24 MB) puede seguir el mismo camino que las capas. Queda fuera de este ADR.

## Alternativas descartadas

- Web en Cloudflare Pages con CNAME desde Vercel: la primera visita durante un partido no recibe nada.
- R2 con dominio propio: exige mover los servidores de nombres de `elies.site` a Cloudflare.
- `r2.dev`: no es para producción.
- Solo Vercel: sirve para los datos de Barcelona, pero el mapa base propio y los datos de España gastarían la transferencia y los límites de subida de Hobby.
- La ficha en vivo desde Convex: ver ADR 0008.
