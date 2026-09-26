# El mapa se lee de capas estáticas versionadas, con marca de agua por vista

Estado: aceptada el 24/09/2026. Revisada el 26/09/2026 tras la exploración técnica 03: la capa de emplazamientos de Barcelona es un fichero JSON entero, no PMTiles.

El mapa necesita todos los emplazamientos a cualquier zoom. Servir eso en vivo gastaría el plan gratuito del backend y obligaría a limitar las lecturas una a una. En su lugar, una instantánea de los emplazamientos se publica como capa estática en una CDN, con su versión en el nombre, por ejemplo `sitios@2026-09-24T03:00Z`. Cada versión es inmutable. La CDN absorbe el volumen, así que el mapa carga rápido y el backend no recibe esas lecturas. El backend sirve solo lo detallado: la ficha de un emplazamiento y el estado de la ingesta.

## Formato de la capa

Para Barcelona, la capa es un único fichero JSON por columnas (coordenadas, máscara de compañías, estado, barrio) con la versión en la cabecera. El navegador lo descarga entero, lo agrupa con supercluster y dibuja como elementos DOM solo los marcadores visibles. La exploración 03 lo midió con 2.000 y 5.000 emplazamientos: 13 a 29 KB comprimidos en una sola petición, 8 a 49 ms de indexado y unos 55 fps durante el zoom en un móvil simulado. Es además la única forma de hacer la transición pedida, en la que los puntos se deslizan hacia el hexágono con el número al alejar y salen de él al acercar, porque la jerarquía de supercluster dice en qué grupo acaba cada punto. Las agrupaciones de las teselas PMTiles no tienen relación entre niveles de zoom y se cortan en los bordes de tesela.

El formato 1, el primero que se publica (ticket 10), lleva `version`, `formato` y las columnas `clave`, `lon`, `lat`, `companias` (una máscara de bits por compañía) y `estado` (un código). La columna de barrio llegará con los barrios, en un formato nuevo. La versión va al segundo, `sitios@2026-09-26T02:15:03Z`, y sale de la versión de los datos en Convex, no del reloj del generador: la misma instantánea da siempre el mismo fichero. Con los 1318 emplazamientos de la caja de Barcelona pesa 54,8 KB, 13,5 KB con gzip.

Los recuentos y las compañías ausentes por barrio se calculan en el navegador a partir de la misma capa y de los límites de barrio.

PMTiles se reserva para cuando la capa supere unos 20.000 emplazamientos (con 100.000, el JSON pesa 660 KB y tarda cerca de 1 s en indexarse), y para capas precalculadas grandes, como coberturas o simulaciones fuera de línea.

## Marca de agua por vista

La capa y la ficha pueden tener versiones distintas. Cada vista conoce la versión de su dato, y la de la capa se lee de la cabecera antes de pintar. Si la ficha es más reciente que la capa, la ficha lo dice («actualizado después del mapa») y el marcador no se corrige a medias.

El mapa base es OpenFreeMap con el estilo del tema, servido desde sus servidores.

## Consecuencias

- El mapa puede ir por detrás de la ficha hasta la siguiente capa. Se acepta porque la interfaz lo muestra.
- La agrupación depende de `_getOriginZoom`, un detalle interno de supercluster. Se fija la versión exacta y una prueba cubre la transición.
- OpenFreeMap está detrás de Cloudflare (lo comprobaron las exploraciones 03 y 05), así que durante un bloqueo de LaLiga también cae el mapa base. Un extracto propio de Barcelona ocuparía unos 24 MB. Lo recoge la decisión 10.
- Dónde se alojan las capas lo fija la decisión 10 de `docs/arquitectura.md`, pendiente de su exploración.
- Las cifras de móvil son simuladas y hay que confirmarlas en un teléfono real.
