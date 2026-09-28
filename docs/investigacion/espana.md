# Investigación 08 · Ampliación a toda España

Qué cambia al pasar de la caja de Barcelona a toda España, con cifras. Es un plan: no hay nada implementado. Las decisiones que salen de aquí están en los ADR 0014 a 0017, en estado «propuesta».

Consultas y medidas del 28/09/2026. Cada cifra lleva una de dos marcas:

- **medido**: sale de una respuesta real, de una medida en esta máquina o de una página oficial citada;
- **estimado**: sale de una cuenta sobre cifras medidas, y se explica cuál.

Peticiones hechas a las fuentes, todas con el `User-Agent` «Celda (investigación; contacto en celda.elies.site)»:

- Registro oficial: 61 peticiones, `robots.txt` (sigue dando 404) y 60 de listado, de 19:25 a 19:30 hora de Madrid, con 4 s entre el final de una respuesta y la siguiente. Ninguna ficha de detalle.
- antenasmoviles.es: una sola, `GET /v1/showf?er5`, la misma que hace cualquier visitante al abrir su mapa. Ningún `markers`.
- IGN, CNIG e INE: unas 25 peticiones a sus servicios de descarga (ATOM, WFS y la API de INEbase).
- Protomaps y OpenFreeMap: `pmtiles extract --dry-run`, que solo lee los directorios del archivo.

Los guiones y el registro de las peticiones al ministerio están en [`muestras/espana/`](muestras/espana/).

## Resumen

1. **El registro oficial tiene unos 69.700 registros en España** (estimado, con un error de ±2 %). Una pasada completa del listado son unas 250 peticiones la primera vez y unas 215 después, 43 MB sin comprimir y unos 15 minutos a una petición cada 3 s. Propongo repartirla en siete noches, unas 31 peticiones y 6 MB por noche.
2. **Las fichas de detalle son el cuello de botella.** Son unas 69.700. A 250 por noche, la primera pasada tarda 279 noches. A una cada 5 s en una ventana de 4 horas, 29 noches. Antes de subir de las 250 por noche actuales hay que escribir al ministerio.
3. **Convex gratuito no cabe con el código de hoy.** La ingesta y la publicación releen todas las tablas cada noche: unos 0,73 GB de E/S por noche y 22 GB al mes a escala España, frente a 1 GB gratis (estimado). Además, tres funciones pasan de los límites por transacción o de memoria. Recomiendo sacar la ingesta y la publicación de Convex a un trabajo programado que escriba en R2, y dejar Convex para las aportaciones compartidas.
4. **Toda España son unos 42.900 emplazamientos, no 100.000.** El ADR 0004 hizo sus cuentas con 100.000, 2,3 veces la cifra real. En el formato 4 la capa entera pesa 2,3 MB y 522 KB con gzip (medido). Recomiendo una capa por provincias con un resumen nacional y el índice en un Worker: en el móvil simulado abre con 20 KB, pinta en 410 ms y va a 55 fps al alejar hasta España, frente a 865 ms y 51 fps de la capa única (apartado 3).
5. **Los barrios tienen sustituto.** Provincias y municipios del IGN (CC BY 4.0) y el padrón del INE (CC BY 4.0) se cruzan sin fallos por código INE: 8.132 de 8.132 municipios.
6. **antenasmoviles.es ya da toda España en una llamada**: 42.855 marcadores, 7.285 de ellos ER5. Leer el detalle de todos a una petición cada 5 s son 62 horas. Con el tope de 100 por noche, 429 noches.
7. **Un mapa base propio de España ocupa 1,5 GB** hasta el zoom 14 (medido con `--dry-run`). Cabe en R2 pero no en Vercel, y R2 también está detrás de Cloudflare, así que no sirve de reserva ante los bloqueos de LaLiga.

## 1. Registro oficial en toda España

### Cuántos registros hay

El listado del registro corta en 1000 elementos sin avisar y no da ningún total. Para estimarlo sin barrer toda España usé antenasmoviles.es como mapa de densidad. Su FAQ dice que copia el registro a diario, y cada marcador de `showf` lleva los códigos de emplazamiento del registro que agrupa.

- **Densidad.** Cada marcador de `showf` que no es ER5 cuenta tantos registros como códigos distintos lleva, más uno si incluye a Digi, porque Digi publica los mismos códigos que Movistar. En toda España salen 35.570 marcadores, 67.325 códigos y 1.925 marcadores con Digi: **69.250 registros previstos**. Medido sobre la respuesta del 28/09.
- **Calibración en Barcelona.** En la caja de la investigación del registro salen 2.376 previstos; la descarga real del 26/09 dio 2.380.
- **Muestreo real del 28/09.** Recorrí ocho cajas de tipos distintos con la división en cuatro del extractor:

| Caja | Tipo | Registros previstos | Registros medidos | Peticiones previstas | Peticiones medidas |
|---|---|---|---|---|---|
| Soria (provincia) | rural | 624 | 624 | 1 | 1 |
| Lugo (provincia) | rural disperso | 1.003 | 1.003 | 5 | 5 |
| Tenerife | isla | 1.277 | 1.278 | 5 | 5 |
| Valladolid (provincia) | interior | 1.511 | 1.510 | 5 | 5 |
| Badajoz (provincia) | rural extenso | 1.619 | 1.701 | 5 | 5 |
| Navarra | mixta | 2.331 | 2.331 | 9 | 9 |
| Málaga (provincia) | costa | 2.900 | 2.940 | 13 | 13 |
| Madrid (municipio) | ciudad densa | 5.091 | 5.086 | 17 | 17 |
| **Total** | | **16.356** | **16.473** | **60** | **60** |

Los registros medidos son un 0,7 % más que los previstos, sobre todo por Badajoz (+5 %). Con esa corrección, **el registro tiene unos 69.700 registros en España** (estimado). Encaja con la cifra de «más de 69.000» que daba una fuente secundaria en la investigación del registro.

Por titular, en las ocho cajas: Telefónica 5.636, Vodafone 5.891 (4.776 como S.A.U. y 1.115 como S.A.), Orange 4.337, Digi 463 y Yoigo 146. Yoigo no salía en Barcelona y aquí aparece con dos razones sociales, `XFERA MÓVILES, S.A.U.` y `XFERA MOVILES, S.A.`. El normalizador ya acepta las dos.

### Cómo teselar

`teselas.mjs` simula la división en cuatro del extractor sobre la densidad de `showf` con el mismo tope de 1000. Reproduce las peticiones del muestreo una a una, y también las 5 de la caja de Barcelona y las 17 del AMB del 26/09.

| Punto de partida | Peticiones de la primera pasada | Teselas finales (hojas) | Profundidad máxima |
|---|---|---|---|
| Dos cajas: península con Baleares, y Canarias | 286 | 215 | 8 |
| Rejilla de 2° | 266 | 206 | 6 |
| Rejilla de 1°, 87 celdas con datos | 251 | 210 | 5 |
| Rejilla de 0,5° | 363 | 344 | 4 |

Todo estimado con la simulación. Con un tope algo más bajo, 900 en lugar de 1000, por si hubiera altas entre dos pasadas, salen 314 peticiones desde las dos cajas.

La rejilla de 1° es la que mejor sale, y además da teselas estables: una celda no depende de lo que haya en la de al lado. Propongo:

- Partir de las celdas de 1° que tienen algún registro o algún marcador de antenasmoviles.es, 87 hoy.
- Guardar las hojas de cada celda. Las pasadas siguientes piden directamente las hojas y solo dividen la que llegue a 1000. Así una pasada son unas 215 peticiones.
- No pedir las celdas de solo mar. Si un día aparece un registro en una celda nueva, lo verá antes antenasmoviles.es, y la celda se añade.

Una provincia como unidad de reparto tiene un inconveniente. Las cajas de dos provincias vecinas se solapan, así que se pedirían dos veces los registros del borde. Las celdas de la rejilla no se solapan.

### Cuánto pesa y cuánto tarda

Medido en las 60 peticiones de listado:

- 617 bytes por elemento, sin compresión. El servidor no comprime aunque se le pida.
- Respuesta media 1,04 s, mediana 0,87 s, percentil 95 2,3 s y máxima 3,8 s.
- 13 respuestas truncadas a 1000, 2 cajas vacías (`{}`) y ningún error.
- Siguen sin `ETag` ni `Last-Modified`.

Una pasada completa, estimado:

| | Peticiones | Datos | Tiempo a 1 petición cada 3 s |
|---|---|---|---|
| Primera pasada, rejilla de 1° | 251 | unos 68 MB (43 de hojas y 25 de las 41 respuestas truncadas) | 17 min |
| Pasadas siguientes, por hojas | unas 215 | unos 43 MB | 14,5 min |
| Una séptima parte cada noche | unas 31 | unos 6 MB | 2 min |

### Ritmo y reparto por noches

Hacer la pasada completa cada noche son 1,3 GB al mes sacados del geoportal en 15 minutos diarios. No es un abuso, pero tampoco hace falta: el registro cambia poco de un día para otro. Propongo **repartir la pasada en siete noches**:

- Las 87 celdas se reparten en siete grupos de unos 10.000 registros cada uno, siguiendo más o menos las provincias para que el mantenedor lo entienda («el lunes, Cataluña y Aragón»).
- Cada noche se barre un grupo: unas 31 peticiones, unos 6 MB y 2 minutos, con una petición cada 3 s como hoy.
- **El barrido pasa a ser por zona.** Hoy una observación que falta en dos barridos seguidos se retira, y un barrido es el listado entero. Con el reparto, el barrido de una zona solo cuenta ausencias a las observaciones de esa zona. La zona de una observación es la celda en la que cae. Si una estación se mueve de celda, la ve el barrido de la otra y la ausencia en la vieja no llega a contar. Retirar pasa a tardar dos semanas en lugar de dos noches.
- Las altas también tardan hasta una semana en verse. Si se quiere antes, las celdas de las ciudades grandes pueden ir en todos los grupos: Madrid y Barcelona juntas son unas 30 peticiones más por noche.

### Fichas de detalle

Hay una ficha por registro: unas 69.700 (estimado). Cada una es un HTML de 8 a 10 KB, así que una pasada completa son unos 630 MB. La pausa real entre dos fichas es la configurada más lo que tarda la respuesta, unos 0,9 s de mediana.

| Ritmo | Por noche | Primera pasada completa |
|---|---|---|
| 250 por noche, como hoy (1 cada 3 s) | 250, en 16 min | **279 noches** |
| 1 cada 5 s, ventana de 4 h | unas 2.440 | **29 noches** |
| 1 cada 5 s, sin parar | unas 14.600 al día | 4,8 días (114 h) |
| 1 cada 2 s, ventana de 4 h | unas 4.960 | **14 noches** |
| 1 cada 2 s, sin parar | unas 29.800 al día | 2,3 días (56 h) |

Todo estimado. Hoy el extractor no deja bajar de 3 s entre peticiones (`Math.max(pausaSegundos, 3)`), así que el ritmo de 2 s exige cambiar ese mínimo.

Mi propuesta es **una ficha cada 5 s en una ventana nocturna de 4 horas**. Van primero las de registros nuevos o con el listado cambiado, y luego una rotación de 30 días. La primera pasada tarda un mes, y después cada ficha se refresca una vez al mes. Es más lento que la rotación de 14 días de hoy, pero la ficha solo trae las bandas, y una estación base cambia de bandas pocas veces al año (estimado por los años de sus expedientes).

**Hay que escribir al ministerio antes de subir de las 250 fichas por noche.** Es otro orden de magnitud: de 250 a 2.440 peticiones por noche, y en total unos 630 MB al mes de un servicio que el ministerio describe como solo informativo y cuya base de datos se negó a dar en 2021 (investigación del registro, apartado 2). El buzón es `emisionesysalud@economia.gob.es`. El correo tiene que decir qué se pide, a qué ritmo, en qué horario y con qué `User-Agent`, y que hay un interruptor para parar. Si contestan que no, se queda en 250 por noche y la ficha dice que las bandas de muchos emplazamientos aún no se conocen, como ya hace. Esa decisión es del usuario.

### Fusión fuera de Barcelona

El ADR 0012 pedía repetir el análisis del radio de 15 m si Celda salía de Barcelona. Con los 16.473 registros del muestreo (`fusion-fuera.mjs`, medido):

| Caja | Registros | Con otra compañía en el mismo punto exacto | Emplazamientos a 15 m | Diámetro del mayor grupo a 15 m | A 60 m |
|---|---|---|---|---|---|
| Soria | 624 | 58 % | 382 | 14 m | 352 (156 m) |
| Lugo | 1.003 | 63 % | 583 | 15 m | 548 |
| Tenerife | 1.278 | 65 % | 630 | 15 m | 582 |
| Valladolid | 1.510 | 67 % | 825 | 17 m | 756 |
| Badajoz | 1.701 | 71 % | 841 | 14 m | 777 |
| Navarra | 2.331 | 65 % | 1.229 | 14 m | 1.130 |
| Málaga | 2.940 | 67 % | 1.512 | 23 m | 1.369 (107 m) |
| Madrid (municipio) | 5.086 | **16 %** | 2.893 | **28 m** | 2.366 (170 m) |

Fuera de las ciudades la regla funciona como en Barcelona: los emplazamientos compartidos casi siempre llevan las mismas coordenadas y a 15 m los grupos no pasan de 17 m. Madrid es distinto. Solo el 16 % de sus registros comparte punto exacto con otra compañía, 1.136 tienen la más cercana a entre 1 y 5 m y 609 a entre 5 y 10 m. A 15 m se juntan, pero el encadenado llega a grupos de 28 m. Parece que en Madrid cada compañía da sus propias coordenadas de la misma azotea. Hay que revisar a mano una muestra de Madrid antes de dar la regla por buena en toda España. Queda como ticket.

Con la proporción del muestreo, 0,54 emplazamientos por registro, el registro da unos 37.600 emplazamientos en España. Con las ER5 que no se juntan con ninguno salen unos 42.000 (estimado), casi lo mismo que los 42.855 marcadores de antenasmoviles.es.

## 2. Convex gratuito a escala España

### Límites

Del plan gratuito, consultados el 28/09 en [convex.dev/pricing](https://www.convex.dev/pricing) y [docs.convex.dev/production/state/limits](https://docs.convex.dev/production/state/limits):

- 0,5 GB de base de datos, contando los índices, y cada índice cuenta como otra copia de la tabla;
- 1 GB al mes de E/S de base de datos: los documentos y las entradas de índice que se leen y se escriben, también los que un `filter` descarta después;
- 1 millón de llamadas al mes y 20 GB-hora de cómputo de acciones;
- por transacción: 32.000 documentos recorridos, 16 MiB leídos, 4.096 lecturas por índice (`db.get` o `db.query`) y 16.000 documentos escritos;
- acciones: 10 minutos las de Node; las del runtime de Convex, 30 según la página de límites y 10 según la de acciones. Memoria: 64 MiB en el runtime de Convex y 512 MiB en Node;
- pasado el límite, el plan gratuito puede rechazar mutaciones y, si dura, devolver errores. Starter factura el exceso: 0,22 $ por GB de E/S y 0,22 $ por GB-mes de almacenamiento.

### Cuánto ocuparía

Tamaños medidos con documentos representativos en JSON, con su `_id`: una observación del registro con cinco bandas ocupa 1.171 bytes, y sin bandas, 612. Un emplazamiento, 302. Una estación base con cinco bandas, 825. El número de documentos es estimado.

| Tabla | Documentos | Solo documentos | Con índices como copias |
|---|---|---|---|
| observaciones del registro | 69.700 | 78 MB | 233 MB (dos índices) |
| observaciones de antenasmoviles.es | 7.300 | 4 MB | 13 MB |
| puntos de antenasmoviles.es | 42.855 | 14 MB | 43 MB |
| emplazamientos | 42.000 | 12 MB | 36 MB |
| estaciones base | 62.500 | 49 MB | 98 MB |
| **Total** | | **158 MB** | **424 MB** |

Cabe en los 0,5 GB, pero justo si los índices cuentan como copias enteras.

### Cuánta E/S gasta

Aquí está el problema. El código de hoy no es incremental en las lecturas. Cada ejecución completada:

- `aplicarListado` lee por clave todas las observaciones de la fuente;
- `cerrarBarrido` las vuelve a leer todas;
- `fusionarTodo` lee todas las observaciones vigentes de todas las fuentes, todas las claves de emplazamientos, y `escribirEmplazamientos` lee, para cada uno de los 42.000, sus estaciones base y su documento, aunque no escriba nada;
- `publicar`, si la versión ha cambiado, lee la instantánea entera y luego cada ficha con sus estaciones y sus observaciones.

Estimado con los tamaños de arriba:

| Ejecución | Lectura | Por noche |
|---|---|---|
| Registro oficial | 78 + 78 + 155 + 205 MB | 516 MB |
| antenasmoviles.es, sin publicar | 14 + 14 + 155 MB | 184 MB |
| **Las dos** | | **0,73 GB por noche, 22 GB al mes** |

Son 22 veces el plan gratuito. Con Starter serían unos 4,6 $ al mes de exceso.

La misma cuenta con la caja de Barcelona, un 3,4 % de España, da unos 0,75 GB al mes. **El despliegue de hoy ya anda cerca del límite de E/S gratuito** en cuanto haya bandas leídas en todas las fichas. Conviene mirarlo en el panel de Convex antes de nada: es una estimación.

Las llamadas no son problema. Una noche de España serían unas 5.000 (listados por lotes de 200, 2.440 fichas, páginas, lotes de fusión y de publicación), 150.000 al mes.

### Qué se rompe además

- **Límites por transacción.** `cerrarBarrido` hace `.collect()` de todas las observaciones de una fuente: 69.700 documentos y 78 MB, frente al tope de 32.000 documentos y 16 MiB. `cerrarBarridoDePuntos`, igual con 42.855 puntos. Fallarían la primera noche.
- **Memoria de las acciones.** `fusionarTodo` junta en memoria todas las observaciones de España dentro de una acción del runtime de Convex, que tiene 64 MiB. Son 82 MB solo de JSON.
- **Duración.** Una noche con 2.440 fichas a 5 s son 4 horas. Una acción dura como mucho 10 o 30 minutos, así que habría que encadenar una acción tras otra con el planificador.

### Alternativas

| | Convex gratuito rehecho | Convex Starter | Trabajo programado fuera de Convex |
|---|---|---|---|
| Qué cambia | Barrido por zona con una huella por tesela, fusión y publicación por provincia, acciones encadenadas | Lo mismo que la primera columna, porque los límites por transacción y la memoria no se compran | La ingesta y la publicación pasan a un proceso de Node que guarda su estado en R2 y publica en R2 |
| E/S de Convex | Unos pocos MB por noche si solo se leen las teselas con otra huella (estimado) | 22 GB/mes con el código de hoy, unos 4,6 $/mes | Ninguna para la ingesta |
| Riesgo | El más alto: un diseño incremental a mano sobre tablas, dentro de límites que se descubren al chocar | Pagar sin quitar el trabajo de la primera columna | Hay que rehacer el estado de la ingesta y dónde lo mira el mantenedor |
| Aportaciones compartidas | En Convex, sin cambios | En Convex | En Convex: el trabajo nocturno lee las correcciones compartidas con una consulta interna por páginas |

**Recomiendo el trabajo programado fuera de Convex** (ADR 0015, propuesta):

- Un proceso de Node con el mismo código de `packages/ingesta` y `packages/dominio`, lanzado por un cron de GitHub Actions.
- El estado de la ingesta son ficheros en R2: las observaciones de cada zona de barrido, las hojas de cada celda, las huellas de los puntos y el registro de ejecuciones. Unos 90 MB sin comprimir, unos 12 MB con gzip (estimado).
- La fusión se hace en memoria, con 7 GB en el ejecutor de GitHub en lugar de 64 MiB.
- La publicación escribe en R2 y dispara el despliegue de la copia de Vercel.
- Convex se queda con lo que sí le va bien: escrituras pequeñas y con límites de las aportaciones compartidas, cuando lleguen. La ingesta lee de ahí las correcciones aprobadas.

El coste está en los minutos de GitHub Actions. Un repositorio privado de una cuenta gratuita tiene 2.000 minutos al mes, y se bloquea al acabarlos si no hay forma de pago. Una noche con 4 horas de fichas son 7.200 minutos al mes. En un repositorio público los ejecutores normales no tienen límite de minutos. Celda se va a ir a su propio repositorio de código abierto (AGENTS.md de la raíz), así que el ritmo de 4 horas encaja con ese cambio. Mientras siga en el privado, la ventana de fichas tiene que quedarse en unos 40 minutos por noche: unas 400 fichas y 1.400 minutos al mes con el listado. A ese ritmo la primera pasada completa tarda seis meses.

Otro riesgo: los ejecutores de GitHub salen desde IP de Azure, y los de Convex, desde AWS. Ni el geoportal ni antenasmoviles.es han bloqueado nunca una IP de centro de datos, que se sepa, pero antenasmoviles.es tiene el desafío de Cloudflare delante. El extractor ya trata un 403 o una página HTML como fuente bloqueada.

## 3. Capa y agrupación a escala España

### Cuántos emplazamientos

Unos 42.900, no 100.000 (estimado en el apartado 1). El ADR 0004 hizo sus cuentas con 100.000, así que medí las dos cosas: el conjunto sintético de 100.000 de la exploración 03 (`sitiosEspana`, rama `spike/celda-pmtiles`) y las posiciones reales de los 42.855 marcadores de `showf`, con sus compañías.

En el formato 4 real, generado con `generarCapa` sobre esas 42.855 posiciones, la capa de España pesa **2,29 MB, 522 KB con gzip y 390 KB con brotli** (medido). Las claves de los emplazamientos son casi la mitad. El banco usa el formato por columnas de la exploración 03, sin claves, bandas ni lotes: 301 KB con gzip para lo mismo. Las cifras de bytes del banco hay que multiplicarlas por 1,75 para pasarlas al formato real.

### Cómo se midió

El banco es la página de la exploración 03 con dos cosas nuevas (`muestras/espana/espana.js` e `indice-worker.js`):

- **Índice en un Worker.** supercluster 9.1 guarda cada nivel en un KDBush sobre un `ArrayBuffer`. El Worker construye el índice y devuelve esos búferes transferidos, y el hilo principal rehidrata un `Supercluster` con `KDBush.from` sin volver a agrupar. La API sigue siendo síncrona.
- **Capa por provincias.** Un resumen nacional de 52 provincias (6 KB, 2,2 KB con gzip) y un fichero por provincia. Por debajo del zoom 8 solo se ve el resumen, un hexágono por provincia. Desde el 8 se piden las provincias cuya caja corta la vista, cada una con su índice. Las provincias del banco son las celdas de Voronoi de las capitales, una partición aproximada que basta para medir pesos y tiempos.

Condiciones de la exploración 03 y de `docs/patterns/rendimiento.md`: Chromium 153 sin interfaz, GPU AMD Radeon 760M con ANGLE sobre Vulkan, ventana de 390 × 844 con DPR 2,6, CPU a ×4 por CDP y el mapa base de OpenFreeMap servido desde una caché en memoria. Un Chromium por medida, cerrado al acabar. Cada medida es una visita nueva:

1. Carga en Barcelona a zoom 15.
2. Barcelona: de 16,5 a 11,5 y vuelta, 3 s cada tramo.
3. España: alejar a toda la península (zoom 4,6) y volver a Madrid a zoom 13.
4. Arrastre a zoom 9 de Madrid a Valencia, cruzando provincias.

Medianas de tres rondas, 28/09/2026 (medido).

### Resultados

Posiciones reales, 42.855 emplazamientos:

| Variante | Al abrir | Tras el recorrido | Primer marcador | Índice en el hilo principal | Barcelona: fps, >50 ms | España: fps, >50 ms | Arrastre: fps | Memoria total |
|---|---|---|---|---|---|---|---|---|
| (a) Capa única | 301 KB, 1 petición | 301 KB, 1 | 965 ms | 414 ms | 55, 3 | 51, 9 | 60 | 84 MB |
| (a) Capa única, índice en Worker | 301 KB, 1 | 301 KB, 1 | 865 ms | 17 ms (Worker 169 ms) | 55, 2 | 51, 9 | 59 | |
| (b) Provincias y resumen | 20 KB, 2 | 108 KB, 16 | 483 ms | 6 ms de mediana por provincia, 62 la mayor | 55, 2 | 52, 6 | 59 | 76 MB |
| (b) Provincias, índice en Worker | 20 KB, 2 | 108 KB, 16 | **410 ms** | 1 ms | 57, 2 | **55, 5** | 60 | |
| (c) PMTiles, símbolos | 25 KB, 7 | 190 KB, 184 | 1.187 ms | 0 | 60, 0 | 60, 0 | 60 | 88 MB |

Sintético, 100.000 emplazamientos:

| Variante | Al abrir | Tras el recorrido | Primer marcador | Índice en el hilo principal | Barcelona: fps, >50 ms | España: fps, >50 ms | Arrastre: fps |
|---|---|---|---|---|---|---|---|
| (a) Capa única | 660 KB, 1 | 660 KB, 1 | 1.917 ms | **1.040 ms** | 50, 5 | 41, 16 | 58 |
| (a) Capa única, índice en Worker | 660 KB, 1 | 660 KB, 1 | 1.944 ms | 53 ms (Worker 477 ms) | 51, 7 | 45, 13 | 58 |
| (b) Provincias y resumen | 95 KB, 3 | 313 KB, 17 | 629 ms | 19 ms de mediana, 206 la mayor (Barcelona, 13.114) | 50, 8 | 46, 13 | 57 |
| (b) Provincias, índice en Worker | 95 KB, 3 | 313 KB, 17 | **474 ms** | 1 ms | 56, 2 | **52, 5** | 59 |
| (c) PMTiles, símbolos | 23 KB, 7 | 293 KB, 184 | 1.305 ms | 0 | 59, 0 | 59, 0 | 60 |

- La memoria total es la de `measureUserAgentSpecificMemory`, página y workers. En las variantes con el índice en un Worker no llegó a medirse. El montón de JavaScript del hilo principal va de 12 a 38 MB en todas.
- Las PMTiles de España pesan 16,2 MB con 139.701 teselas las reales y 31,7 MB con 293.394 las sintéticas (medido, tippecanoe con los parámetros de la exploración 03).
- **El Worker no va del todo frenado.** Con la CPU a ×1, el índice de 100.000 tarda 263 ms en el Worker, y con ×4, 477 ms: CDP frena el Worker menos que el hilo principal. En un móvil de verdad el Worker tardaría como el hilo sin frenar, alrededor de un segundo con 100.000 y unos 400 ms con los reales (estimado). Da igual para la fluidez, porque ese tiempo ya no bloquea la página: lo que queda en el hilo principal es rehidratar, 15 ms con los reales y 45 con 100.000.
- En todas las variantes, el primer segundo tras el primer marcador tiene una tarea larga de 750 a 1.050 ms. Es MapLibre creando el mapa y el estilo, y no depende de la capa.

### Qué recomiendo

**(b), capa por provincias con resumen nacional y el índice de cada provincia en un Worker** (ADR 0016, propuesta).

- Es la que antes pinta: 410 ms con los datos reales, frente a 865 de la capa única y 1.187 de PMTiles.
- Abre con 20 KB en lugar de 301 (en el formato real, unos 35 KB frente a 522).
- Al alejar hasta España va a 55 fps con 5 fotogramas de más de 50 ms, frente a 51 fps y 9 de la capa única.
- Conserva la transición fiel donde hay detalle, porque cada provincia tiene su jerarquía de supercluster. Entre el resumen y una provincia, cada emplazamiento sale del hexágono de su provincia o va a él, y eso también es verdad.
- Con 100.000 aguanta mucho mejor que la capa única: 52 fps frente a 41 al alejar, y el índice de Barcelona, el mayor, deja de bloquear 206 ms.

PMTiles es la más fluida, a 59-60 fps en todo. Aun así la descarto para los marcadores, por lo mismo que la exploración 03: sus agrupaciones no tienen relación entre niveles, así que no hay transición fiel. Además, 16 MB y 140.000 teselas por versión no caben en la copia de Vercel. Si en un móvil real el resumen o las provincias no llegan a los 55 fps, lo siguiente sería pintar con símbolos de MapLibre en reposo y con DOM solo durante la transición, que la exploración 03 dejó sin probar.

Lo que cambia en la web:

- En el borde entre dos provincias pueden verse dos hexágonos juntos, uno de cada provincia, a zoom 8 a 10. Cada uno cuenta bien los suyos. Si molesta, se puede indexar junta la unión de las provincias cargadas, en el Worker, a costa de rehacer el índice al llegar cada una.
- Buscar un emplazamiento por clave, la vista de interferencia y las celdas necesitan las provincias vecinas cargadas. El ADR 0016 lo recoge.

## 4. Zonas y población en toda España

### Límites de provincias y municipios

- **Fuente:** Base de Datos de Límites Jurisdiccionales de España del IGN, por su servicio ATOM de descarga, sin formulario ni registro. [Canal del conjunto](https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml), actualizado el 10/08/2026, y el fichero [`lineas_limite_gml.zip`](https://centrodedescargas.cnig.es/CentroDescargas/documentos/atom/au/lineas_limite_gml.zip), 66 MB. Medido.
- **Licencia:** CC BY 4.0. Las [condiciones de uso del IGN](https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf) piden, para una obra derivada, «Obra derivada de <producto> <fecha> CC-BY 4.0 <atribución>», visible a pie de mapa y en los metadatos. No he podido confirmar que «BDLJE» sea el identificador oficial del producto para esa línea.
- **Contenido** (medido): 8.132 municipios, 81 territorios compartidos (las «Comunidad de…», Bardenas Reales) y 7 territorios sin municipio (Gibraltar, las plazas de soberanía, la isla de los Faisanes). 52 provincias más una de «territorios no asociados». El código INE del municipio es el trozo `NATCODE[6:11]`, y solo vale si `NATCODE[6:8]` coincide con `NATCODE[4:6]`.
- **Otra vía:** el WFS INSPIRE del IGN (`au:AdministrativeUnit`) da GeoJSON a resolución completa: sirve para una provincia suelta, no para toda España.

Tamaños tras simplificar con mapshaper, conservando la topología (medido):

| Simplificación | Municipios GeoJSON, gzip | Vértices | Municipios TopoJSON, gzip | Provincias GeoJSON, gzip |
|---|---|---|---|---|
| Completa | 28,7 MB | 4.446.419 | | 7,2 MB |
| 50 m | 6,1 MB | 958.875 | 1,5 MB | 806 KB |
| 200 m | 1,85 MB | 328.534 | 871 KB | 213 KB |
| 1 km | 600 KB | 92.054 | 639 KB | 45 KB |

- Por provincia, a 200 m, en GeoJSON con gzip: Barcelona 54 KB, Madrid 36 KB y Soria 37 KB.
- Solo el punto de etiqueta de cada municipio (código, nombre, longitud y latitud): 130 KB con gzip, y 72 KB sin los nombres.

### Población

- **Fuente:** INE, «Cifras oficiales de población de los municipios españoles: Revisión del Padrón Municipal», tabla 29005, por su API JSON (`servicios.ine.es/wstempus/js/ES/DATOS_TABLA/29005`) o en CSV (`www.ine.es/jaxiT3/files/t/es/csv_bdsc/29005.csv`). Medido.
- **Fecha de referencia:** 1 de enero de 2025, cifras definitivas publicadas en diciembre de 2025. Las del 1 de enero de 2026 aún no están; por el calendario del año pasado, saldrán hacia diciembre de 2026 (estimado).
- **Licencia:** CC BY 4.0. Para datos elaborados, «Elaboración propia con datos extraídos del sitio web del INE: www.ine.es», con la fecha de la última actualización ([aviso legal del INE](https://www.ine.es/dyngs/AYU/index.htm?cid=125)).
- **Cruce:** 8.132 municipios y 49.114.494 habitantes, y los 8.132 códigos coinciden con los del IGN (medido). Hay que cruzar por código, nunca por nombre: 623 nombres solo cambian en el orden del artículo («Roda, La» frente a «La Roda»). Seis códigos antiguos de la tabla no tienen valor en 2025 y se descartan.
- La población por sección censal existe (el seccionado de 2026 son 65 MB), pero no hace falta: la zona del ejercicio fuera de Barcelona sería el municipio.

### Cómo encaja con las ausencias

Hoy un barrio lleva su número de emplazamientos y sus ausencias, y el ADR 0004 ya avisó de que agrupar por municipio con la caja de Barcelona sería engañoso, porque la caja corta los municipios de alrededor. Con toda España ese problema desaparece: cada municipio está entero en los datos. Lo que propongo (ADR 0017):

- **El publicador asigna a cada emplazamiento su municipio**, por punto en polígono con los límites a 50 m, como hoy hace con el barrio. La provincia son los dos primeros dígitos del código INE. Un emplazamiento en un territorio compartido no tiene municipio y va sin él, como hoy los de fuera de Barcelona van sin barrio. Uno que cae en el mar por la costa simplificada va al municipio más cercano, como mucho a 200 m.
- **Los límites no viajan a la web.** Viajan tablas: por provincia, su etiqueta, su número de emplazamientos y sus compañías; por municipio, lo mismo y sus habitantes. El resumen de provincias pesa 2 KB con gzip (medido en el banco). La tabla de municipios, unos 130 KB con gzip para toda España si lleva nombres; repartida por provincias, de 1 a 8 KB cada una (estimado).
- **Niveles de zona.** Provincias en los zooms bajos, municipios en los medios y barrios dentro del municipio de Barcelona. Cada uno con su número y sus ausencias.
- **Las ausencias en municipios pequeños no dicen nada.** Un pueblo con un solo emplazamiento de Movistar «no tiene» Vodafone, Orange ni Digi, y eso es verdad pero no es un hueco de cobertura: le llega la señal del pueblo de al lado. Propongo enseñar las ausencias solo en los municipios con al menos 10 emplazamientos, y en el resto solo el número. El umbral es una decisión de interfaz para el usuario.
- **El ejercicio de emplazamientos** usa como zona un barrio en Barcelona y un municipio en el resto, con la población del padrón del INE. El área de cada municipio se calcula en el publicador y va en la tabla; el contorno, si se quiere dibujar, se descarga al abrir el ejercicio, el de la provincia a 200 m: de 36 a 54 KB con gzip.

## 5. antenasmoviles.es y fichas estáticas

### Qué hay en toda España

De la respuesta de `showf?er5` del 28/09 (medido): 42.855 filas, 852 KB con gzip y 4,2 MB sin comprimir, igual que el 26/09 (42.851).

- **ER5:** 7.285. Solo 1.862 dicen su compañía en el listado (`er5_7` Movistar 1.023, `er5_3` Orange 550, `er5_1` Vodafone 288, `er5_4` Yoigo 1); las otras 5.423 llevan `er5` a secas y hay que leer su detalle para saberla. 40 marcadores llevan «COW» en el código.
- **Correcciones de desmontaje:** no se pueden contar sin leer los detalles. En los nueve detalles grabados no hay ninguna foto con `desmantelada`.
- **Cambios de un día a otro:** las 41 filas de Campus Nord grabadas el 26/09 son idénticas el 28/09.

### Cuántas peticiones de `markers`

Una por marcador, a una cada 5 s como mínimo, que es lo que exige hoy el extractor. Con unos 0,3 s de respuesta (estimado):

| Qué se lee | Peticiones | A 1 cada 5 s | Con el tope de 100 por noche |
|---|---|---|---|
| Todos los marcadores | 42.855 | 62 h | 429 noches |
| Solo las ER5 | 7.285 | 10,6 h | 73 noches |
| Solo las ER5 sin compañía | 5.423 | 7,9 h | 55 noches |
| Repaso cada 14 días de todos, como hoy en Barcelona | 3.061 al día | 4,5 h al día | imposible |

El repaso cada 14 días, que hoy busca las fotos nuevas, no escala: en toda España serían 4,5 horas diarias contra un sitio sin ánimo de lucro. Propongo:

- `showf` una vez por noche para toda España, como ahora.
- Detalle solo de las ER5 sin compañía y de las ER5 nuevas o cambiadas: 5.423 una vez, a 100 por noche en 55 noches o a 400 por noche en 14.
- Nada de repaso general. Las fotos de desmontaje se pedirían a antenasmoviles.es en el correo que ya está pendiente, por ejemplo una lista de estaciones con foto `desmantelada`. Sin eso, Celda no puede decir en toda España que una estación está desmontada, y la ficha lo dice como hoy: el estado sale del registro.
- El interruptor sigue apagado hasta que el usuario escriba a `admin@antenasmoviles.es`.

### Lotes de fichas por versión

Medido con el `generarCapa` real del formato 4 sobre las 42.855 posiciones de `showf`: **335 lotes** de 128 fichas. Con el tamaño de lote medido en Barcelona con cinco bandas por estación base (unos 210 KB y 9,2 KB con gzip), estimado:

| | Una versión | Ocho versiones (retención de hoy) |
|---|---|---|
| Ficheros | 336 (335 lotes y la capa) más `vigente.json` | 2.688 |
| Tamaño sin comprimir | 70 MB de lotes y 2,3 MB de capa | 580 MB |
| Con gzip | 3,1 MB de lotes y 0,5 MB de capa | 29 MB |

- **R2:** cabe de sobra. 10 GB gratis de almacenamiento, y 1 millón de operaciones de clase A al mes; publicar cada noche son unas 10.000 escrituras al mes.
- **Vercel:** no cabe tal como se sube hoy. La subida por CLI admite 100 MB y 15.000 ficheros ([límites de Vercel](https://vercel.com/docs/limits), 28/09/2026). Ocho versiones son 580 MB, y una sola, 72 MB, que cabe muy justa. Vercel no documenta que sirva ficheros ya comprimidos con su `Content-Encoding`, así que subirlos en gzip no es una salida segura.

Propuesta:

- La copia de Vercel guarda solo la versión vigente y se genera en el build, descargándola de R2, con un deploy hook de Vercel tras cada publicación. La salida del build no tiene tope de ficheros, y el ADR 0010 ya lo apuntaba.
- **Lotes por provincia y con nombre por contenido** (`fichas/<provincia>/<huella>.json`). Una publicación solo escribe los lotes de las provincias que cambian, y las versiones comparten los que no cambian. Con eso, las ocho versiones de R2 pasan de 580 MB a poco más de una.

## 6. Mapa base

Medido con `pmtiles extract --dry-run`, sobre el polígono de España con un margen de 0,1° para no cortar la costa:

| Fuente | z13 | z14 | z15 |
|---|---|---|---|
| OpenFreeMap, planeta PMTiles del 27/09/2026 (esquema OpenMapTiles) | 563 MB | **1,5 GB** (219.342 teselas) | no llega a z15 |
| Protomaps, build del 28/09/2026 | 634 MB | 1,2 GB | 2,3 GB (869.447 teselas) |
| Canarias, OpenFreeMap | 16 MB | 47 MB | |

El extracto de OpenFreeMap vale con el estilo de hoy sin tocarlo, porque usa el mismo esquema. OpenFreeMap publica el planeta en PMTiles en `btrfs.openfreemap.com`, aunque su README no lo documente. El de Protomaps necesitaría otro estilo.

El problema no es el tamaño sino dónde ponerlo. 1,5 GB cabe en R2, pero R2 está detrás de Cloudflare y cae con los bloqueos de LaLiga igual que OpenFreeMap. En Vercel no cabe: son 1,5 GB y 219.342 teselas contra 100 MB y 15.000 ficheros. Una reserva de verdad para toda España necesita un tercer sitio fuera de Cloudflare, o conformarse con una reserva de zooms bajos. Hasta z10 serían unos 30 MB (estimado: hasta z13 son 563 MB y cada nivel multiplica el total por unos 2,6), más Barcelona entera a z14. Es una decisión del usuario y queda fuera de la ampliación.

## Qué no he podido comprobar

- El total de registros es una extrapolación. Solo una pasada completa del listado lo mide, y es lo primero que hará la ingesta de España.
- La E/S de Convex es una cuenta sobre el código, no una lectura del panel. Hay que confirmarla con el uso real del despliegue de Barcelona.
- Las fotos `desmantelada` de antenasmoviles.es siguen sin un caso real.
- Las cifras del navegador son de un móvil simulado con la GPU de un portátil.
