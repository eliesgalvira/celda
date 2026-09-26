# Investigación 07 · antenasmoviles.es y OpenCelliD

Formato, condiciones de uso y `robots.txt` de las dos fuentes comunitarias de Celda. Issue #9, padre #1.

Fecha de las consultas: 26/09/2026, madrugada, hora de Madrid. Todas las peticiones llevaron el `User-Agent` «Celda (investigación; contacto en celda.elies.site)», con 3 a 8 s entre ellas. A antenasmoviles.es le hice unas 25 peticiones en total, incluidas las páginas legales y cinco 404.

Marcas usadas en el texto:

- **Comprobado**: lo he visto en una respuesta real o en un texto de la fuente, con enlace.
- **Inferido**: deducción mía a partir de datos o código, sin confirmación de la fuente.

Las respuestas grabadas están en [`muestras/`](muestras/). La lista completa está al final.

## Resumen

1. **antenasmoviles.es no prohíbe la extracción por `/v1`.** Su `robots.txt` bloquea `/api`, `/archive` (las fotos), `/assets`, `/upload` y otras rutas, pero no `/v1`, que es la ruta de su JSON interno. No hay términos de uso ni aviso legal publicados: las rutas habituales dan 404 y el pie solo enlaza a cookies, privacidad, FAQ y wiki. Comprobado. Aun así, la ley española protege la inversión en bases de datos (art. 133 LPI). Recomiendo escribir a `admin@antenasmoviles.es` antes de publicar, aunque la decisión de extraer ya esté tomada.
2. **antenasmoviles.es no es un registro distinto del oficial.** Copia el registro del Ministerio a diario y le añade historial (primera y última vez que se vio cada banda), fotos de usuarios, estaciones ER5 que los usuarios añaden y no salen en el registro, e identificadores eNB. Sus «correcciones» son sobre todo esas ER5 y las fotos marcadas como «desmantelada». Comprobado con su FAQ y comparando una estación con el geoportal.
3. **La unión con el registro oficial es por código, no por distancia.** Cada estación de antenasmoviles lleva el código de emplazamiento del registro (`0802314`, `CATR0377Z`, `000455`) y las referencias de banda `BB-…` del Ministerio. Comprobado.
4. **La regla de fusión de 60 m falla en Barcelona.** 216 de los 1.278 emplazamientos de antenasmoviles en Barcelona tienen un vecino a menos de 60 m, y 48 pares comparten operador. Con la regla actual se fundirían estaciones que el registro separa.
5. **OpenCelliD exige clave para descargar.** No la he creado. La licencia es CC BY-SA 4.0 y cubre API, descargas y ficheros diarios. Si sus filas entran en las capas públicas, la capa entera tiene que publicarse con CC BY-SA 4.0, y eso no se puede hacer con datos de antenasmoviles, que no son nuestros. Propuesta: no redistribuir OpenCelliD y usarlo solo para enriquecer la ficha, con atribución.
6. **OpenCelliD aporta poco en Barcelona.** En una muestra de 670 × 445 m alrededor de un emplazamiento hay 138 celdas: 129 con `range` 1000, 54 con una sola muestra y solo 8 actualizadas desde 2024. La relación con un emplazamiento solo es fiable en LTE cuando antenasmoviles publica el eNB.

## antenasmoviles.es

### 1. Qué muestra por emplazamiento

La web es un mapa Leaflet. El mapa carga todos los marcadores de España en una sola petición y, al pulsar uno, pide el detalle. Comprobado en el JavaScript en línea de la portada.

Campos del **detalle** (`/v1/markers`), por estación base. Comprobado con [`v1-markers_000455.json`](muestras/antenasmoviles/v1-markers_000455.json):

| Posición | Contenido | Ejemplo real |
|---|---|---|
| `[0]` | Códigos de emplazamiento del registro que agrupa esta estación | `["000455","455"]` |
| `[1]` | Titular, código de operador, número interno de uso desconocido | `["VODAFONE ESPAÑA, S.A.U.","1","325"]` |
| `[2]` | Dirección, lat, lon, altitud aproximada | `["CL TRELAWNY, 2. BARCELONA, BARCELONA",41.385011,2.195467,"11m"]` |
| `[3]` | Bandas, ver abajo | 9 filas |
| `[4]` | Fotos: `id`, `fichero`, `autor`, `fecha_foto`, `fecha_subida`, `old`, `desmantelada`, `lat_subida`, `lon_subida`, `asociadas` | 5 fotos de 3 autores|
| `[5]` | Número de operadores, solo en ER5; `false` en el resto | `false` |
| `[6]` | Identificadores eNB que conoce la comunidad | Orange `CATR0377Z` → `["50377"]` |

Cada fila de banda de `[3]` tiene 8 posiciones. La interfaz las etiqueta así en su código:

| Posición | Etiqueta en la web | Ejemplo |
|---|---|---|
| 0 | «Código de banda» | `BB-1300741` |
| 1 | «Correspondencia código» | `000455` |
| 2 | Frecuencia en MHz | `1825.10 - 1845.10` |
| 3 | Inactiva | `false` |
| 4 | «Primera vez vista» | `Lanzamiento` o `07/08/2024` |
| 5 | «Última vez vista» | `25/09/2026` |
| 6 | «Última vez actualizada» | `Lanzamiento` |
| 7 | Operador que usa la banda | `1` |

«Lanzamiento» significa que la banda ya estaba el primer día que antenasmoviles empezó a leer el registro. Inferido de `historicProcess()`, que lo trata como la fecha más antigua posible.

El código de operador es 1 Vodafone, 3 Orange, 4 Xfera (Yoigo), 7 Movistar y 22 Digi, según `ispName()` en la portada. El marcador combina operadores concatenando códigos: `22731` significa Digi, Movistar, Orange y Vodafone en el mismo emplazamiento. Comprobado con el extracto de `showf`.

Qué **no** trae ninguna de las dos fuentes, ni antenasmoviles ni el registro:

- **Azimut de los sectores.** Los únicos ángulos son los de las medidas de radiación: distancia y rumbo desde la antena hasta el punto donde el Ministerio midió. Son puntos de medida, no sectores. No hay que usarlos como orientación.
- **Tecnología.** El registro solo da rangos de frecuencia. Las etiquetas `G09`, `U21`, `B3`, `N78` de antenasmoviles las calcula su JavaScript a partir de la frecuencia y la fecha. Inferido: la función `processTechnologies` está en `/assets/propios/mapFunctions.js`, y no la he descargado porque `/assets` está en `Disallow`.
- **Notas escritas de la comunidad.** Solo hay reportes de fotos (`POST /v1/reportes/{id}`) y el grupo de Telegram.

Qué **añade** antenasmoviles al registro:

- **Historial.** Una banda que desaparece del registro sigue en antenasmoviles con `inactiva = true` y su última fecha. Ejemplo: Movistar `0802314`, banda `BB-0800838`, 1910-1915 y 2155-2170 MHz (3G), vista por última vez el 09/10/2025. El [geoportal](https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=0802314) ya no la muestra. Comprobado con [`detalleEstacion_0802314.html`](muestras/registro-oficial/detalleEstacion_0802314.html).
- **Estaciones ER5 y similares.** La wiki lo explica así: «Normalmente en los datos oficiales del gobierno salen las ER1/3/4. Las ER2/5 no salen teniendo que añadirlas los usuarios.» ([wiki](https://antenasmoviles.es/wiki), sección «¿Qué significa ERx?»). Con `?er5` el mapa pasa de 35.528 a 42.851 marcadores en España. Hay 7.321 ER5 y «COW» (estaciones móviles), 47 de ellas en la caja `41.30–41.50, 2.00–2.30`, que incluye Barcelona y los municipios de alrededor. Llevan códigos inventados como `MV-BCN-82383` o `MIC-08901-BBVA-1`, titular `ER5-M-TELEFONICA`, dirección de Nominatim, fotos y ninguna banda. Comprobado con [`v1-markers_MV-BCN-82383.json`](muestras/antenasmoviles/v1-markers_MV-BCN-82383.json).
- **Fotos con fecha, autor y banderas `old` y `desmantelada`.** Son la única prueba comunitaria de que un emplazamiento del registro ya no existe. En las cuatro estaciones que consulté ninguna foto tenía `desmantelada` activado, así que no he visto un caso real.
- **eNB.** Orange `CATR0377Z` → `50377`, Orange `CATR6046A` → `56046`, Movistar `0800977` → `81106`, Vodafone `110480` → `88603`. En Orange el número del eNB parece seguir el del código de emplazamiento (5 + 0377, 5 + 6046). Inferido de dos casos, no hay que depender de ello.
- **Posible microcelda.** Es una heurística de su JavaScript basada en qué combinaciones de bandas tiene la estación.
- **Agrupación de estaciones.** Un marcador reúne estaciones de varios operadores. En Trelawny 2, la de Vodafone y la de Movistar están a 15 m y salen juntas. La distancia mínima entre dos marcadores de Barcelona es 17,5 m. Inferido: antenasmoviles funde a unos 15 m, pero no conozco la regla.
- **Historial de medidas de radiación.** `v1/radiations` guarda las medidas antiguas con su fecha. El geoportal solo muestra las actuales.

El número de emplazamientos de Barcelona municipio según su página de estadísticas es «985 Antenas de Vodafone, 859 de Movistar, 397 de Orange, 24 de Digi, 985 Antenas totales» ([página](https://antenasmoviles.es/datos/municipios/Barcelona/Barcelona)). El total no cuadra con la suma. Parece que cuenta el máximo por operador, pero no lo he podido comprobar.

### 2. Cómo carga los datos

Todo es JSON sin clave ni sesión. Hay un token CSRF, pero solo para los `POST` de reportes. Endpoints comprobados:

| Endpoint | Qué devuelve | Tamaño |
|---|---|---|
| `GET https://antenasmoviles.es/v1/showf?` | Todos los emplazamientos de España sin ER5: `[lat, lon, [códigos], códigoCombinado, {OP: [bandas]}]` | 35.528 filas, 731 KB con gzip, 3,8 MB sin comprimir |
| `GET /v1/showf?er5` | Lo mismo, incluidas las ER5 | 42.851 filas, 853 KB con gzip |
| `GET /v1/show?vf&B3&…` | Mismo formato con filtros de operador, banda o fecha (`days=7`, `30`, `360`) | no probado |
| `GET /v1/markers?id=<códigos separados por comas>` | Detalle por estación, formato de la sección 1 | 0,3 a 5 KB |
| `GET /v1/radiations?id=<códigos>` | `[distancia_m, rumbo_°, valor_µW/cm², antigua, fecha]` | ~1 KB |
| `POST /v1/reportes/{id}` | Reporte de foto con CSRF | no usar |

En las bandas de `showf`, `|` marca una banda antigua (`U|21`), según `data-old` en `divs_b()`. El significado de `+` en `N78+` o `B7+` no aparece en el código en línea.

La beta (`beta.antenasmoviles.es`, Angular) usa la misma API en otro host. Su configuración dice: `baseAPIUrl:"https://api.antenasmoviles.es/"`, `showF:"/v1/showf"`, `markersEndpoint:"/v1/markers"`, `geoPortalUri:"https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento="`. Comprobado en `main-SZJBRVY3.js`. `api.antenasmoviles.es/robots.txt` es idéntico al principal. El de la beta devuelve un 500.

**Paginación**: no hay. `showf` es un volcado completo y el cliente filtra y agrupa.

**Caché**: las respuestas llevan `cache-control: no-store, no-cache, must-revalidate`, sin `ETag` ni `Last-Modified`. La caché con ETag de la decisión 8 no sirve aquí. Para detectar cambios hay que calcular un hash del contenido.

**Identificadores estables.** El identificador de estación es el código de emplazamiento del registro oficial, que es estable mientras el Ministerio no lo cambie. Hay variantes del mismo emplazamiento de Vodafone con ceros a la izquierda (`000591`, `00591`, `591`), y antenasmoviles las agrupa en la misma estación. Las ER5 usan códigos que inventan los usuarios y no tienen garantía de estabilidad.

**Enlace a cada emplazamiento.** No existe una URL por emplazamiento. Lo más estable es el hash del mapa, `https://antenasmoviles.es/#19/41.385011/2.195467`, con el formato `#zoom/lat/lon` que lee `validURL()`. La propia web lo usa en sus páginas de municipio (`/#20/41.401217/2.154108`). Centra el mapa pero no abre la ficha, así que la persona tiene que pulsar el marcador. Para el registro oficial sí hay URL por código: `https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=<código>`.

#### `robots.txt`, términos y aviso legal

[`https://antenasmoviles.es/robots.txt`](https://antenasmoviles.es/robots.txt), `last-modified` 13/06/2025, literal:

```
User-agent: *
Disallow: /api
Disallow: /datos/api
Disallow: /estadisticasfotos/api
Disallow: /herramientas/api/
Disallow: /upload
Disallow: /archive
Disallow: /assets
Disallow: /bot
Disallow: /images
Disallow: /frecuenciasoperador/js
Disallow: /frecuenciasoperador/css
Disallow: /areaprivada

Sitemap: https://antenasmoviles.es/sitemap.xml
```

Qué implica:

- `/v1/*` está permitido. Es la ruta de los datos.
- `/archive` está prohibido. Ahí están las fotos, en `archive/antenas/` y `archive/antenas/thumb/`. **Celda no debe descargar ni copiar fotos.** Se enlaza a la web.
- `/assets` está prohibido, y con él el JavaScript de `mapFunctions.js`. No lo he leído.
- El `sitemap.xml` solo lista 6.578 páginas de municipio (`/datos/municipios/<provincia>/<municipio>`). Son HTML permitido, con operador, dirección y enlace `/#20/lat/lon` de cada emplazamiento. Sirven como alternativa si `/v1` cambia.

Términos y aviso legal: **no existen**. `/aviso-legal`, `/avisolegal`, `/terminos`, `/legal` y `/condiciones` dan 404, y el menú solo enlaza «Cookies», «Privacidad», «FAQ», «Wiki», «Reparto de frecs» y Telegram. La [política de privacidad](https://antenasmoviles.es/privacidad) no habla de reutilización. Su contacto es `admin@antenasmoviles.es`. La [FAQ](https://antenasmoviles.es/faq) se describe como «una web sin ánimo de lucro» y dice sobre el origen de los datos: «Los datos de localización de antenas y bandas se obtienen de la web oficial del Gobierno de España. […] Además, algunas antenas, calificadas como ER5, proceden de fuentes oficiales y de aportaciones de nuestros usuarios.»

Marco legal. Esto es inferido y no es asesoramiento jurídico. El [art. 133.1 LPI](https://www.boe.es/buscar/act.php?id=BOE-A-1996-8930#a133) permite al fabricante de una base de datos con inversión sustancial «prohibir la extracción y/o reutilización de la totalidad o de una parte sustancial del contenido». El 133.2 añade que tampoco se autoriza «la extracción y/o reutilización repetidas o sistemáticas de partes no sustanciales» si perjudican al fabricante. La parte que viene del registro oficial es del Ministerio. El historial, las ER5, los eNB y las fotos sí son inversión de antenasmoviles, y las fotos tienen además derechos de autor de cada usuario. Que no haya términos no equivale a un permiso.

Mi propuesta, compatible con la decisión ya tomada:

1. Escribir a `admin@antenasmoviles.es` antes del primer despliegue público. Explicar qué se lee (`showf` una vez al día y `markers` solo de lo que cambia en Barcelona), el `User-Agent`, la atribución con enlace, que no se copian fotos y que hay un interruptor. Si dicen que no, el interruptor lo apaga y Celda enlaza sin copiar.
2. Publicar en Celda solo lo que hace falta para el estado del emplazamiento: si hay ER5 o una foto «desmantelada», con enlace a antenasmoviles. No reproducir su historial completo ni sus fotos.
3. Otro riesgo: detrás hay Cloudflare con script de desafío (`/cdn-cgi/challenge-platform`). Desde una IP doméstica no hubo desafío. Desde las IP de Convex, que están en AWS, podría haberlo. El extractor tiene que tratar un 403 o una página HTML como «fuente bloqueada» y no como «cero antenas».

#### Ritmo de peticiones propuesto

- 1 `GET /v1/showf?er5` al día, de madrugada. Son 853 KB, lo mismo que descarga cualquier visitante al abrir la web. Luego se filtra Barcelona por caja: 1.278 marcadores en `41.32–41.47, 2.05–2.23`.
- Se guarda un hash por marcador (códigos y bandas). `markers` se pide solo para los marcadores nuevos o cambiados, a 1 petición cada 5 s como mucho y con tope diario, por ejemplo 300.
- La primera pasada completa de Barcelona son unas 1.300 peticiones: unas 2 horas a ese ritmo, repartidas en 4 o 5 noches con el tope.
- Parada ante 429, 403 o HTML en lugar de JSON, con aviso en el estado de la ingesta.

### 3. Cómo se identifica una corrección frente al registro oficial

- **Mismo código.** La unión principal. Los códigos de `[0]` y la «Correspondencia código» de cada banda son los códigos de emplazamiento del registro, y `BB-…` es la «Referencia» del geoportal. En `0802314` coinciden las 10 bandas activas. Comprobado.
- **Operador.** El registro da el titular de la estación (`DS MOBILE NETWORKS, S.L.`) y el operador de cada banda (Telefónica o DS Mobile). antenasmoviles lo copia en `[1]` y en la posición 7 de cada banda. Hay que usar el operador de la banda y no el titular, porque la compartición de red los separa. La web reescribe «DS MOBILE NETWORKS» como «MOVISTAR + DIGI» y marca «RAN Sharing con Movistar/Orange» para Yoigo con códigos `1B9…`.
- **Cercanía.** Solo para lo que no tiene código de registro: las ER5 y las COW. Una ER5 a menos de unos 20 m de una estación del registro del mismo operador es un posible duplicado y se muestra como conflicto.

Tipos de corrección que se pueden detectar:

| Caso | Señal en antenasmoviles | Estado en Celda |
|---|---|---|
| Emplazamiento que no está en el registro | ER5 o COW sin código del registro | nuevo |
| Emplazamiento del registro desmontado según la comunidad | foto con `desmantelada` | corregido, con enlace a la foto en su web |
| Banda retirada | `inactiva = true` con última fecha | No es una corrección, porque el registro también la quitó. Es historial. |
| Banda nueva | primera fecha reciente | Tampoco, viene del registro. Sirve para «actualizado el …». |

## OpenCelliD

### 4. Descargas, campos, clave, límites y licencia

**Clave.** Hacen falta cuenta y token para las descargas y la API. La [página de descargas](https://opencellid.org/downloads.php) dice: «Enter your API access token to see download links.» No he creado cuenta ni clave. La URL de descarga por MCC no aparece en la documentación pública y no la he podido ver sin token. Queda pendiente de que el usuario cree la cuenta.

**Formato.** [Database format](https://docs.opencellid.org/docs/downloads/database-format), comprobado. `cell_towers.csv` y `cell_towers_diff-*.csv.gz` comparten columnas, en este orden:

| Columna | Tipo | Significado según la documentación |
|---|---|---|
| `radio` | string | «GSM, UMTS, LTE or CDMA». El glosario y la API añaden `NR` y `NBIOT`. |
| `mcc` | integer | MCC, 214 para España |
| `net` | integer | MNC |
| `area` | integer | LAC o, en LTE, TAC |
| `cell` | integer | Cell ID. En UMTS, RNC y CID combinados. |
| `unit` | integer | PSC en UMTS, PCI en LTE |
| `lon`, `lat` | double | «Estimated cell longitude/latitude». Ojo: `lon` va antes que `lat`. |
| `range` | integer | «Estimated cell range in meters» |
| `samples` | integer | «Number of measurements assigned to the cell» |
| `changeable` | integer | «Deprecated. Always 1.» |
| `created`, `updated` | integer | Unix en segundos: primera y última vez vista |
| `averageSignal` | integer | «Deprecated. Always 0.» |

**Actualización y límites.** Comprobado en [Access and limits](https://docs.opencellid.org/docs/getting-started/access-and-limits) y [Troubleshooting](https://docs.opencellid.org/docs/help/troubleshooting):

- «We generate exports daily by 02:00 GMT. They include towers observed in the last 18 months.»
- «You can download each file twice per day.»
- API: «Each user receives 1,000 API request credits per day.» El error por límite diario es el código 7 con HTTP 429.
- `getInArea`: 50 celdas por petición como máximo y una caja de 4 km² como máximo. Para una ciudad recomiendan la descarga.
- «Individual measurements are not available for download.»

Para Celda basta con descargar `214.csv.gz` una vez al día, filtrar Barcelona y guardar la copia. No hace falta la API.

**`robots.txt`.** `https://opencellid.org/robots.txt` devuelve 403, así que no hay reglas legibles. `docs.opencellid.org/robots.txt` solo prohíbe `/wiki/`.

**Licencia.** [License and attribution](https://docs.opencellid.org/docs/attribution), comprobado: «OpenCellID data is licensed under CC BY-SA 4.0, including API results, dataset downloads and daily changes.» Exigen:

- Crédito visible «on the page displaying the data, beside the map or visualization», con este texto: «Cell tower data from OpenCellID, licensed under CC BY-SA 4.0», enlazado a `https://opencellid.org` y a la licencia.
- Si se modifica el dato, indicarlo: «add a description alongside the credit, such as "Changes: coordinates rounded to two decimal places."»
- En una API propia: «In every response containing OpenCellID data, through response metadata or headers». Esto afecta a las consultas de Convex si devuelven datos de OpenCelliD.
- «When sharing adapted material, follow the license's ShareAlike requirements.»

Qué implica redistribuirlo en las capas públicas. Me baso en el texto de la [licencia](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en), lo demás es interpretación mía. La sección 4 dice: «if You include all or a substantial portion of the database contents in a database in which You have Sui Generis Database Rights, then the database […] is Adapted Material». La 3(b) obliga a publicar ese material adaptado con «a Creative Commons license with the same License Elements». Un PMTiles con las celdas de OpenCelliD de Barcelona es una parte sustancial, así que ese PMTiles tendría que ir con CC BY-SA 4.0. Si en el mismo fichero van datos de antenasmoviles, Celda no puede darles esa licencia porque no son suyos.

**Recomendación: no redistribuir filas de OpenCelliD.** Usarlo solo para enriquecer la ficha, por ejemplo con «la comunidad de OpenCelliD vio celdas LTE de este operador aquí por última vez el 03/2026». Esa frase va con el crédito al lado y sin copiar coordenadas ni identificadores a las capas. Si algún día se quiere una capa de celdas, que sea un PMTiles aparte con licencia CC BY-SA 4.0 y solo con datos de OpenCelliD.

**Muestra real sin clave.** El mapa de la portada usa `GET https://opencellid.org/ajax/getCells.php?bbox=<lonmin,latmin,lonmax,latmax>`, solo a partir del zoom 16 según `map.js`. Devuelve GeoJSON con `radio`, `mcc`, `net`, `area`, `samples`, `range` y `updated`, pero sin `cell`. El glosario lo confirma: «The homepage's browsing map does not include cell IDs in its marker data or popups». Es un endpoint interno del mapa y **no hay que usarlo en el extractor**. Hice una sola petición para tener una muestra: [`ajax-getCells_trelawny.geojson`](muestras/opencellid/ajax-getCells_trelawny.geojson), caja de unos 670 × 445 m alrededor de Trelawny 2. Resultado:

- 138 celdas: 85 UMTS, 30 GSM y 23 LTE, ninguna NR.
- MNC 3 (Orange), 7 (Movistar), 1 (Vodafone), 4 (Yoigo) y 25.
- 129 con `range = 1000` y 54 con `samples = 1`.
- Años de `updated`: casi todas entre 2014 y 2017. Solo 8 son de 2024 o posteriores.

Como la descarga solo incluye los últimos 18 meses, el CSV de Barcelona tendrá mucho menos que el mapa. Inferido de una sola zona.

### 5. Relación entre celdas y emplazamientos

La propia documentación avisa ([glosario](https://docs.opencellid.org/docs/help/glossary)): «OpenCellID records describe logical cells, not physical towers.» Y también: «Cell positions are estimates derived from contributed observations, not surveyed antenna or mast locations. […] Nearby or overlapping markers alone do not prove that cells share a site.»

Los datos de Barcelona muestran por qué la distancia sola no basta:

- Entre emplazamientos de antenasmoviles, la distancia al vecino más cercano tiene una mediana de 120 m y un percentil 10 de 47 m.
- Las posiciones de OpenCelliD salen de dónde estaban los móviles que midieron, a menudo en la calle. Según la documentación, «Estimates can differ from the physical antenna site, especially where observations are sparse or concentrated along a road.»
- En la muestra, las celdas más cercanas a Trelawny 2 están a 31, 52, 55 y 60 m. A esa distancia también hay otros tres emplazamientos del registro.

Heurística propuesta, por orden de confianza:

1. **LTE con eNB conocido. Confianza alta.** En LTE, `cell` es el ECI de 28 bits: eNB × 256 + celda local. Es norma 3GPP y no lo he comprobado en OpenCelliD. Si `cell >> 8` coincide con un eNB que antenasmoviles publica para una estación del mismo operador (`[6]`), la celda pertenece a esa estación. `cell & 0xFF` suele numerar el sector, pero cada operador tiene su convención. Inferido.
2. **LTE sin eNB conocido. Confianza baja.** Se agrupan las filas por `(net, cell >> 8)` y se calcula el centroide ponderado por `samples`. Se asigna a la estación más cercana del mismo operador solo si está a menos de 150 m y la segunda candidata está al menos 1,5 veces más lejos. Si no, queda sin asignar. Con la separación de Barcelona, la mayoría quedarán sin asignar, y está bien que así sea.
3. **NR.** El NCI tiene 36 bits y el tamaño del gNB lo fija cada operador (22 a 32 bits). Sin saber el tamaño no se puede agrupar. No usar hasta tener ejemplos. En la muestra no hay ninguna NR.
4. **GSM y UMTS.** No hay forma fiable de agrupar por emplazamiento, y 2G y 3G se están apagando. No usar.
5. **Operador.** `net` es la red que emite, no la marca: 1 Vodafone, 3 Orange, 4 Yoigo, 7 Movistar, 22 Digi. Esta lista es inferida de listas públicas de MNC y hay que comprobarla con la CNMC. Con compartición de red, Yoigo emite sobre emplazamientos de Orange o Movistar, y Digi sobre Movistar. No usar `net` para decir quién es dueño del mástil.

Incertidumbre que hay que mostrar: la posición de OpenCelliD nunca sustituye a la del registro. Una asignación del paso 2 se marca como «probable», y una celda sin asignar no crea un emplazamiento «nuevo». Con esos datos Celda solo diría una suposición.

### Sobre la regla de fusión de la arquitectura

La decisión 9 de `arquitectura.md` dice que se unen «las observaciones que están a menos de 60 m y son del mismo operador». Con los datos de antenasmoviles de Barcelona:

| Umbral | Emplazamientos con un vecino más cerca | Pares a menos de 60 m que comparten operador |
|---|---|---|
| 10 m | 0 | |
| 30 m | 46 | |
| 60 m | 216 | 48 |
| 100 m | 503 | |

Propuesta:

- Registro con antenasmoviles: unión por código, sin distancia.
- ER5 o medidas propias con el registro: distancia de 20 m y mismo operador, y si hay duda, se muestra como conflicto.
- OpenCelliD: los pasos de la sección 5.

El umbral fijo de 60 m solo tiene sentido fuera de ciudad.

## Encaje con el glosario

| Término | antenasmoviles.es | OpenCelliD |
|---|---|---|
| **Emplazamiento** | Marcador de `showf`: `lat`, `lon`, lista de códigos. Celda le da su propio identificador tras fusionar. | No existe. Como mucho, el grupo de un eNB asignado a un emplazamiento. |
| **Estación base** | Cada elemento de `markers`: código de emplazamiento del registro, titular y bandas | Grupo `(net, eNB)` en LTE |
| **Sector** | No hay datos. Los rumbos de `radiations` son puntos de medida, no sectores. | `cell & 0xFF` en LTE, sin azimut |
| **Banda** | Rango en MHz y operador de la banda. Las etiquetas `B3`, `N78` son derivadas. | Sin banda. Solo `radio` y, en LTE, PCI. |
| **Observación** | Cada banda con primera y última fecha vista, cada foto con `fecha_foto`, cada ER5 | Cada fila, con `updated` como fecha y `samples` como peso |
| **Corrección** | ER5 o COW sin código del registro, y foto `desmantelada` | Ninguna por sí sola |
| **Estado verificado** | Está en el registro y nadie lo contradice. Una foto reciente puede reforzarlo. | Puede reforzarlo el paso 1 con `updated` reciente |
| **Estado corregido** | Foto `desmantelada` sobre un emplazamiento del registro | No |
| **Estado nuevo** | ER5 o COW | No crea emplazamientos |

La fuente de cada observación es `antenasmoviles.es` o `OpenCelliD`, con su fecha. El enlace es el hash del mapa de antenasmoviles o el geoportal para el registro. Para OpenCelliD, el crédito va con la licencia.

## Pendiente

- Crear cuenta de OpenCelliD, guardar el token como secreto de Convex, descargar `214.csv.gz` y grabar un extracto real de Barcelona en `muestras/opencellid/`. Lo tiene que hacer el usuario.
- Enviar el correo a `admin@antenasmoviles.es` antes de publicar.
- Encontrar un caso real de foto `desmantelada` en Barcelona para las pruebas. Hace falta recorrer `markers` o preguntar en su Telegram.
- Confirmar los MNC españoles con la CNMC.

## Muestras grabadas

Todas se obtuvieron el 26/09/2026 y son respuestas literales, salvo el extracto de `showf`.

| Fichero | Origen |
|---|---|
| `muestras/antenasmoviles/robots.txt` | `https://antenasmoviles.es/robots.txt` |
| `muestras/antenasmoviles/v1-showf_extracto-trelawny.json` | Las 5 filas de `GET /v1/showf?` dentro de `41.3830–41.3870, 2.1915–2.1995`. Es un extracto: la respuesta completa es de toda España y no se guarda. |
| `muestras/antenasmoviles/v1-markers_000455.json` | `GET /v1/markers?id=000455,0802314,455,CATR0377Z`: 3 operadores, Digi en compartición, fotos, eNB y bandas inactivas |
| `muestras/antenasmoviles/v1-markers_054515.json` | `GET /v1/markers?id=054515,0800977,CATR6046A` |
| `muestras/antenasmoviles/v1-markers_0806460.json` | `GET /v1/markers?id=0806460,110480,CATR0250A`: bandas con primera fecha reciente |
| `muestras/antenasmoviles/v1-markers_MV-BCN-82383.json` | `GET /v1/markers?id=MV-BCN-82383`: ER5 añadida por usuarios |
| `muestras/antenasmoviles/v1-radiations_000455.json` | `GET /v1/radiations?id=000455,455` |
| `muestras/antenasmoviles/v1-showf-er5_extracto-campus-nord.json` | Ticket 18. Las 41 filas de `GET /v1/showf?er5` dentro de `41.3790–41.3945, 2.1020–2.1275`, literales. |
| `muestras/antenasmoviles/v1-showf-er5_extracto-er5-barcelona.json` | Ticket 18. Las 42 ER5 de la misma respuesta dentro de la caja de Barcelona del registro oficial. |
| `muestras/antenasmoviles/v1-markers_0802532.json` | Ticket 18. `GET /v1/markers?id=0802532,086040,86040,CATR0228A`: la entrada de Campus Nord, sin fotos |
| `muestras/antenasmoviles/v1-markers_CATR6031A.json` | Ticket 18. `GET /v1/markers?id=CATR6031A`: una ER5 de Orange con código de aspecto oficial, a 7 m de Movistar `0800542` |
| `muestras/registro-oficial/detalleEstacion_0802314.html` | `https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=0802314`, en ISO-8859-1 y con CRLF |
| `muestras/opencellid/ajax-getCells_trelawny.geojson` | `https://opencellid.org/ajax/getCells.php?bbox=2.1915,41.3830,2.1995,41.3870`. Es el mapa público, sin `cell`, y no refleja el formato CSV. |

Las fotos de antenasmoviles incluyen los nombres de usuario públicos de sus autores (`autor`). Se conservan porque la atribución los necesita. Los ficheros de imagen no se han descargado.
