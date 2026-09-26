# Fusión: observaciones a 15 m o menos, de cualquier compañía

Estado: aceptada el 26/09/2026. Sustituye la regla de fusión del ADR 0009 («mismo operador a menos de 60 m»). Ampliada el mismo día con la unión por código (al final).

## Contexto

La arquitectura juntaba en un emplazamiento las observaciones de una misma compañía a menos de 60 m. La investigación de fuentes comunitarias ya avisó de que en Barcelona esa regla funde estaciones que el registro separa. La descarga real del registro oficial del 26/09/2026 (caja de Barcelona, 2380 registros, 1391 puntos distintos) lo confirma y da con qué sustituirla:

- 1318 de los 2380 registros tienen otra compañía exactamente en el mismo punto. Un emplazamiento compartido casi siempre se publica con las mismas coordenadas.
- Del resto, la distancia a la compañía más cercana se reparte así: 5 a 1 m o menos, 24 entre 1 y 5 m, 14 entre 5 y 10 m, 51 entre 10 y 15 m, 20 entre 15 y 20 m y 29 entre 20 y 30 m. El salto entre 10 y 15 m son azoteas compartidas con coordenadas de esquinas distintas.
- Dentro de una compañía, 93 pares de registros con códigos distintos están en el mismo punto (los `647`, `00647`, `000647` de Vodafone, y también Movistar `0807565` y `0807566`). Entre 1 y 15 m solo hay 5 pares más; a 60 m ya son 74.
- El mismo código sin ceros a la izquierda no es el mismo sitio: Vodafone `3248` y `003248` están a 4 km, y hay 43 casos así en la caja.
- Uniendo en cadena a 60 m salen grupos de hasta 167 m de diámetro. A 15 m el mayor mide 18 m.
- antenasmoviles.es parece juntar a unos 15 m: la distancia mínima entre dos de sus marcadores de Barcelona es de 17,5 m.

| Radio | Emplazamientos (caja) | Emplazamientos (municipio) | Estaciones base (municipio) | Pares de una compañía con otro código juntados |
|---|---|---|---|---|
| 0,5 m | 1385 | 1072 | 1527 | 0 |
| 15 m | 1318 | 1022 | 1506 | 5 |
| 20 m | 1302 | 1010 | 1500 | 8 |
| 60 m | 1176 | 898 | 1435 | 74 |

## Decisión

- Dos observaciones `presente` a 15 m o menos, sean de la compañía que sean, están en el mismo emplazamiento. La cercanía se encadena.
- Un emplazamiento tiene una estación base por compañía, como dice el glosario. Si una compañía tiene varios registros en él, la estación base guarda todos sus códigos y la unión de sus bandas.
- La clave del emplazamiento es la compañía y el código exacto de su registro de menor clave en el registro oficial, por ejemplo `movistar-0802532`. Sin ceros quitados, porque `3248` y `003248` son sitios distintos. Si dos emplazamientos acabaran con la misma clave, el segundo lleva `-2`.
- Conflictos que se muestran: la comunidad da por desmontada una estación base del registro; fuentes distintas dan códigos distintos a la misma estación base; el mismo código exacto de una compañía aparece en dos emplazamientos.
- Estado: `nuevo` si el registro oficial no está entre sus observaciones; `corregido` si la comunidad da una estación por desmontada o añade una compañía que el registro no tiene allí; `verificado` en el resto de casos, también cuando solo lo conoce el registro.
- Confianza: `baja` con conflictos, `alta` si lo confirman dos fuentes o más y `media` si solo lo conoce una. Mientras solo esté el registro oficial, todo es `verificado` con confianza `media`.
- El radio vive en `REGLA_FUSION` (`packages/dominio/src/fusion.ts`). Cambiarlo es un commit que actualiza los resultados de referencia de las pruebas; después se aplica con la acción interna `ingesta:recalcularFusion`, que no pide nada a las fuentes.

## Consecuencias

- Con la descarga del 26/09/2026 salen 1318 emplazamientos y 1992 estaciones base en la caja de Barcelona. En el municipio son 1022 emplazamientos y 1506 estaciones base (Movistar 680, Orange 404, Vodafone 398, Digi 24).
- «Verificado» con una sola fuente es verdad por omisión: nadie lo contradice porque aún no hay nadie más. La confianza `media` lo deja ver.
- Las observaciones de la comunidad sin coordenadas propias fiables (ER5, OpenCelliD) tendrán que ajustar la regla cuando lleguen, con un radio propio o uniendo por código como propone la investigación de fuentes comunitarias.
- Fuera de la ciudad 15 m puede quedarse corto. Si Celda sale de Barcelona hay que repetir este análisis.

## Ampliación: unión por código con la comunidad (26/09/2026, ticket 18)

antenasmoviles.es copia el registro oficial y publica cada estación con el código de emplazamiento del registro (investigación de fuentes comunitarias, apartado 3). Sus coordenadas no tienen por qué coincidir con las del registro: las copia en una fecha y el registro puede moverlas después. Si solo se juntara por distancia, una estación que la comunidad da por desmontada y que el registro ha movido más de 15 m no llegaría a su emplazamiento, y la corrección se perdería.

- Una observación de otra fuente con la compañía y el código exacto de una del registro oficial va al emplazamiento de esa, esté donde esté. Sin quitar ceros, por lo mismo que la clave.
- Si están a más de 15 m, el emplazamiento lleva un conflicto `posicion-distinta` con la distancia. La posición sigue siendo la del registro.
- Una observación `desmontada` busca primero la del registro con su código. Si no la hay, va como antes a la más cercana de su compañía dentro del radio.
- Las ER5 no tienen código del registro y se siguen juntando por distancia. Una ER5 a 15 m o menos de una estación del registro de su misma compañía da `codigos-distintos`, que puede ser un duplicado. Si es de otra compañía, el emplazamiento queda `corregido`.
- Cambia un caso de las pruebas: el mismo código en el registro y en la comunidad a 800 m ya no son dos emplazamientos con conflicto, sino uno con conflicto. El mismo código repetido dentro del registro sigue dando dos.

Con la descarga del 26/09/2026 (registro de la caja de Barcelona y las 40 ER5 con compañía) salen 1354 emplazamientos: 1317 verificados, 36 nuevos y 1 corregido, sin conflictos.
