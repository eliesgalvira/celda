# Límites de comunidades y provincias en un fichero propio, servido por la web

Estado: aceptada el 03/10/2026, con las decisiones del usuario del 02/10/2026. Sale del prototipo de la rama desechable `prototipo/mapa-base-ign` (2f5bb80, ajustada en 9d47710; veredicto en `PROTOTIPO.md`, e0b75de). Lo lleva a cabo el #65; ver «Cómo quedó». Revisada el 05/10/2026: un segundo fichero, más fino, para los zooms en que se trabaja, y el general se pide al arrancar (ver «Dos niveles»).

## Contexto

Con la paleta del ADR 0022 el mapa base enseña la frontera de España, pero no dónde acaba una comunidad o una provincia. Las zonas de Celda son provincias y municipios del IGN (ADR 0017), y de lejos los hexágonos de provincia flotan sin un borde que diga qué recogen. El usuario pidió que ningún zoom se quede sin límites.

Celda ya tiene en git los límites del IGN de los 8.132 municipios, partidos en arcos (`packages/publicacion/datos/municipios.json`, ADR 0017).

## Decisión

- **Un fichero estático propio con los límites de comunidades y provincias**, sacado sin red de `municipios.json` por una orden de `tools/capas`. Cada arco entre territorios de dos provincias distintas es límite de provincia y, si las comunidades también son distintas, de comunidad. La costa y la frontera con otros países no van: las pinta el mapa base. Los arcos seguidos del mismo tipo se encadenan antes de simplificar, así la simplificación no tiene que conservar cada punto donde se juntan tres municipios. Cada cadena va una sola vez, con su tipo, y se simplifica a 1 km.
- **Pesa 20.569 bytes, 8.179 con gzip.** Va en la web como recurso inmutable, con la huella en el nombre, y sale del mismo origen que la web (ADR 0018): nada de Cloudflare.
- **Se pide una vez, después del primer pintado completo** del mapa (el primer `idle` de MapLibre), y no retrasa ni el mapa base ni los marcadores. Desde el 05/10/2026 se pide al arrancar (ver «Dos niveles»).
- **Cómo se ven.** Los de comunidad, más gruesos y continuos; los de provincia, más finos y discontinuos. Se ven enteros hasta z11,5 y a un 60 % desde z12,5. Los límites municipales de OpenStreetMap (nivel 8 de OpenFreeMap) entran de z10,5 a z11,2. Así, de z5 a z14 siempre hay algún límite a la vista.
- **Con la foto aérea encendida** (ADR 0022), las tres clases de límite van en blanco sobre la foto.

## Cómo quedó (#65)

- **La orden** es `pnpm run limites` en `tools/capas` (`src/limites.ts`), y escribe `apps/web/src/mapa/limites.json`. La comunidad de cada provincia sale de la tabla del INE de `packages/dominio/src/barrido.ts`. Un arco que solo usa un recinto con provincia (la costa, la frontera, el borde con Gibraltar o la isla de los Faisanes) no va. Las cadenas se cortan donde se juntan tres límites o uno de provincia con uno de comunidad.
- **El fichero** lleva la fuente del IGN, la tolerancia, las unidades (milésimas de grado) y dos listas de líneas en diferencias, `comunidades` y `provincias`, con el formato `LimitesDeComunidadesYProvincias` de `packages/dominio/src/limites.ts`. Son 79 líneas de comunidad y 68 de provincia: 19.811 bytes, 8.021 con `gzip -9`, sin los puntos de las provincias que llevaba el del prototipo. `limitesReal.test.ts` comprueba que está al día, el tipo de once vecindades conocidas, que ningún tramo sale dos veces y que no pasa de 22.600 bytes ni de 9.000 con gzip.
- **La carga.** `mapaBase.ts` importa el fichero con `?url`, así que Vite lo deja en `assets/` con la huella en el nombre y `vercel.json` le da la caché inmutable. Lo pide tras el primer `idle` y lo guarda para la visita (`apps/web/src/mapa/limites.ts`): si el mapa se vuelve a crear, recibe las mismas líneas sin pedir nada. Si falla, el siguiente mapa lo vuelve a pedir.
- **El país** no estaba en el mapa base de `celda/v1` y entra con el resto de los límites, del nivel 2 de OpenFreeMap.
- **Sobre la foto aérea** (#64) las cuatro clases van en blanco (`--mapa-foto-linea`), con `conFoto` en cada capa: el país entero, las comunidades al 95 % y las provincias al 80 % (al 70 % y al 55 % desde z12,5), y los municipios al 70 %. Las opacidades del prototipo, más bajas, apenas se leían sobre la foto de una ciudad.

## Dos niveles (05/10/2026)

El usuario vio que de z9 a z11 la línea se apartaba del límite real: entre Cuenca y València, junto a Utiel, el límite sigue el Cabriel y la línea a 1 km cortaba sus meandros con tramos rectos. Pidió que se ajustara más en los zooms en que se trabaja.

- **Un fichero de detalle** (`apps/web/src/mapa/limites-detalle.json`), con las mismas cadenas y los mismos tipos, simplificado a 150 m y en diezmilésimas de grado. Lo escribe la misma orden, `pnpm run limites`, junto al general (`LIMITES_DE_DETALLE` en `tools/capas/src/limites.ts`), y se sirve igual: mismo origen, huella en el nombre, caché inmutable.
- **Se midieron tres tolerancias** contra las líneas del IGN de `municipios.json` (50 m), en Utiel y en el Ebro entre La Rioja y Navarra, a z10 y z11:

| Tolerancia | Bytes | Con `gzip -9` | Vértices | A z11 |
|---|---|---|---|---|
| 1 km (el general) | 19.811 | 8.043 | 2.731 | corta los meandros |
| 200 m | 77.458 | 31.121 | 10.079 | sobre la del IGN |
| 150 m | 92.885 | 36.718 | 12.471 | sobre la del IGN |
| 100 m | 120.098 | 46.274 | 16.780 | sobre la del IGN |

  A z10 y z11 las tres finas van sobre la del IGN; a z11 un píxel son unos 30 m, así que 150 m son 5 px como mucho. Se eligió 150 m: a z12, donde las líneas aún se ven al 60 %, se separa menos que la de 200 m, y pesa 10 KB menos que la de 100 m. En cincomilésimas de grado pesaba 4 KB menos, pero al redondear una línea volvía sobre sí misma.
- **Se pide la primera vez que el mapa pasa de z7** (`ZOOM_DEL_DETALLE` en `apps/web/src/mapa/limites.ts`) y sustituye al general en la misma fuente con `setData`: no hay dos capas a la vez, así que no salen líneas dobles ni parpadeo. Una vez puesto, el general no lo pisa aunque llegue tarde, y alejarse no vuelve al general.
- **El general se pide al arrancar**, con un `preload` en `precarga.ts` y otra vez al cargarse el código del mapa, que reutiliza la respuesta. Se dibuja con la silueta de España (`packages/ui/src/mapa/silueta.ts`) en cuanto el estilo lo admite, antes que el mapa base, también mientras se espera a la reserva del IGN.
- `limitesReal.test.ts` comprueba que el fichero de detalle está al día, que no pasa de 102.000 bytes ni de 40.500 con gzip, que ningún tramo sale dos veces y que cada vértice del IGN de los límites que siguen el Cabriel, el Ebro y el Tajo en Aranjuez queda a menos de 170 m de la línea.

## Consecuencias

- Los límites son los mismos con que Celda asigna cada emplazamiento a su municipio y su provincia, y de los que sale el centro visual de cada provincia (ADR 0024). Un hexágono de provincia no cae al otro lado de la línea que la cierra.
- A 1 km de tolerancia, de cerca la línea se separa del límite real. Desde el 05/10/2026 eso solo pasa por debajo de z7, donde no se nota: más cerca va el fichero de 150 m. Desde z12,5 las líneas bajan al 60 % y mandan los límites municipales de OpenStreetMap, que van a su escala.
- Quien pasa de z7 descarga 37 KB más con gzip, una vez por visita.
- Si cambian los límites del IGN, se vuelve a sacar el fichero con su orden, como los contornos del ejercicio (`zonas`, ADR 0017). La huella cambia y la caché del navegador no sirve uno viejo.
- La reserva del IGN (#60) usa el mismo fichero, porque sale del origen de Celda.

## Alternativas descartadas

- **Comarcas.** No son uniformes en España: hay comunidades sin comarcas oficiales y otras que las definen de forma distinta. En Cataluña se podrían añadir más adelante de z8 a z10 con los límites del ICGC.
