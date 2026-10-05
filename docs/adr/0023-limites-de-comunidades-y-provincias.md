# Límites de comunidades y provincias en un fichero propio, servido por la web

Estado: aceptada el 03/10/2026, con las decisiones del usuario del 02/10/2026. Sale del prototipo de la rama desechable `prototipo/mapa-base-ign` (2f5bb80, ajustada en 9d47710; veredicto en `PROTOTIPO.md`, e0b75de). Lo lleva a cabo el #65; ver «Cómo quedó». Revisada el 05/10/2026: un segundo fichero, más fino, para los zooms en que se trabaja, y el general se pide al arrancar (ver «Dos niveles»); y la frontera de España sale también de los datos del IGN (ver «La frontera de España»).

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

### Nada en el borde de España (05/10/2026)

Con dos capturas de producción (Badajoz, Huelva y Portugal a z9 y z10, y Badajoz–Mérida a z9) se pidió quitar de los dos ficheros todo arco del borde exterior: la frontera con Portugal, Francia, Andorra y Marruecos, y la costa. Se comprobó que ya no estaban. `tiposDeLimite` solo da tipo a un arco que usan territorios de dos provincias, y un arco del borde lo usa un solo recinto, así que no entra en ninguna cadena. De los 31.048 arcos de `municipios.json`, 5.807 son del borde, y ningún punto de ellos a más de 2 km de sus extremos queda a menos de 540 m de una línea de los ficheros (el más cercano, en la costa de Ondarroa, donde llega el límite entre Bizkaia y Gipuzkoa). En el Guadiana de Badajoz la línea más cercana queda a 24 km, junto a Irun a 1,8 km y en Ceuta no hay ninguna a menos de 30 km. Lo que se veía tosco eran las líneas interiores a 1 km junto a la frontera de OpenFreeMap, que va con todo su detalle; desde z7 las sustituye el fichero de 150 m.

- El borde lo dibujan la frontera del IGN en tierra (ver la sección siguiente) y la propia costa. Mientras carga el mapa base, la silueta de España es un relleno con su contorno, y no se dibuja como límite.
- `limitesReal.test.ts` lo comprueba en los dos ficheros: ningún arco del borde tiene tipo, ningún punto del borde lejos de un extremo queda a menos de 400 m de una línea, y en el Guadiana de Badajoz, en Irun y en Ceuta las líneas quedan a más de 20 km, 1,5 km y 30 km.
- Lo que faltaba era la frontera del Guadiana de Olivenza en la línea de país de OpenFreeMap (ver «La frontera de España»).

## La frontera de España (05/10/2026)

Al sur de Badajoz, por el Guadiana hasta el Alqueva y Mourão, no se pintaba ninguna frontera. El usuario lo dijo así: «la frontera de la provincia de Badajoz no existe en Portugal».

- **La causa.** Decodificadas las teselas de OpenFreeMap (`tippecanoe-decode`, capa `boundary`, del z5 al z11), el tramo del Guadiana entre el Caia y el Cuncos, el de Olivenza, viene con `admin_level=2` y `disputed=1`, sin `adm0_l` ni `adm0_r`, y el estilo quitaba las líneas disputadas. No es marítimo. Al decodificar salieron más huecos de la misma clase: la frontera de Melilla, parte de la de Ceuta y parte del Bidasoa vienen con `maritime=1`, que el estilo también quitaba, y Gibraltar viene como disputado.
- **Qué se descartó.** Pintar las líneas disputadas o marítimas de OpenFreeMap: con eso entraban las aguas territoriales, el mar de Alborán y las líneas disputadas de lejos (el Sáhara, Gibraltar), y en el estilo no se puede separar una línea marítima sobre un río de una en el mar.
- **Qué entró.** La frontera terrestre de España sale de los datos del IGN, con el mismo nivel de detalle que comunidades y provincias. La descarga masiva de la BDLJE trae las líneas de primer orden (`au_AdministrativeBoundary_1stOrder0.gml`, «líneas de frontera»), y cada una dice en su identificador qué hay al otro lado: 35 Portugal, 33 Francia, 37 Andorra, 21 Marruecos, y 97, 98 y 99, el Atlántico, el Mediterráneo y el Cantábrico. La tabla no está publicada; sale de dónde cae cada línea y la comprueban las pruebas. La orden nueva `pnpm run fronteras` guarda las terrestres en `packages/publicacion/datos/fronteras.json` (8 líneas, 20 m de tolerancia, 68.316 bytes, 27.791 con gzip, de la misma descarga que `municipios.json`). La orden `limites` toma del borde de los municipios (los arcos que usa un solo recinto) las rachas de vértices a menos de 100 m de esas líneas, con el centro de cada segmento también cerca, y las encadena y simplifica como las demás, en una lista nueva, `pais`. Se mira vértice a vértice porque Ceuta y Melilla son un solo arco con costa y frontera. En frontera los arcos quedan a menos de 70 m; la costa, a más de 200.
- **En el mapa.** `limites-pais` pinta la lista `pais` con el aspecto de antes. De OpenFreeMap queda `limites-paises`, las fronteras entre otros países, sin las que tienen España a un lado (`adm0_l` o `adm0_r`, que las teselas traen desde el z5; en el z4 no, y las dos líneas coinciden a menos de un píxel). En la reserva del IGN no hay `limites-paises`: su línea nacional era la misma frontera. Gibraltar sigue sin línea, como antes: el IGN no la tiene como frontera y OpenFreeMap la da por disputada.
- **Pesos.** El general pasa de 19.811 a 22.329 bytes, de 8.043 a 9.050 con `gzip -9`; el de detalle, de 92.885 a 106.418, de 36.718 a 42.357. Son 1.305 km con Portugal, 692 con Francia (con Llívia), 64 con Andorra y 18 con Marruecos.
- **Pruebas.** `limitesReal.test.ts` comprueba que las fronteras son de la misma descarga que los municipios y que su longitud por país es la esperada; que cada vértice de las fronteras del IGN queda a menos de 200 m (detalle) o 1.100 m (general) de la frontera dibujada, más de cien en el Guadiana de Olivenza; que cada vértice de la frontera dibujada va por una frontera del IGN, y que no sigue por la costa en Higuer, Isla Cristina, A Guarda ni los puertos de Ceuta y Melilla. `limites.test.ts` prueba con un anillo de costa y frontera que solo se toma la frontera.

## Consecuencias

- Los límites son los mismos con que Celda asigna cada emplazamiento a su municipio y su provincia, y de los que sale el centro visual de cada provincia (ADR 0024). Un hexágono de provincia no cae al otro lado de la línea que la cierra.
- A 1 km de tolerancia, de cerca la línea se separa del límite real. Desde el 05/10/2026 eso solo pasa por debajo de z7, donde no se nota: más cerca va el fichero de 150 m. Desde z12,5 las líneas bajan al 60 % y mandan los límites municipales de OpenStreetMap, que van a su escala.
- Quien pasa de z7 descarga 37 KB más con gzip, una vez por visita.
- Si cambian los límites del IGN, se vuelve a sacar el fichero con su orden, como los contornos del ejercicio (`zonas`, ADR 0017). La huella cambia y la caché del navegador no sirve uno viejo.
- La reserva del IGN (#60) usa el mismo fichero, porque sale del origen de Celda.

## Alternativas descartadas

- **Comarcas.** No son uniformes en España: hay comunidades sin comarcas oficiales y otras que las definen de forma distinta. En Cataluña se podrían añadir más adelante de z8 a z10 con los límites del ICGC.
