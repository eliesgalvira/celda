# Barrido del registro oficial por zonas: Cataluña primero, luego toda España, y fichas a una cada 3 s

Estado: propuesta (28/09/2026), con las decisiones del usuario del mismo día. Sale de la investigación de la ampliación a toda España (`docs/investigacion/espana.md`, apartado 1). Cambia el barrido del glosario y el ritmo del ADR 0009 y de la investigación del registro.

## Contexto

En la caja de Barcelona, una ejecución lee el listado entero con 5 peticiones y hasta 250 fichas. En toda España el registro tiene unos 69.700 registros. La cifra es una estimación con la densidad de antenasmoviles.es, confirmada en ocho cajas con 60 peticiones reales: salieron un 0,7 % más registros de los previstos. Una pasada completa del listado son unas 215 peticiones y 43 MB sin comprimir, porque el geoportal no comprime. Hay una ficha por registro.

Cataluña son unos 9.000 registros, y Barcelona provincia unos 5.500 (estimado). Su listado cabe en 9 celdas de 1°: 37 peticiones, 6 MB y unos 2,5 minutos a una cada 3 s.

Hoy un barrido es la lectura completa del listado, y una observación que falta en dos barridos seguidos se retira.

## Decisión

- **Zonas de barrido.** El listado se recorre desde una rejilla fija de celdas de 1°: solo las que tienen algún registro o algún marcador de antenasmoviles.es, 87 en toda España. Cada celda guarda las cajas en que se dividió la última vez. La pasada siguiente pide esas cajas directamente y solo divide la que llegue a 1000.
- **Grupos de celdas.** Las celdas se agrupan por provincias en grupos con nombre. Cuáles se barren y cada cuánto lo dice la configuración del servicio (ADR 0015), no el código.
- **Cataluña primero.** La primera zona es Cataluña, entera en una sola noche. Toda España llega después, cuando Cataluña haya publicado bien unas semanas. Para España propongo por defecto siete grupos de unos 10.000 registros, uno por noche: unas 31 peticiones y 6 MB cada noche. Barrerla entera cada noche son 15 minutos y 43 MB, y la configuración lo permite.
- **Barrido por zona.** La zona de una observación es la celda en la que cae. El barrido de un grupo solo cuenta ausencias a las observaciones de sus celdas. Una observación que falta en dos barridos seguidos de su zona se retira. Con siete grupos, retirar tarda dos semanas.
- **Listado a una petición cada 3 s**, como hoy.
- **Fichas a una cada 3 s por defecto**, configurable. Se leen dentro de una ventana nocturna configurable, de 6 horas por defecto, unas 5.500 por noche. El orden es Barcelona provincia, el resto de Cataluña y después el resto de España. Dentro de cada zona van primero las nuevas y las de listado cambiado, y luego una rotación de 30 días. Con esos valores, Barcelona provincia tarda una noche, Cataluña dos y España entera unas trece (estimado).
- Todo lo demás del extractor sigue igual: `User-Agent`, `robots.txt`, reintentos, interruptor y parada tras tres fallos seguidos.

## Correos antes de publicar

El usuario decidió que los correos al ministerio (`emisionesysalud@economia.gob.es`) y a antenasmoviles.es se envían antes de publicar Celda, y que no bloquean el trabajo. Una ficha cada 3 s son unas 5.500 peticiones por noche, frente a las 250 de hoy, a un servicio que el ministerio describe como solo informativo. Si el ministerio pide menos, basta con cambiar el ritmo en la configuración.

## Consecuencias

- Una alta tarda en verse lo que tarda en volver a barrerse su grupo: una noche en Cataluña, hasta una semana en el resto con siete grupos.
- Hacen falta tipos nuevos en el dominio: la celda de barrido con sus cajas y el grupo con su nombre.
- La simulación del teselado (`muestras/espana/teselas.mjs`) sirve de referencia: con la densidad de `showf` reproduce las peticiones medidas en todas las cajas.

## Alternativas descartadas

- **Provincias como unidad de petición.** Sus cajas se solapan, así que el borde se pediría dos veces. Las provincias se usan para agrupar celdas, no para pedir.
- **Fichas a una cada 5 s**, la propuesta de la investigación. El usuario prefirió 3 s, el mínimo que ya impone el extractor.
- **Esperar la respuesta del ministerio antes de subir el ritmo.** El usuario la deja para antes de publicar.

## Cómo quedó el listado (ticket 40, 29/09/2026)

- Los cuadros de 1° con datos son 94, no 87: los que tienen algún marcador de antenasmoviles.es el 28/09. El glosario los llama cuadros, porque «celda» ya es la de un emplazamiento, y a los grupos, zonas de barrido.
- Hay siete zonas de barrido por comunidades (`ZONAS_DE_BARRIDO` en `packages/dominio/src/barrido.ts`). Un cuadro va a la comunidad con más registros previstos en él, salvo los que tocan Cataluña, que van a Cataluña para barrerla entera. Por eso la zona de Cataluña trae también el norte de Castelló y el este de Aragón.
- La configuración dice las zonas de cada noche (`CELDA_REGISTRO_ZONAS`, Cataluña por defecto) y las que se turnan (`CELDA_REGISTRO_ZONAS_EN_TURNO` y `CELDA_REGISTRO_ZONAS_POR_NOCHE`).
- Un cuadro se divide como mucho ocho veces. Si una caja sigue en el tope, el barrido de su zona falla.
- La protección contra un listado vacío pasa a ser por cuadro: un cuadro que vuelve vacío con estaciones vigentes hace fallar el barrido de su zona.
- Las ausencias se cuentan al cerrar el barrido, a las observaciones de sus cuadros que ningún listado ha traído desde que empezó. Los barridos de una noche se cierran cuando han acabado todos.
- La primera pasada real de Cataluña hizo 37 peticiones de listado y trajo 10.305 registros (investigación 08).

## antenasmoviles.es por zonas (ticket 48, 29/09/2026)

La ingesta nocturna lee antenasmoviles.es con las mismas zonas de barrido. Sigue la propuesta de la investigación 08, apartado 5.

- `showf` una vez por noche. Se guardan los marcadores de los cuadros de las zonas configuradas, que por defecto son las del registro, las de cada noche y las que se turnan.
- Detalle solo de las ER5 nuevas o cambiadas en el listado, primero las que no dicen su compañía, 100 por noche y a una petición cada 5 s. No hay repaso de las leídas ni se lee el detalle de los marcadores que copian el registro, así que la nocturna no ve las fotos de desmontaje. Convex sí las lee mientras siga (#51).
- La zona de un marcador es la del cuadro en que cae. Uno que falta en dos barridos seguidos de su zona se retira con sus observaciones, y una zona que vuelve vacía cuando tenía marcadores falla sin contar ausencias.
- El interruptor sigue apagado por defecto, en el programa y en el módulo de NixOS.

## Cómo quedaron las fichas (ticket 41, 29/09/2026)

- La ventana cuenta desde que empieza la noche, no desde la primera ficha. Así una noche nunca dura más que la ventana, la publicación y la copia, y el tiempo máximo del servicio se deduce de ella: ventana, la hora de espera antes de repetir una publicación y una hora más.
- El ritmo es la pausa entre el final de una ficha y la petición de la siguiente, como la del listado. Con 3 s y un geoportal que tarda casi un segundo salen unas 5.500 fichas en 6 horas; una prueba con respuestas de 0,9 s lo comprueba.
- La prioridad es una lista de provincias por código INE (`08` por defecto), sacada de los límites del IGN. Detrás van las zonas de barrido en el orden de la configuración y al final lo que no cae en ninguna. Así Barcelona provincia va primero sin crear una zona de barrido solo para ella.
- La relectura pasa de 14 a 30 días.
- La cola no es una tabla aparte: sale de las observaciones cada noche, y cada ficha se guarda al leerla. Una ficha ilegible espera un día, el doble con cada fallo seguido, hasta 30. Así no bloquea la cabeza de la cola noche tras noche.
- Un 401 o un 403, o una página que no es una ficha del geoportal, paran las fichas en el acto, sin reintentos. Tres fallos seguidos también.
- A mitad de la ventana se fusiona y se publica una vez. Una noche con fichas publica dos versiones, y las ocho que se conservan cubren unas cuatro noches.
- La pasada real de comprobación, el 29/09/2026, leyó 20 fichas de la provincia de Barcelona en 62 s, al ritmo por defecto y con el `User-Agent` de la ingesta, sin ningún error. Dieron 40 bandas, dos por ficha: las primeras de la cola eran de Digi (1800 y 2100 MHz). El listado salió de la muestra grabada del 28/09, así que no hubo más peticiones.

## Toda España (ticket 50, 29/09/2026)

- **Por defecto, siete noches.** Las siete zonas se turnan, una por noche, en el orden de `ZONAS_DE_BARRIDO`, y Cataluña es la primera. Ninguna va todas las noches. En una base nueva, la primera semana barre Cataluña, `centro`, Andalucía, levante, norte, Ebro y Duero, y oeste y Canarias. Esto sustituye al «Cataluña cada noche» del ticket 40.
- **Por qué no todas cada noche.** Cabe: unas 215 peticiones y 15 minutos, dentro de una ventana de 6 horas. Pero son 43 MB por noche, casi tanto como las 5.500 fichas, para un registro que cambia poco de un día para otro. Con siete noches, una alta tarda hasta una semana en verse y una baja, dos, y las bandas ya se releen solo cada 30 días. Se cambia con la configuración: `CELDA_REGISTRO_ZONAS_POR_NOCHE=7` barre toda España cada noche, y `CELDA_REGISTRO_ZONAS=cataluna` deja Cataluña todas las noches y las demás por turnos (unas 61 peticiones, toda España en seis noches).
- **El tope del listado sube de 300 a 400.** La primera pasada de toda España en una sola noche son unas 250 peticiones y, con `robots.txt` y reintentos, 300 quedaba justo. Si el tope corta, las zonas que quedan pasan a la noche siguiente y esa noche no se leen fichas.
- **Prioridad de las fichas.** Por defecto, `08,17,25,43`: Barcelona provincia y luego el resto de Cataluña, como dice la decisión. Detrás van las zonas en el orden de la configuración. Con el `08` de antes, el norte de Castelló y el este de Aragón, que están en la zona de Cataluña, iban por delante de Girona.
- **Cobertura.** No cambia desde el #43: una provincia está cubierta cuando se han barrido todos los cuadros con datos que la tocan. Varias provincias tocan dos zonas (Madrid llega al cuadro de Somosierra, de la zona del Ebro y el Duero, y Toledo al de Extremadura), así que la primera semana hay provincias a medias hasta que pasan sus dos zonas.
- **La orden `estado`** dice, por zona de barrido de la configuración, la fecha de su último barrido completo y las fichas que le faltan, y qué zonas barre la noche siguiente.
- **Memoria.** Con 69.770 registros sintéticos, la noche más pesada cabe en 512 MB de montón de V8. Sin límite, el RSS llega a entre 1,1 y 2 GB, porque V8 tarda en recoger la basura de la publicación. Para no pasar de ahí, la fusión y la publicación leen la base de 2.000 en 2.000 filas.
- **Pasada real de la zona `centro`**, el 29/09/2026 de 01:07:52 a 01:10:08 UTC, con los valores por defecto del listado y sin fichas: 40 peticiones (`robots.txt` y 39 de listado), 12,0 MB, 12.528 registros (un 2,4 % más de los 12.230 previstos) y 24 cajas guardadas. Publicó 6.333 emplazamientos.

Las cifras y cómo se midieron están en la investigación 08, «Toda España en la ingesta nocturna».
