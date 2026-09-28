# El mapa y las fichas se leen de ficheros estáticos versionados, con marca de agua por vista

Estado: aceptada el 24/09/2026. Revisada el 26/09/2026 tras la exploración técnica 03: la capa de emplazamientos de Barcelona es un fichero JSON entero, no PMTiles. Revisada otra vez el mismo día con el formato 2, que añade los barrios (ticket 14), y con el 3, que añade las bandas (ticket 25). Revisada el 28/09/2026 con el ADR 0008: las fichas también se publican como ficheros estáticos de la misma versión, en lotes, y la capa pasa al formato 4.

El mapa necesita todos los emplazamientos a cualquier zoom. Servir eso en vivo gastaría el plan gratuito del backend y obligaría a limitar las lecturas una a una. En su lugar, una instantánea de los emplazamientos se publica como capa estática en una CDN, con su versión en el nombre, por ejemplo `sitios@2026-09-24T03:00Z`. Cada versión es inmutable. La CDN absorbe el volumen, así que el mapa carga rápido y el backend no recibe esas lecturas. Desde el ADR 0008, la ficha de cada emplazamiento se publica igual, junto a la capa, y el público no lee nada de Convex.

## Formato de la capa

Para Barcelona, la capa es un único fichero JSON por columnas (coordenadas, máscara de compañías, estado, barrio) con la versión en la cabecera. El navegador lo descarga entero, lo agrupa con supercluster y dibuja como elementos DOM solo los marcadores visibles. La exploración 03 lo midió con 2.000 y 5.000 emplazamientos: 13 a 29 KB comprimidos en una sola petición, 8 a 49 ms de indexado y unos 55 fps durante el zoom en un móvil simulado. Es además la única forma de hacer la transición pedida, en la que los puntos se deslizan hacia el hexágono con el número al alejar y salen de él al acercar, porque la jerarquía de supercluster dice en qué grupo acaba cada punto. Las agrupaciones de las teselas PMTiles no tienen relación entre niveles de zoom y se cortan en los bordes de tesela.

El formato 1 (ticket 10) llevaba `version`, `formato` y las columnas `clave`, `lon`, `lat`, `companias` (una máscara de bits por compañía) y `estado` (un código). El formato 2 (ticket 14) añade, detrás de `formato`, la tabla `barrios` (su fuente, y por columnas `codigo`, `nombre`, `lon` y `lat` de la etiqueta de cada barrio) y, al final, la columna `barrio`: la posición del barrio de cada emplazamiento en esa tabla, o -1 si queda fuera de Barcelona. La web no lee el formato 1; lo trata como una capa dañada.

El formato 3 (ticket 25) añade al final la columna `bandas`: por emplazamiento, un número con siete bits por compañía, uno por banda, con las bandas que el registro ya ha dado a cada estación base. La vista de interferencia necesita a la vez las bandas de todas las estaciones base de una compañía, y pedirlas al backend sería leer en vivo lo que ve el mapa entero, justo lo que esta decisión evita. Un 0 quiere decir que no se conoce ninguna banda, no que no emita en ninguna: la ingesta lee las fichas del registro poco a poco. La web lee el formato 2 y el 3; con el 2 no conoce ninguna banda.

El formato 4 (28/09/2026) añade detrás la columna `lote`: el lote de fichas en que está la de cada emplazamiento. La web lee del 2 al 4, pero sin el 4 no encuentra las fichas y el panel lo dice como un fallo.

La versión va al segundo, `sitios@2026-09-26T02:15:03Z`, y sale de la versión de los datos en Convex, no del reloj del generador: la misma instantánea con los mismos límites de barrio da siempre el mismo fichero. Con los 1318 emplazamientos de la caja de Barcelona y los 73 barrios pesa 67,2 KB, 17,8 KB con gzip, con el formato 4 (el 3 pesaba 61,9 y 16,5; el 1, 54,8 y 13,5).

## Barrios

El generador de capas pone a cada emplazamiento su barrio, por punto en polígono, con los límites de Open Data BCN (conjunto `20170706-districtes-barris`, fichero `BarcelonaCiutat_Barris.json`, CC BY 4.0). La otra opción era mandar los polígonos al navegador y asignar allí. Los límites tienen 17.371 vértices y pesan unos 370 KB en JSON, seis veces la capa entera; la tabla de barrios y la columna nueva añaden 7 KB. Asignar en el generador también hace que el recuento de cada barrio salga de la misma versión que los marcadores sin más comprobaciones.

Un punto sobre el lado que comparten dos barrios cae en uno solo: los bordes de la prueba del rayo son semiabiertos. Si dos límites se solapan, gana el de código menor. No hay tolerancia: los emplazamientos que caen a 13 m de Barcelona tienen dirección de L'Hospitalet, y así se quedan.

Los límites se descargan con `pnpm run barrios` en `tools/capas`, que escribe `convex/datos/barrios.json` con un barrio por línea, y ese fichero va en git. La publicación lo lleva dentro de su acción de Convex, y `publicar` de `tools/capas` lo lee de disco. La descarga no es parte de la ingesta porque los límites cambian muy de tarde en tarde (la última fecha del fichero es del 12/11/2024) y así publicar una capa no depende de que responda el portal del Ayuntamiento. La orden comprueba que la licencia siga siendo CC BY 4.0 y guarda la fecha del recurso que da la API del portal. El `robots.txt` del portal prohíbe a los rastreadores `/data/api*` y `/resources/*`, que es de donde sale el fichero; la orden la lanza una persona, hace dos peticiones con los 10 s de su `Crawl-delay` y se presenta con un `User-Agent` de Celda.

En el navegador, `resumirBarrios` (`packages/dominio/src/barrio.ts`) cuenta los emplazamientos de cada barrio y sus ausencias: las compañías con algún emplazamiento en la capa y ninguno en el barrio. Una compañía que no aparece en toda la capa, como hoy Yoigo, no cuenta como ausente.

Fuera del municipio de Barcelona no hay barrios de Open Data BCN. Agrupar por municipio con el mismo aspecto sería engañoso: la caja de datos corta L'Hospitalet, Esplugues, Badalona o Sant Cugat, así que el número y las ausencias serían de un trozo del municipio. Esos emplazamientos siguen agrupados en hexágonos, sin ausencias, también en el nivel de barrios.

El crédito «Ajuntament de Barcelona (nov 2024, CC BY 4.0)» sale de la cabecera de la capa y se ve con los del mapa base en cuanto llega la capa.

## Fichas

La publicación genera, junto a la capa y con su misma versión, la ficha de cada emplazamiento de la capa, en lotes: `fichas@2026-09-26T02:15:03Z/0.json`, `…/1.json`. Cada lote lleva la versión como primera clave, su número y sus fichas ordenadas por clave, y no cambia nunca. Los lotes juntan emplazamientos vecinos: se ordenan por su posición a lo largo de una curva de Hilbert que recorre el mundo (celdas de unos 40 m) y se cortan cada 128 (`packages/dominio/src/lotes.ts`). Así un barrio de Barcelona cae en 1,7 lotes de media y 4 como mucho, y abrir fichas cercanas o hacer el ejercicio de una zona pide muy pocos ficheros.

La granularidad sale de medir las 1318 fichas reales de Barcelona, con la exportación del 26/09. Tal como están hoy, con casi todas las bandas por leer, y con cinco bandas por estación base, que es lo que tendrán cuando la ingesta haya leído todas las fichas del registro:

| Fichas por fichero | Ficheros en Barcelona | Media con gzip (hoy) | Media con gzip (con bandas) | Mayor con gzip (con bandas) | Ficheros para toda España |
|---|---|---|---|---|---|
| 1 | 1318 | 0,5 KB | 0,6 KB | 0,9 KB | ~100.000 |
| 64 | 21 | 4,4 KB | 5,1 KB | 5,8 KB | ~1.600 |
| 128 | 11 | 7,8 KB | 9,2 KB | 10,9 KB | ~800 |
| 256 | 6 | 13,7 KB | 16,2 KB | 20,9 KB | ~400 |
| todas | 1 | 79 KB | 94 KB | 94 KB | 1 (unos 7 MB) |

El JSON de las fichas se comprime muy bien (las claves y los enlaces se repiten), así que agrupar sale casi gratis en bytes y ahorra mucho en ficheros y peticiones. Un fichero por emplazamiento no cabe: toda España son unos 100.000 por versión, y la copia de Vercel admite 15.000 ficheros por subida (ADR 0010). Además cada ficha abierta sería una petición a la función de R2, que tiene una cuota diaria. Se eligen lotes de 128 porque el mayor, con bandas, se queda por debajo de la ventana inicial de TCP (unos 14 KB) y llega en un solo viaje; con 256 ya no. Con toda España son unos 800 ficheros y 190 MB sin comprimir por versión.

La web encuentra el lote de una ficha en la columna `lote` de la capa que dibuja el mapa, así que siempre lee la ficha de la misma versión. Un enlace directo a una ficha espera a esa capa. Cada lote leído se guarda durante la visita, y dos lecturas a la vez del mismo lote hacen una sola petición. Cuando el mapa se asienta con marcadores de emplazamiento sueltos a la vista, la web descarga ya sus lotes, como mucho dos (`LOTES_PRECARGADOS`, los que más marcadores tienen), para que tocar uno no espere a la red. De cerca, lo que se ve cae en uno o dos lotes; en Barcelona son once en total, así que una visita pide como mucho esos once (docs/patterns/rendimiento.md).

## Qué versión se carga

Lo único que cambia en el almacén es `vigente.json`: la versión, su fecha, cuántos emplazamientos y cuántos lotes tiene. La web lo lee primero, con caché corta, y luego la capa de esa versión. La publicación lo escribe el último, cuando la capa y todos sus lotes ya están, así que nunca apunta a algo a medias. Sin él, el mapa dice que todavía no hay ninguna capa publicada.

PMTiles se reserva para cuando la capa supere unos 20.000 emplazamientos (con 100.000, el JSON pesa 660 KB y tarda cerca de 1 s en indexarse), y para capas precalculadas grandes, como coberturas o simulaciones fuera de línea.

## Marca de agua por vista

Cada vista conoce la versión de su dato, y la de la capa se lee de la cabecera antes de pintar. Como la ficha sale del lote de la misma versión que la capa del mapa, lo normal es que su marca no sea posterior a la capa. Hay un caso en que sí puede serlo: la pestaña lleva abierta desde antes de otra publicación y el origen ya no tiene los lotes de la versión del mapa, porque se hayan borrado versiones viejas o porque la copia de reserva de Vercel solo guarda la vigente (ADR 0010). Entonces la web lee `vigente.json`, la capa nueva y la ficha de esa versión, y la ficha lo dice («actualizado después del mapa»). El marcador no se corrige a medias: el mapa se queda con su capa hasta que se recarga la página. Si el emplazamiento ya no está en la versión nueva, el panel dice que no existe.

El mapa base es OpenFreeMap con el estilo del tema, servido desde sus servidores.

## Consecuencias

- El mapa de una pestaña abierta no se actualiza solo: sigue con su capa hasta que se recarga. Si en ese tiempo el origen deja de tener sus fichas, el panel enseña las de la versión vigente y lo dice.
- Publicar escribe la capa, unos cuantos lotes y `vigente.json` en cada versión con cambios. Publicar sin cambios no escribe nada.
- La agrupación depende de `_getOriginZoom`, un detalle interno de supercluster. Se fija la versión exacta y una prueba cubre la transición.
- Si cambian los límites de barrio y no los datos, la capa de esa versión ya existe con otro contenido y la publicación falla con `FicheroInmutable` sin cambiar `vigente.json`. Hay que esperar a la siguiente ingesta que cambie algo. Lo mismo pasó al pasar del formato 1 al 2, y pasará con cada formato nuevo en un almacén que ya tenga la versión.
- OpenFreeMap está detrás de Cloudflare (lo comprobaron las exploraciones 03 y 05), así que durante un bloqueo de LaLiga también cae el mapa base. Un extracto propio de Barcelona ocuparía unos 24 MB. Lo recoge la decisión 10.
- Dónde se alojan la capa y las fichas lo fija el ADR 0010.
- Las cifras de móvil son simuladas y hay que confirmarlas en un teléfono real.
