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
- **Mapa base.** El rótulo es el `name` de OpenStreetMap. Si lleva «/», dentro de la Comunitat la parte que no es `name:es`, y fuera `name:es`, o la primera parte si no hay `name:es`. Los 177 `name` con «/» de las teselas z8-z10 de España tienen `name:es`, y siempre es una de sus partes. Un lugar en letra no latina (Marruecos, Argelia: «Tanger ⵟⴰⵏⵊⴰ طنجة») lleva `name:es` o `name:latin`. Una tabla de excepciones cubre los lugares en que OpenStreetMap y el INE no coinciden; hoy solo «Peñacerrada / Urizaharra», que el INE escribe con guion.
- **Buscador.** Sigue con `accept-language=und` (ADR 0013) y añade `namedetails=1` en la misma petición, sin otra más, para tener el `name:es` de cada resultado. Aplica la misma regla por la posición del resultado: primero la tabla de bilingües del INE y de OpenStreetMap y, si el par no está, el `name:es`. «Donostia / San Sebastián» da San Sebastián, «Alacant / Alicante» da Alacant y la plaza «Konstituzio Plaza / Plaza de la Constitución» da su `name:es`.

Los datos, para quien implemente: el contorno de la Comunitat pesa 9.490 bytes, 3.525 con gzip, y las tablas de nombres, población y centros del prototipo, 21.898 bytes, 8.783 con gzip. Los guiones que las sacaron están en la rama, en `tools/capas/scripts/PROTOTIPO-nombres/`.

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
