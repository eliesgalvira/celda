# Barrido del registro oficial por zonas, en siete noches, y fichas a una cada 5 s

Estado: propuesta (28/09/2026). Sale de la investigación de la ampliación a toda España (`docs/investigacion/espana.md`, apartado 1). Cambia el barrido del glosario y el ritmo del ADR 0009 y de la investigación del registro.

## Contexto

En la caja de Barcelona, una ejecución lee el listado entero con 5 peticiones y hasta 250 fichas. En toda España el registro tiene unos 69.700 registros (estimado con la densidad de antenasmoviles.es y confirmado en ocho cajas con 60 peticiones reales, un 0,7 % por encima de lo previsto). Una pasada completa del listado son unas 215 peticiones y 43 MB sin comprimir, porque el geoportal no comprime. Las fichas son una por registro, y a 250 por noche la primera pasada tarda 279 noches.

Hoy un barrido es la lectura completa del listado, y una observación que falta en dos barridos seguidos se retira.

## Decisión

- **Zonas de barrido.** El listado se recorre desde una rejilla fija de celdas de 1°, solo las que tienen algún registro o algún marcador de antenasmoviles.es (87 hoy). Cada celda guarda sus hojas, las cajas en que se dividió la última vez. La pasada siguiente pide las hojas y solo divide la que llegue a 1000.
- **Siete noches.** Las celdas se reparten en siete grupos de unos 10.000 registros, agrupados por provincias para que se entiendan. Cada noche se barre un grupo: unas 31 peticiones y 6 MB, con una petición cada 3 s como hoy.
- **Barrido por zona.** La zona de una observación es la celda en la que cae. El barrido de un grupo solo cuenta ausencias a las observaciones de sus celdas. Una observación que falta en dos barridos seguidos de su zona se retira, así que retirar tarda dos semanas.
- **Fichas.** Una cada 5 s, en una ventana nocturna de 4 horas, unas 2.440 por noche. Primero las nuevas y las de listado cambiado; después, una rotación de 30 días. Hasta tener respuesta del ministerio se queda en 250 por noche.
- Todo lo demás del extractor sigue igual: `User-Agent`, `robots.txt`, reintentos, interruptor y parada tras tres fallos seguidos.

## Condición

Antes de pasar de 250 fichas por noche hay que escribir a `emisionesysalud@economia.gob.es`, el buzón de la página del servicio, explicando qué se pide, a qué ritmo, a qué hora y con qué `User-Agent`. Si el ministerio dice que no, se queda en 250 y la primera pasada tarda nueve meses.

## Consecuencias

- Una alta tarda hasta una semana en verse, y una baja, dos. Madrid y Barcelona pueden ir en todos los grupos por unas 30 peticiones más por noche.
- Hacen falta tipos nuevos en el dominio: la celda de barrido con sus hojas y el grupo de cada noche.
- La simulación del teselado (`muestras/espana/teselas.mjs`) sirve de prueba: con la densidad de `showf` reproduce las peticiones medidas en todas las cajas.

## Alternativas descartadas

- **Pasada completa cada noche.** 15 minutos y 43 MB diarios, 1,3 GB al mes, para un registro que cambia poco.
- **Provincias como unidad.** Sus cajas se solapan, así que el borde se pediría dos veces. Las provincias se usan para agrupar celdas, no para pedir.
- **Fichas a una cada 2 s.** La primera pasada bajaría de 29 a 14 noches, pero dobla la carga sobre un servicio cuya base de datos el ministerio se negó a dar en 2021.
