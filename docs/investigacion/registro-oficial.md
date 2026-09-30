# Investigación 06 · Registro oficial (Infoantenas)

Consultado el 26/09/2026. Todas las peticiones se hicieron a mano o con los scripts de `muestras/herramientas/`, en serie, con al menos 2 o 3 segundos entre peticiones y el `User-Agent` «Celda (investigación; contacto en celda.elies.site)». En total fueron unas 65 peticiones a `geoportal.minetur.gob.es` en unos 15 minutos. Ese dominio no tiene `robots.txt` (devuelve 404), así que no hay ninguna ruta prohibida. Los `robots.txt` de `digital.gob.es`, `datos.gob.es` y `boe.es` no prohíben las páginas consultadas.

Cada apartado separa lo **comprobado** (visto en una respuesta o en un texto oficial, con enlace) de lo **inferido** (mi interpretación, pendiente de confirmar).

## Resumen

- El registro oficial es el visor Infoantenas del Ministerio para la Transformación Digital y de la Función Pública, en `https://geoportal.minetur.gob.es/VCTEL/vcne.do`. No hay descarga masiva, ni API documentada, ni WMS/WFS, ni conjunto en datos.gob.es. El visor carga los puntos de un endpoint GeoJSON interno por bbox y cada ficha es una página HTML.
- Por estación publica código, operador, dirección, coordenadas, y en la ficha los expedientes del Registro Nacional de Frecuencias (referencia y banda asignada en MHz) y los niveles de exposición medidos alrededor. **No publica** tecnología, azimut de los sectores, altura, potencia ni fechas.
- El endpoint GeoJSON corta en 1000 elementos sin avisar, ordenados por operador y código. Hay que teselar.
- En el municipio de Barcelona hay 1784 registros, que corresponden a unas 1440 estaciones base y unos 900 emplazamientos. En los 36 municipios del AMB hay unos 3170 registros.
- No hay licencia explícita. Se aplican por defecto la Ley 37/2007 y las condiciones generales de reutilización del ministerio, que piden citar la fuente, no desnaturalizar y dar la fecha. El riesgo es que el ministerio ha dicho que no facilita la base de datos y que Infoantenas solo sirve para informar sobre exposición.

## 1. Qué publica por estación

### Comprobado

El visor pide los puntos a `infoantenasGeoJSON.do` (ver apartado 2). Cada elemento es un `Feature` GeoJSON con estas propiedades (muestra en `muestras/geojson-campus-nord.iso-8859-1.json`):

| Propiedad | Ejemplo | Qué es |
|---|---|---|
| `id` (del Feature) | `ORANGE ESPAGNE, S.A.U. - CATR0228A` | operador y código; único en toda la respuesta |
| `Gis_ID` | `CATR0228A` | código del operador; **no** es único (Digi repite los de Telefónica) |
| `Gis_Codigo`, `Código` | igual que `id` | |
| `Gis_Latitud`, `Gis_Longitud` | `"41.388342"`, `"2.113628"` | texto; difiere de `geometry` en 2·10⁻⁶ como mucho |
| `geometry.coordinates` | `[2.113628, 41.388344]` | EPSG:4258 (ETRS89), de 2 a 6 decimales |
| `Dirección` | `PZ EUSEBI GÜELL, 1. BARCELONA, BARCELONA` | «vía, número. MUNICIPIO, PROVINCIA» |
| `Tipo`, `Gis_Etiqueta` | `Estación de telefonía móvil` | siempre el mismo valor |
| `Gis_Estilo` | `vcne.estaciones` | siempre el mismo valor |
| `Detalle` | `@@<url-aplicacion>/detalleEstacion.do?emplazamiento=CATR0228A&codEmplazamiento=…` | enlace a la ficha |

La ficha (`detalleEstacion.do`) es HTML con tres bloques (muestras en `muestras/detalle-*.html` y convertidas a JSON en `muestras/fichas-campus-nord.json`):

1. **Localización.** Código y dirección.
2. **Características técnicas.** Una fila por expediente, con operador, referencia (`B B -2403167`) y banda asignada (`2120.00 - 2140.00`, o dos rangos separados por `;` como `1910.00 - 1915.00; 2155.00 - 2170.00`).
3. **Niveles medidos en el entorno.** Filas con distancia (m), acimut (°) y valor medido (µW/cm²). El acimut es la dirección **del punto de medida** visto desde la estación, no la orientación de las antenas. Lo aclara la propia ficha: «Acimut es el ángulo que tiene una determinada dirección. Para calcularlo se toma como referencia el norte geográfico».

La resolución de transparencia 001-053789 del ministerio ([PDF](https://portal.mineco.gob.es/RecursosTransparencia/001-053789_Resolucion_anonimizada.pdf), 23/02/2021) explica qué es la referencia. Son expedientes del Registro Nacional de Frecuencias, y «cada expediente/registro del servicio de comunicaciones electrónicas en bandas armonizadas se refiere a una determinada banda destinada a dicho servicio y a una tecnología utilizada en la banda. De este modo para una misma instalación física de una estación, puede haber varios expedientes». En esa misma resolución las referencias de Ávila tienen la forma `AVAV-2000120`, y el ministerio da aparte la «fecha de puesta en servicio» de cada una, que Infoantenas no muestra.

Qué **no** aparece en ninguna respuesta: tecnología (2G/3G/4G/5G), azimut de sectores, altura, potencia, tipo de antena, fecha de alta, fecha de actualización o de medida. El artículo 8.2 del Reglamento del dominio público radioeléctrico ([RD 123/2017, BOE-A-2017-2460](https://www.boe.es/buscar/act.php?id=BOE-A-2017-2460)) lo explica. Dice que «no se facilitará información de los datos inscritos en el registro, diferentes de los incluidos en el Registro Público de Concesiones», para proteger el secreto comercial y la seguridad pública.

El servicio se describe en [digital.gob.es](https://digital.gob.es/telecomunicaciones-infraestructuras-digitales/areas-interes/inspeccion-telecomunicaciones/niveles-exposicion/servicio-estaciones-radioelectricas): «contiene datos de las comprobaciones realizadas por los técnicos de las Jefaturas Provinciales de Inspección de Telecomunicaciones, así como de las certificaciones presentadas al Ministerio por los operadores». La ayuda del visor ([ayuda.jsp](https://geoportal.minetur.gob.es/VCTEL/jsp/ayuda.jsp)) dice que muestra «las antenas de telefonía móvil de los operadores de telefonía móvil vigentes».

#### Ejemplos reales (Campus Nord, Les Corts, Pedralbes)

La bbox `2.105,41.382,2.125,41.392` devuelve 40 registros: 15 de Vodafone S.A.U., 1 de Vodafone S.A., 14 de Telefónica y 10 de Orange. Algunos, con su ficha:

| Registro | Coordenadas | Dirección publicada | Bandas asignadas (MHz) | Años de los expedientes |
|---|---|---|---|---|
| ORANGE ESPAGNE, S.A.U. - CATR0228A | 2.113628, 41.388344 | PZ EUSEBI GÜELL, 1 | 758-768, 832-842, 925,1-935,1 (×2), 1855,1-1879,9, 2120-2140 | 2024 |
| TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532 | mismo punto | PZ Eusebi Güell, 1 | 778-788, 852-862, 935,1-949,9 (×2), 1805,1-1825,1, 2155-2170, 2620-2640, 3460-3600 | 2019, 2021, 2023 |
| VODAFONE ESPAÑA, S.A.U. - 86040 | mismo punto | PZ EUSEBI GÜEL, 1 | 842-852, 1825,1-1845,1 | 2023 |
| VODAFONE ESPAÑA, S.A.U. - 086040 | mismo punto | CL JORDI GIRONA, 1 | 768-778, 949,9-959,9 | 2019, 2022 |
| ORANGE ESPAGNE, S.A.U. - CATR0508Z | 2.116000, 41.384083 | AV DIAGONAL, 647 | 9 rangos, de 758-768 a 3600-3700 | de 2004 a 2022 |
| TELEFONICA MOVILES ESPAÑA, S.A.U. - 0800942 | 2.113886, 41.390648 | VP Eusebi G³ell, 6 | 1805,1-1825,1; 1910-1915 + 2155-2170 | 2009, 2022 |
| DS MOBILE NETWORKS, S.L. - 0800143 (Digi) | 2.096728, 41.36731 | VP Esplugues, 28. L'Hospitalet | 1845,1-1855,1, 2110-2120 | 2026 |

Plaza Eusebi Güell 1 es la entrada de Campus Nord. Tres operadores y cuatro registros comparten exactamente las mismas coordenadas, con direcciones distintas para el mismo punto. «G³ell» es un error de codificación que viene así de origen.

### Inferido

- **Año del expediente.** Las referencias tienen la forma `PPPP-AANNNNN`: provincia (`B B ` para Barcelona, `AVAV` para Ávila) y un número que empieza por los dos últimos dígitos del año. Encaja con todo lo visto: Digi, que no tuvo red propia hasta 2024, solo tiene expedientes `26…`. Es la única pista de fecha que da el registro, y es una cota inferior de cuándo se autorizó esa banda, no de cuándo se instaló o se desmontó.
- **Tecnología a partir de la banda.** Se puede deducir de forma aproximada. Ojo con la banda de 800 MHz, porque el registro da el rango de **subida** (832-862), no el de bajada (791-821). Las demás bandas aparecen con el rango de bajada.

  | Rango publicado (MHz) | Banda | Uso habitual en España |
  |---|---|---|
  | 758-788 | 700 (n28) | 5G |
  | 832-862 | 800 (B20), subida | 4G |
  | 925-960 | 900 (B8) | 2G, 3G, 4G |
  | 1805-1880 | 1800 (B3) | 4G, algo de 2G |
  | 1900-1920 y 2110-2170 | 2100 (B1) | 3G, 4G |
  | 2620-2690 | 2600 (B7) | 4G |
  | 3400-3800 | 3500 (n78) | 5G |

  Un expediente «es» una banda y una tecnología, según el ministerio, pero Infoantenas no enseña cuál. Con DSS o reasignaciones la tabla puede fallar, así que en Celda la tecnología sacada de la banda debe marcarse como estimación.
- **Registros duplicados.** Vodafone publica a menudo varios registros en el mismo punto con códigos que solo se diferencian en ceros a la izquierda (`647`, `00647`, `000647`; `11481`, `011481`), cada uno con expedientes distintos. En Barcelona hay 226 pares operador-punto con más de un registro (256 registros de más). Parecen restos de codificaciones antiguas del operador. No son estaciones base distintas.
- **Nombres de operador.** Aparecen `VODAFONE ESPAÑA, S.A.U.` y `VODAFONE ESPAÑA, S.A.` (84 registros en Barcelona), y Orange sigue como `ORANGE ESPAGNE, S.A.U.` pese a la fusión en MasOrange. `XFERA MÓVILES` (Yoigo) casi no aparece: 3 registros en toda la zona y ninguno en Barcelona. `DS MOBILE NETWORKS, S.L.` es la sociedad de red de Digi ([bandaancha.eu](https://bandaancha.eu/articulos/digi-tomado-posesion-frecuencias-moviles-11166), fuente secundaria). Hay que normalizar a una marca comercial.

## 2. Cómo se accede

### Comprobado

No hay descarga masiva ni API publicada. La página del servicio en digital.gob.es solo enlaza la versión cartográfica (`vcne.do`) y la versión solo texto (`visorAccesible.do`, búsqueda por provincia, municipio y calle). datos.gob.es no tiene ningún conjunto del ministerio sobre antenas. La búsqueda de títulos con «antenas», «telefonía», «infoantenas» y «estaciones radioeléctricas» en su API (`/apidata/catalog/dataset/title/…`) solo devuelve conjuntos municipales o sin relación. En 2021 alguien pidió en datos.gob.es [una API o base de datos de las antenas de Infoantenas](https://datos.gob.es/es/solicitud-de-datos/base-de-datos-api-de-la-ubicacion-antenas-gsm). Consta como «No viable». El ministerio respondió que los datos están en SIGETEL/RENAFE, que por el artículo 8 del RD 123/2017 «no se puede facilitar información de los datos inscritos» y que Infoantenas solo sirve para informar a los ciudadanos sobre niveles de exposición.

El visor usa OpenLayers 2 y lee dos endpoints internos. Ninguno pide clave ni cookie, aunque el servidor pone un `JSESSIONID`.

**Listado por bbox**

```
GET https://geoportal.minetur.gob.es/VCTEL/infoantenasGeoJSON.do?idCapa=null&bbox=W,S,E,N&zoom=Z
```

- `bbox` en grados, EPSG:4258, orden oeste, sur, este, norte. Es el `map.getExtent()` del visor.
- `zoom` no influye en la respuesta. La misma bbox con `zoom=1` y `zoom=7` devolvió exactamente los mismos 1000 elementos. El visor solo pide datos a partir del nivel 13 de su mapa, pero ese límite es del cliente, no del servidor.
- Respuesta `application/x-json;charset=ISO-8859-1`. Hay que decodificar en Latin-1.
- **Tope de 1000 elementos sin paginación ni aviso.** La respuesta truncada va ordenada por `id` (operador y código), así que los últimos operadores en orden alfabético (Vodafone, Xfera) son los que se pierden. No hay parámetros de página.
- Una bbox sin estaciones devuelve `{}`, no una `FeatureCollection` vacía (`muestras/geojson-vacio.json`).
- Tiempo de respuesta entre 0,2 y 1,1 s, y unos 615 bytes por elemento. La bbox de Barcelona truncada ocupa 617 KB.
- Sin `ETag`, `Last-Modified`, `Cache-Control` ni compresión (con `Accept-Encoding: gzip` responde sin comprimir). `HEAD` devuelve 405.

**Ficha de la estación**

```
GET https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?emplazamiento=<Gis_ID>&codEmplazamiento=<id>
```

- `codEmplazamiento` es el `id` completo codificado en **UTF-8** (`ESPA%C3%91A`). Si se codifica en Latin-1 (`ESPA%D1A`) responde HTTP 200 con el texto «Código de emplazamiento no válido» (`muestras/detalle-codigo-no-valido.iso-8859-1.html`). Hay que detectar ese caso por el contenido, no por el código HTTP.
- HTML en ISO-8859-1, de 8 a 10 KB, con las mismas cabeceras que el listado.
- El pie de la ficha todavía dice «Ministerio de Economía y Empresa», un nombre de 2018 a 2020.

**Recuento por teselas.** `muestras/herramientas/quad.py` divide cada bbox en cuatro mientras la respuesta llegue a 1000. Con una pausa de 3 s:

- bbox de Barcelona (`2.052,41.317,2.229,41.468`): 5 peticiones, 2380 elementos únicos;
- bbox del AMB (`1.92,41.24,2.30,41.58`): 17 peticiones, 3801 elementos únicos.

El registro de peticiones está en `muestras/teselas-area-barcelona.json`. Los elementos del borde entre dos teselas pueden salir en las dos, así que hay que deduplicar por `id`.

### Inferido

- La bbox incluye los bordes, por eso sale algún elemento repetido entre teselas vecinas (1 en Barcelona, 1 en el AMB).
- Los endpoints son internos del visor y la nota legal avisa de que el ministerio «no garantiza la continuidad en la puesta a disposición de los documentos reutilizables, ni en contenido ni en forma». Pueden cambiar sin aviso.
- Para toda España harían falta cientos de teselas. Según una fuente secundaria ([genbeta](https://www.genbeta.com/herramientas/este-mapa-nos-indica-todas-antenas-moviles-que-hay-a-nuestro-alrededor-radiacion-que-generan-asi-funciona)) hay más de 69.000 estaciones. No lo he comprobado.

### Certificado del geoportal

Comprobado el 01/10/2026, después de que la primera noche en el portátil de producción fallara en todas las zonas con `FuenteNoDisponible: TransportError (https://geoportal.minetur.gob.es/robots.txt)`.

- `geoportal.minetur.gob.es` entrega solo su certificado, sin el intermedio que lo firma. `openssl s_client -showcerts` enseña un único certificado, `CN=geoportal.minetur.gob.es`, emitido por `C=ES, O=FNMT-RCM, OU=AC Componentes Informáticos`, válido del 08/10/2025 al 08/10/2026. OpenSSL, curl y Node lo rechazan con «unable to get local issuer certificate». Los navegadores no lo notan porque buscan el intermedio por su cuenta.
- El certificado del geoportal dice dónde está el intermedio (AIA, «CA Issuers»): `http://www.cert.fnmt.es/certs/ACCOMP.crt`. La FNMT publica el mismo fichero en [su página de certificados raíz](https://www.sede.fnmt.gob.es/descargas/certificados-raiz-de-la-fnmt), como «AC Componentes Informáticos» (`AC_Componentes_Informaticos_SHA256.cer`). Los dos son idénticos:
  - huella SHA-256 `F0:38:42:1F:07:F2:0D:63:A2:0D:36:91:E5:A1:78:AB:84:59:EB:E5:70:C1:64:7B:76:90:55:4E:F2:38:76:AB`;
  - válido del 24/06/2013 al **24/06/2028**, autoridad intermedia (`CA:TRUE, pathlen:0`);
  - su identificador de clave (`19:F8:58:2F:…:83:65`) es el identificador de la clave del emisor en el certificado del geoportal.
- Lo firma `AC RAIZ FNMT-RCM` (huella SHA-256 `EB:C5:57:0C:…:9B:93:FA`, válida hasta el 01/01/2030). `openssl verify` con esa raíz lo acepta. Esa raíz está en el almacén de Mozilla (informe de certificados incluidos del CCADB) y en `tls.rootCertificates` de Node 24.20.

Qué hace Celda. El intermedio va en el código, en PEM, en `packages/ingesta/src/registro-oficial/intermedio.ts`, con su huella. Solo lo usa el cliente HTTP del registro oficial en la ingesta nocturna, el del listado y las fichas (`apps/nocturna/src/conexionDelRegistro.ts`). Ese cliente confía en las raíces de siempre de Node (`tls.getCACertificates("default")`: las de Mozilla, más `NODE_EXTRA_CA_CERTS` si se da) y lleva además el intermedio, para que OpenSSL complete la cadena cuando el geoportal no lo envía. El intermedio no es una raíz: una cadena que llegue a él tiene que seguir hasta `AC RAIZ FNMT-RCM`, y un certificado de otra autoridad que llegue sin su cadena se sigue rechazando. La verificación no se desactiva en ningún momento. El resto de fuentes y la publicación siguen con el `fetch` de siempre.

Por qué en el repositorio y no en el sistema o en `NODE_EXTRA_CA_CERTS`: es un arreglo para una sola fuente, y así viaja con el código, se prueba y no cambia la confianza del resto del proceso ni de la máquina. Tampoco se descarga el intermedio en cada noche siguiendo el AIA: sería una petición más, por HTTP sin cifrar.

Cuándo revisarlo:

- Antes del 24/06/2028, cuando caduca el intermedio. Una prueba (`intermedio.test.ts`) falla desde 90 días antes. Se descarga el nuevo de las dos direcciones de arriba, se comprueba que coinciden y que los firma una raíz de Mozilla, y se cambian el PEM, la huella y esta sección.
- Cuando el ministerio renueve el certificado del geoportal (el de ahora caduca el 08/10/2026), si el nuevo lo emite otra autoridad intermedia. Se nota porque la noche vuelve a fallar con «el certificado del servidor no se pudo verificar, falta el certificado de su emisor».
- Si el geoportal pasa a enviar la cadena completa, el intermedio sobra, pero no molesta.

Inferido: la noche del 30/09/2026 la ingesta funcionó desde otra máquina de la misma red. Probablemente el dominio tiene detrás varios servidores y no todos envían la cadena completa. No lo he podido confirmar desde fuera.

## 3. Licencia y reutilización

### Comprobado

- Ni el visor, ni la ficha, ni la página del servicio muestran licencia o aviso legal propio. `geoportal.minetur.gob.es` no enlaza ninguna nota legal.
- La [nota legal de digital.gob.es](https://digital.gob.es/nota-legal) fija las condiciones generales de reutilización del ministerio. Permite la reutilización comercial y no comercial, incluida la «copia, difusión, modificación, adaptación, extracción, reordenación y combinación de la información», con estas condiciones:
  - no desnaturalizar el sentido de la información;
  - citar la fuente, por ejemplo «Origen de los datos: Ministerio para la Transformación Digital y de la Función Pública»;
  - mencionar la fecha de la última actualización si el documento la incluye;
  - no sugerir que el ministerio patrocina o apoya la reutilización;
  - conservar los metadatos de fecha y condiciones, si los hay.
- La [Ley 37/2007](https://www.boe.es/buscar/act.php?id=BOE-A-2007-19814), en su redacción de 2021:
  - artículo 4.1: los documentos del sector público «serán reutilizables», con o sin condiciones;
  - artículo 4.4: la Administración no puede usar el derecho *sui generis* sobre bases de datos para impedir la reutilización;
  - artículo 3.3: excluye los documentos con el acceso limitado y los sometidos a confidencialidad comercial;
  - artículo 8: enumera las condiciones posibles, las mismas que la nota legal.
- El artículo 8.2 del RD 123/2017 restringe el acceso a los datos del Registro Nacional de Frecuencias que no sean públicos. Lo que Infoantenas publica ya es público.

### Inferido

- Lo que muestra Infoantenas se puede reutilizar y redistribuir en capas públicas bajo las condiciones generales del ministerio. En la práctica equivale a una CC BY con la condición de no desnaturalizar. No hay cláusula de «compartir igual», así que no contamina las capas como la CC BY-SA de OpenCelliD.
- Atribución propuesta, en la ficha y en los créditos del mapa: «Origen de los datos: Ministerio para la Transformación Digital y de la Función Pública (Infoantenas), consultado el DD/MM/AAAA». El registro no publica fecha de actualización, así que se da la fecha de extracción y se dice que es eso.
- «No desnaturalizar» afecta a Celda. Si se corrige un emplazamiento con antenasmoviles.es, la ficha tiene que mostrar las dos versiones y no presentar la corrección como dato del ministerio. La arquitectura ya lo pide.
- El riesgo es la postura del ministerio, que en 2021 dijo que Infoantenas solo es para informar sobre exposición y se negó a dar la base de datos. No prohíbe reutilizar lo publicado, pero conviene escribir a `emisionesysalud@economia.gob.es`, el buzón que da la página del servicio, para confirmarlo antes del lanzamiento público. Esa decisión corresponde al usuario.

## 4. Actualización y detección de cambios

### Comprobado

- Ninguna página ni respuesta da fecha de actualización, frecuencia de publicación ni fecha de las medidas.
- Hay expedientes recientes. En la muestra de 23 fichas de Campus Nord hay referencias `25…` y `26…` (Vodafone 000715 y 54846, Digi 0800143). Así que el registro recibe altas de 2025 y 2026.
- Sin `ETag` ni `Last-Modified`. `HEAD` no está permitido.
- La ayuda del visor habla de operadores «vigentes» y la resolución de 2021 de «expedientes vigentes».

### Inferido

- La desactualización que describe la spec, con antenas desmontadas que siguen y antenas nuevas que faltan, tiene más sentido como desfase entre el registro administrativo y lo que hay en el tejado. Un expediente sigue «vigente» aunque se desmonten las antenas, y una estación nueva no aparece hasta que se autoriza. El registro parece al día con sus expedientes, pero eso no garantiza que refleje lo instalado. antenasmoviles.es cubre justo ese hueco.
- El identificador estable es el `id` del Feature (`OPERADOR - código`). `Gis_ID` solo no basta. Si un operador cambia de razón social, cambian todos sus `id`. Hay que normalizar el operador antes de construir la clave interna y conservar el `id` original como referencia a la fuente.
- Como no hay fechas ni ETag, los cambios solo se detectan comparando instantáneas:
  - listado: conjunto de `id` y un hash de coordenadas y dirección;
  - ficha: hash de la lista ordenada de pares (referencia, banda).
- Una referencia nueva en una ficha es un alta de banda con un año aproximado. Una referencia que desaparece es una baja.

## 5. Tamaño del área de Barcelona

### Comprobado

Instantánea del 26/09/2026. El municipio sale del texto de `Dirección`, porque la bbox también recoge municipios vecinos.

| Zona | Registros | Pares operador-punto | Puntos distintos |
|---|---|---|---|
| Barcelona (municipio) | 1784 | 1528 | 1074 |
| AMB (36 municipios, bbox aproximada) | 3172 | 2692 | 1806 |

Por operador, en Barcelona: Telefónica 701, Vodafone 624 (540 como S.A.U. y 84 como S.A.), Orange 435, Digi 24 y Xfera 0.

### Inferido

- Si se aplica la regla de fusión de la arquitectura (mismo operador a menos de 60 m), Barcelona tiene unas **1440 estaciones base**: Telefónica 644, Orange 392, Vodafone 382 y Digi 24.
- Si se agrupan los puntos a menos de 60 m sin mirar el operador, salen unos **900 emplazamientos** en Barcelona y unos 1550 en el AMB. Uso un agrupamiento voraz, solo como orden de magnitud.
- La bbox del AMB corta los extremos de Begues y Corbera de Llobregat. Begues no tiene ningún registro en la bbox.
- Encaja con los unos 2000 emplazamientos que la exploración técnica 2 usa para las PMTiles.

## 6. Recomendación para el extractor (ticket 09)

**Endpoints.** `infoantenasGeoJSON.do` para el listado y `detalleEstacion.do` para las fichas, los dos por GET sin clave.

**Descarga.**

1. Listado por teselas con división en cuatro al llegar a 1000 elementos. Conviene fijar una rejilla de partida de 0,05° para que las teselas sean estables y no dependan de la división. Una tesela que devuelva 1000 no se guarda, se divide siempre. `{}` cuenta como vacío. Se decodifica en Latin-1 y se deduplica por `id`.
2. Fichas: las de `id` nuevos o con el listado cambiado, más una rotación que refresque todas en una semana. En Barcelona son unas 1800 fichas, 90 minutos a 1 petición cada 3 s. Repartidas en siete noches salen unas 260 por noche, unos 13 minutos.
3. La ficha se valida por contenido. Si falta la tabla «CARACTERISTICAS» o aparece «Código de emplazamiento no válido», es un error de la fuente y no una estación sin bandas.
4. Una baja solo cuenta si el `id` falta en **dos** barridos seguidos, para que un fallo puntual del servidor no borre emplazamientos.

**Límites propios.**

- Una sola conexión y al menos 3 s entre peticiones.
- Ejecución nocturna y un máximo de 300 peticiones por ejecución.
- `User-Agent` identificable y un interruptor por fuente.
- Si hay 3 errores o respuestas de más de 10 s seguidas, se para la ejecución y se registra el fallo en el estado de la ingesta.
- No hay ETag que aprovechar. La caché es la instantánea anterior, guardada en R2.

**Mapeo al glosario.**

| Glosario | Del registro | Notas |
|---|---|---|
| Observación | un registro (`Feature` y su ficha) | fuente «registro oficial», fecha = **fecha de extracción**, URL = ficha. Se guarda el `id` original. |
| Operador | prefijo de `id`, normalizado | Telefónica, Vodafone (S.A. y S.A.U.), Orange (MasOrange), Digi (DS Mobile Networks), Yoigo (Xfera) |
| Emplazamiento | no existe en la fuente | lo crea la fusión. Las coordenadas idénticas entre operadores (ver Campus Nord) son una señal fuerte de emplazamiento compartido. |
| Estación base | varios registros del mismo operador a menos de 60 m | cubre los duplicados de Vodafone (`647`/`00647`/`000647`). Se unen sus bandas. |
| Banda | «Banda asignada» → tabla del apartado 1 | se guarda el rango original y la banda deducida. La banda de 800 viene con el rango de subida. Un rango doble con `;` es una sola entrada. |
| Tecnología | no existe | se deduce de la banda y se marca como estimación |
| Sector | no existe | no hay azimut ni número de sectores. Todos los sectores de Celda son **modelo**. El acimut de los niveles medidos **no** sirve para esto. |
| (sin término) | niveles medidos | fuera de la v1. Si se usan, como «medida de exposición del ministerio», un tipo distinto de las medidas propias. |
| Fecha del dato | año del expediente (inferido) | se puede enseñar «banda autorizada en 2024» si se acepta la inferencia |

**Para cruzar con otras fuentes** (lo aprovecha la investigación de antenasmoviles.es y OpenCelliD):

- Los códigos son los del operador. Orange usa `CATRnnnnX`, Telefónica y Digi `08nnnnn` (`08` es la provincia) y Vodafone números de 3 a 6 cifras. Si antenasmoviles.es muestra los mismos códigos, se puede unir por código además de por distancia.
- En la bbox del AMB, Digi aparece en 77 de sus 78 registros con el **mismo código y las mismas coordenadas** que Telefónica, lo que cuadra con sus acuerdos de red con Movistar.
- OpenCelliD no trae operador por nombre sino MCC/MNC. Hay que mapear 214-07 (Telefónica), 214-01 (Vodafone), 214-03 (Orange), 214-04 (Yoigo) y 214-22 (Digi) a los mismos operadores normalizados. Estos códigos los pongo de memoria y hay que comprobarlos en la investigación de OpenCelliD.

## Riesgos

- Truncado silencioso a 1000 elementos. Si una tesela se descarga sin dividir, faltan operadores enteros sin ningún error.
- Endpoints internos sin contrato. Pueden cambiar o desaparecer. Las pruebas de la ingesta deben usar las muestras grabadas y avisar si el formato cambia.
- Cadena de certificados incompleta: el geoportal no siempre envía el intermedio de la FNMT, y Celda lo lleva en el código (ver «Certificado del geoportal»). Caduca el 24/06/2028.
- Postura del ministerio sobre reutilización: sin licencia explícita y con una negativa de 2021 a dar la base de datos.
- Calidad de origen: codificación mezclada (`G³ell`), direcciones distintas para el mismo punto, razones sociales antiguas y registros duplicados.
- Sin fechas: la ficha no puede decir «actualizado el…» del registro, solo «extraído el…».
- El registro no dice nada de sectores ni tecnologías. Todo lo que Celda enseñe sobre eso a partir de esta fuente es modelo o estimación.

## Muestras grabadas (`muestras/`)

Todas son del 26/09/2026. Los ficheros `.iso-8859-1.*` son los bytes exactos de la respuesta, sin volver a codificar.

| Fichero | Contenido |
|---|---|
| `geojson-campus-nord.iso-8859-1.json` | listado de la bbox `2.105,41.382,2.125,41.392` (40 elementos, 24 KB) |
| `geojson-vacio.json` | respuesta de una bbox sin estaciones (`{}`) |
| `detalle-orange-CATR0228A.iso-8859-1.html` | ficha con 6 expedientes y 6 medidas |
| `detalle-telefonica-0800942.iso-8859-1.html` | ficha con una banda doble (`1910.00 - 1915.00; 2155.00 - 2170.00`) |
| `detalle-digi-0800143.iso-8859-1.html` | ficha de Digi con expedientes de 2026 |
| `detalle-codigo-no-valido.iso-8859-1.html` | respuesta 200 de error por codificar mal `codEmplazamiento` |
| `fichas-campus-nord.json` | 23 fichas convertidas a JSON (UTF-8), útiles como resultado esperado del analizador |
| `teselas-area-barcelona.json` | peticiones y recuentos de las descargas por teselas |
| `herramientas/quad.py`, `herramientas/det.py` | scripts usados para el recuento y las fichas |
