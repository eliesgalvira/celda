# Nombres de lugar: el oficial, en una sola forma

Estado: aceptada el 03/10/2026, con las decisiones del usuario del 03/10/2026. Sale del prototipo de la rama desechable `prototipo/mapa-base-ign`, que probó tres reglas antes de esta (9d47710, 54f3339, 944bdf8); la última está en e0b75de y en su `PROTOTIPO.md`. Amplía el párrafo de los topónimos del [ADR 0013](0013-busqueda-de-direcciones-con-nominatim.md). Lo lleva a cabo el #63.

## Contexto

Celda escribe nombres de lugar en muchos sitios: las cintas de las zonas, la cabecera, la ficha, el ejercicio, los rótulos del mapa base y los resultados del buscador. Hasta ahora cada uno salía de su fuente tal cual:

- el INE da los oficiales bilingües con barra: «Valencia/València», «Castellón/Castelló», «Donostia/San Sebastián»;
- OpenStreetMap, en `name`, el local, también con barra cuando hay dos («València», «Donostia / San Sebastián»);
- el buscador, con `accept-language=und`, el `name` de OpenStreetMap (ADR 0013).

Así salían en la misma pantalla dos Valencias y dos Castellón, y nombres largos con barra que no caben en una cinta. El usuario lo dijo así: «pon el nombre oficial. Lo que me molestaba era que hubiera dos Valencias, dos Castellón».

## Decisión

- **Se escribe el nombre oficial del IGN y del INE, en una sola forma.** Si es bilingüe («A/B»):
  - **en la Comunitat Valenciana, la forma local**: València, Alacant, Castelló, Elx, Sagunt, Alcoi;
  - **en el resto de España, la parte castellana**: Pamplona, San Sebastián, Álava, Mondragón, Burlada, Valle de Egüés.
- **Los oficiales de una sola forma no cambian**: Girona, Lleida, Bizkaia, Gipuzkoa, A Coruña, Ourense, Sardanyola del Vallès. **Tampoco los que llevan guion**, que son un solo nombre: Vitoria-Gasteiz, Estella-Lizarra y los demás, 11 en total.
- **Solo cambia lo que se ve.** Los códigos INE y los nombres oficiales con barra siguen en los datos; el ejercicio sigue buscando por el oficial.
- **«En la Comunitat Valenciana» se decide de dos maneras, que dan lo mismo:**
  - **Los nombres de Celda** (provincias, municipios, zonas, cabecera, cintas, ficha y ejercicio), por el código INE: provincias 03, 12 y 46. Hay una tabla con la forma visible de los 130 municipios «A/B» del INE y de las provincias bilingües.
  - **Los rótulos del mapa base y los resultados del buscador**, que no traen código INE, por su posición dentro del contorno de la Comunitat: la unión de los municipios del IGN de las tres provincias, Rincón de Ademuz incluido, simplificada a 400 m (504 vértices, 3,5 KB con gzip). Ningún lugar de OpenStreetMap de z8 a z10 ni ningún municipio del INE cambia de lado al simplificar.
- **Mapa base.** La regla es para los nombres de lugar: los rótulos de la capa `place` (ciudades, pueblos, aldeas y barrios). Las vías, el agua y los puntos de interés escriben su `name` entero. El rótulo de lugar es el `name` de OpenStreetMap. Si lleva «/», dentro de la Comunitat la parte que no es `name:es`, y fuera `name:es`, o la primera parte si no hay `name:es`. Los 177 `name` con «/» de las teselas z8-z10 de España tienen `name:es`, y siempre es una de sus partes. Un lugar en letra no latina (Marruecos, Argelia: «Tanger ⵟⴰⵏⵊⴰ طنجة») lleva `name:es` o `name:latin`. Una tabla de excepciones cubre los lugares en que OpenStreetMap y el INE no coinciden; hoy solo «Peñacerrada / Urizaharra», que el INE escribe con guion.
- **Buscador.** Sigue con `accept-language=und` (ADR 0013) y añade `namedetails=1` en la misma petición, sin otra más, para tener el `name:es` de cada resultado. Aplica la misma regla por la posición del resultado: primero la tabla de bilingües del INE y de OpenStreetMap y, si el par no está, el `name:es`. «Donostia / San Sebastián» da San Sebastián, «Alacant / Alicante» da Alacant y la plaza «Konstituzio Plaza / Plaza de la Constitución» da su `name:es`.

Los datos, para quien implemente: el contorno de la Comunitat pesa 9.490 bytes, 3.525 con gzip, y las tablas de nombres, población y centros del prototipo, 21.898 bytes, 8.783 con gzip. Los guiones que las sacaron están en la rama, en `tools/capas/scripts/PROTOTIPO-nombres/`.

## Cómo quedó en el #63

- **La regla**, en `packages/dominio/src/nombreDeLugar.ts`, como funciones puras: `nombreDeLugarDeProvincia` y `nombreDeLugarDeMunicipio` por el código INE, `nombreDelMapaBase` para un lugar de OpenStreetMap y `nombreDeResultado` para el buscador. Un nombre es bilingüe si lleva una barra entre dos formas; los de guion pasan tal cual. Un bilingüe que la tabla no tiene, o cuyo oficial cambió, sale en su primera forma: nunca en las dos.
- **La tabla** (`packages/dominio/datos/nombres-de-lugar.json`) la escribe `pnpm run nombres` en `tools/capas`, sin red, desde `municipios.json`: 4 provincias y 130 municipios, con su oficial y su nombre de lugar. Qué forma es la castellana no lo dice ningún dato oficial: va a mano en `tools/capas/src/formasCastellanas.ts`, con las del prototipo (54f3339). La orden falla si un oficial bilingüe nuevo no la tiene, si no es una de sus dos partes o si sobra alguna. Pesa 9.030 bytes, 2.818 con gzip.
- **El contorno** (`packages/dominio/datos/comunitat-valenciana.json`) lo escribe la misma orden con la unión de los recintos de las tres provincias, como el contorno de España (ADR 0024): 2 polígonos, el principal y el Rincón de Ademuz, y 506 vértices, 9.303 bytes, 3.396 con gzip. `nombresReales.test.ts` comprueba que la tabla y el contorno están al día, que ningún municipio del IGN cambia de lado al simplificar y que tampoco lo hacen 22 lugares a los dos lados del límite (Vinaròs y Alcanar, Villena y Caudete, Pilar de la Horadada y San Pedro del Pinatar…).
- **Lo que se ve de Celda.** La web pasa al nombre de lugar lo que lee: el resumen nacional (`resumenConNombresDeLugar`, en `descargarResumen`) y la capa de cada provincia (`capaConNombresDeLugar`, en el Worker que la indexa). La cabecera (`lugarDeLaVista`), la ficha (`lugarDe`) y el ejercicio lo hacen al escribir, porque leen el índice de zonas y los lotes, que guardan el oficial. La publicación no usa nada de esto: rehace el resumen con lo que lee, y lo publicado sigue con el oficial.
- **El ejercicio** busca por el nombre de lugar y por el oficial: «Elche» y «Elx» dan Elx. Un enlace `?ejercicio=<código>` abre la misma zona, porque va por el código.
- **El mapa base.** La expresión del nombre (`nombreDelRotulo`, `packages/ui/src/mapa/nombres.ts`) va solo en los rótulos de lugar, los de la capa `place`: las seis capas de lugares y los barrios. Las calles, las avenidas, el agua, los puntos de interés y los aeropuertos escriben su `name` entero, porque en ellos la barra puede ir dentro del nombre: «Carretera Pamplona / Iruña - Tudela» sale entera, y una prueba lo comprueba. El filtro que quita el rótulo de un municipio que es zona compara lo que escribe esa expresión, así que «Donostia / San Sebastián» se quita con la zona San Sebastián. `nombres.test.ts` evalúa la expresión con la especificación de estilos de MapLibre y el contorno de verdad, y comprueba que da lo mismo que `nombreDelMapaBase` en 17 lugares. El estilo recibe el contorno de `mapaBase.ts`, como el de España.
- **El buscador** pide `namedetails=1` en la misma petición. El nombre del resultado usa su `name:es`; las partes de la dirección no lo traen y usan la tabla o su primera forma. El número de portal no cambia. El contorno se descarga con la primera respuesta (`import()`), en su propio trozo de 3,6 KB con gzip, y se queda para las demás. Las pruebas usan las respuestas de Nominatim del 03/10/2026 para «alicante» y «donostia».
- **Pesos.** La primera pantalla crece 4,7 KB con gzip (`gzip -9`, 211.431 → 216.158 bytes): la tabla, la regla y el buscador. El Worker de la capa, 3,4 KB, por la tabla. El trozo del mapa no cambia, y el contorno va aparte. Para que no arrastre nada, `comunitatValenciana.ts` solo importa `poligono.ts`, que no depende de nada; con `barrio.ts` la web partía en otro trozo lo que comparte con la primera pantalla, y abrir costaba 7,1 KB.
- **En el navegador**, contra la build y una España sintética de 100.000 emplazamientos (04/10/2026): de z5 a z14 sobre València, Alacant, Castelló, Navarra y el País Vasco, 50 vistas, ningún rótulo de lugar, cinta ni cabecera lleva «/». Los lugares con barra en OpenStreetMap salen en una forma: Alacant, Elx, Sagunt, Xàbia, Pamplona, San Sebastián, Mondragón, Llodio, Gijón, Oviedo… El quieto de 20 s tras moverse da 0 peticiones, 0 `render` y 0 llamadas a fetch, XHR, `requestAnimationFrame`, `setTimeout`, `setInterval` y `postMessage`.
- **«Sardanyola del Vallès»**, que cita la decisión, el IGN lo escribe «Cerdanyola del Vallès», de una sola forma, y así sale.

## Consecuencias

- El nombre de una zona de Celda y el rótulo del mapa base del mismo sitio coinciden. Eso hace que funcione quitar el rótulo de un municipio que es zona (ADR 0017), que compara nombres. La cinta de una provincia y el rótulo de su capital sí salen los dos, en versalitas la primera y en caja normal el segundo (ADR 0024).
- El contorno de la Comunitat deja fuera los islotes de menos de 1 km², como Tabarca y las Columbretes. Un rótulo con «/» en ellos saldría en castellano.
- El buscador y el mapa escriben igual el mismo sitio.
- Una persona que busque «Alicante» encuentra Alacant: Nominatim busca en todos los nombres del lugar, no solo en el que Celda enseña.
- Si el INE cambia un nombre oficial, hay que volver a sacar las tablas con el padrón nuevo.

## Alternativas descartadas

- **Los exónimos castellanos en todas partes** (9d47710): Gerona, Lérida, Vizcaya, Orense, La Coruña. Cambiaban 738 municipios, y el `name:es` de OpenStreetMap trae formas en desuso como «Sardañola», «Seo de Urgel» o «Bagá». Además el buscador tenía que pedir `accept-language=es`, y lo que encontraba no coincidía con el mapa. El usuario lo revirtió en 54f3339.
- **La forma local en toda España** (944bdf8): Araba, Donostia, Iruña. Salían «Iruña», «Burlata» o «Arrasate», donde el nombre oficial también da Pamplona, Burlada y Mondragón. Se quedó solo para la Comunitat Valenciana en e0b75de.
- **Dejar los nombres con barra.** Es lo que da dos Valencias en la misma pantalla, y no cabe en una cinta.
