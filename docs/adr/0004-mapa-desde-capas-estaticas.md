# El mapa se lee de capas estáticas versionadas, con marca de agua por vista

Estado: aceptada el 24/09/2026. Revisada el 26/09/2026 tras la exploración técnica 03: la capa de emplazamientos de Barcelona es un fichero JSON entero, no PMTiles. Revisada otra vez el mismo día con el formato 2, que añade los barrios (ticket 14).

El mapa necesita todos los emplazamientos a cualquier zoom. Servir eso en vivo gastaría el plan gratuito del backend y obligaría a limitar las lecturas una a una. En su lugar, una instantánea de los emplazamientos se publica como capa estática en una CDN, con su versión en el nombre, por ejemplo `sitios@2026-09-24T03:00Z`. Cada versión es inmutable. La CDN absorbe el volumen, así que el mapa carga rápido y el backend no recibe esas lecturas. El backend sirve solo lo detallado: la ficha de un emplazamiento y el estado de la ingesta.

## Formato de la capa

Para Barcelona, la capa es un único fichero JSON por columnas (coordenadas, máscara de compañías, estado, barrio) con la versión en la cabecera. El navegador lo descarga entero, lo agrupa con supercluster y dibuja como elementos DOM solo los marcadores visibles. La exploración 03 lo midió con 2.000 y 5.000 emplazamientos: 13 a 29 KB comprimidos en una sola petición, 8 a 49 ms de indexado y unos 55 fps durante el zoom en un móvil simulado. Es además la única forma de hacer la transición pedida, en la que los puntos se deslizan hacia el hexágono con el número al alejar y salen de él al acercar, porque la jerarquía de supercluster dice en qué grupo acaba cada punto. Las agrupaciones de las teselas PMTiles no tienen relación entre niveles de zoom y se cortan en los bordes de tesela.

El formato 1 (ticket 10) llevaba `version`, `formato` y las columnas `clave`, `lon`, `lat`, `companias` (una máscara de bits por compañía) y `estado` (un código). El formato 2 (ticket 14) añade, detrás de `formato`, la tabla `barrios` (su fuente, y por columnas `codigo`, `nombre`, `lon` y `lat` de la etiqueta de cada barrio) y, al final, la columna `barrio`: la posición del barrio de cada emplazamiento en esa tabla, o -1 si queda fuera de Barcelona. La web no lee el formato 1; lo trata como una capa dañada.

La versión va al segundo, `sitios@2026-09-26T02:15:03Z`, y sale de la versión de los datos en Convex, no del reloj del generador: la misma instantánea con los mismos límites de barrio da siempre el mismo fichero. Con los 1318 emplazamientos de la caja de Barcelona y los 73 barrios pesa 61,9 KB, 16,5 KB con gzip (el formato 1 pesaba 54,8 y 13,5).

## Barrios

El generador de capas pone a cada emplazamiento su barrio, por punto en polígono, con los límites de Open Data BCN (conjunto `20170706-districtes-barris`, fichero `BarcelonaCiutat_Barris.json`, CC BY 4.0). La otra opción era mandar los polígonos al navegador y asignar allí. Los límites tienen 17.371 vértices y pesan unos 370 KB en JSON, seis veces la capa entera; la tabla de barrios y la columna nueva añaden 7 KB. Asignar en el generador también hace que el recuento de cada barrio salga de la misma versión que los marcadores sin más comprobaciones.

Un punto sobre el lado que comparten dos barrios cae en uno solo: los bordes de la prueba del rayo son semiabiertos. Si dos límites se solapan, gana el de código menor. No hay tolerancia: los emplazamientos que caen a 13 m de Barcelona tienen dirección de L'Hospitalet, y así se quedan.

Los límites se descargan con `pnpm run barrios` en `tools/capas`, que escribe `tools/capas/datos/barrios.json` con un barrio por línea, y ese fichero va en git. `publicar` lo lee de disco. La descarga no es parte de la ingesta porque los límites cambian muy de tarde en tarde (la última fecha del fichero es del 12/11/2024) y así publicar una capa no depende de que responda el portal del Ayuntamiento. La orden comprueba que la licencia siga siendo CC BY 4.0 y guarda la fecha del recurso que da la API del portal. El `robots.txt` del portal prohíbe a los rastreadores `/data/api*` y `/resources/*`, que es de donde sale el fichero; la orden la lanza una persona, hace dos peticiones con los 10 s de su `Crawl-delay` y se presenta con un `User-Agent` de Celda.

En el navegador, `resumirBarrios` (`packages/dominio/src/barrio.ts`) cuenta los emplazamientos de cada barrio y sus ausencias: las compañías con algún emplazamiento en la capa y ninguno en el barrio. Una compañía que no aparece en toda la capa, como hoy Yoigo, no cuenta como ausente.

Fuera del municipio de Barcelona no hay barrios de Open Data BCN. Agrupar por municipio con el mismo aspecto sería engañoso: la caja de datos corta L'Hospitalet, Esplugues, Badalona o Sant Cugat, así que el número y las ausencias serían de un trozo del municipio. Esos emplazamientos siguen agrupados en hexágonos, sin ausencias, también en el nivel de barrios.

El crédito «Ajuntament de Barcelona (nov 2024, CC BY 4.0)» sale de la cabecera de la capa y se ve con los del mapa base en cuanto llega la capa.

PMTiles se reserva para cuando la capa supere unos 20.000 emplazamientos (con 100.000, el JSON pesa 660 KB y tarda cerca de 1 s en indexarse), y para capas precalculadas grandes, como coberturas o simulaciones fuera de línea.

## Marca de agua por vista

La capa y la ficha pueden tener versiones distintas. Cada vista conoce la versión de su dato, y la de la capa se lee de la cabecera antes de pintar. Si la ficha es más reciente que la capa, la ficha lo dice («actualizado después del mapa») y el marcador no se corrige a medias.

El mapa base es OpenFreeMap con el estilo del tema, servido desde sus servidores.

## Consecuencias

- El mapa puede ir por detrás de la ficha hasta la siguiente capa. Se acepta porque la interfaz lo muestra.
- La agrupación depende de `_getOriginZoom`, un detalle interno de supercluster. Se fija la versión exacta y una prueba cubre la transición.
- Si cambian los límites de barrio y no los datos, la capa de esa versión ya existe con otro contenido y `publicar` falla con `CapaInmutable`. Hay que esperar a la siguiente ingesta que cambie algo. Lo mismo pasó al pasar del formato 1 al 2.
- OpenFreeMap está detrás de Cloudflare (lo comprobaron las exploraciones 03 y 05), así que durante un bloqueo de LaLiga también cae el mapa base. Un extracto propio de Barcelona ocuparía unos 24 MB. Lo recoge la decisión 10.
- Dónde se alojan las capas lo fija la decisión 10 de `docs/arquitectura.md`, pendiente de su exploración.
- Las cifras de móvil son simuladas y hay que confirmarlas en un teléfono real.
