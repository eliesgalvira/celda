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
