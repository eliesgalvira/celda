# Provincias y municipios del IGN como zonas, con el padrón del INE

Estado: aceptada el 28/09/2026 con el #37, que descarga los límites y el padrón y pone el municipio y la provincia en la ficha. El umbral de ausencias lo decidió el usuario el mismo día. Sale de la investigación de la ampliación a toda España (`docs/investigacion/espana.md`, apartado 4). Amplía la parte de barrios del ADR 0004 y la zona del ejercicio de emplazamientos.

## Contexto

Hoy la única zona es el barrio de Barcelona: el mapa enseña en un nivel el número de emplazamientos y las ausencias de cada uno, y el ejercicio de emplazamientos se hace sobre un barrio con el padrón de Open Data BCN. El ADR 0004 descartó agrupar por municipio porque la caja de datos cortaba los municipios de alrededor. Con toda España cada municipio está entero en los datos.

Las fuentes, medidas el 28/09/2026:

- **Límites:** Base de Datos de Límites Jurisdiccionales del IGN, por su servicio ATOM, sin formulario (66 MB). CC BY 4.0, con la atribución «Obra derivada de <producto> <fecha> CC-BY 4.0 ign.es» a pie de mapa y en los metadatos. 8.132 municipios, 81 territorios compartidos sin municipio y 52 provincias.
- **Población:** INE, cifras oficiales del padrón por municipio (tabla 29005, a 1 de enero de 2025), por su API o en CSV. CC BY 4.0, «Elaboración propia con datos extraídos del sitio web del INE», con la fecha. Los 8.132 códigos coinciden con los del IGN.

## Decisión

- **El publicador pone a cada emplazamiento su municipio**, por punto en polígono con los límites simplificados a 50 m y con la misma regla de bordes que los barrios. La provincia son los dos primeros dígitos del código INE del municipio. Un emplazamiento en un territorio compartido va sin municipio; uno en el mar cerca de la costa va al municipio más cercano, como mucho a 200 m.
- Los límites se descargan con una orden de `tools/capas`, como los barrios, y van en git simplificados: unos 6 MB con gzip a 50 m. La descarga no es parte de la ingesta.
- **La web recibe tablas, no polígonos.** Por provincia: nombre, punto de etiqueta, número de emplazamientos y compañías presentes. Por municipio: lo mismo y sus habitantes, en el fichero de su provincia. Con eso se calculan en el navegador el número y las ausencias, como hoy `resumirBarrios`.
- **Niveles de zona en el mapa:** provincias en los zooms bajos, municipios en los medios y, dentro del municipio de Barcelona, sus barrios.
- **Ausencias solo donde dicen algo.** Un municipio con muy pocos emplazamientos «no tiene» casi todas las compañías, y eso no es un hueco de cobertura. Las ausencias se enseñan en los municipios con 10 emplazamientos o más; en el resto, solo el número. El umbral lo decidió el usuario el 28/09/2026.
- **Ejercicio de emplazamientos:** la zona es un barrio en Barcelona y un municipio en el resto, con la población del padrón del INE. El área va en la tabla. El contorno de la zona, si se dibuja, se descarga al abrir el ejercicio: el de su provincia a 200 m, de 36 a 54 KB con gzip.
- El glosario cambia: **Zona** pasa a ser un barrio, un municipio o una provincia, y **Ausencia** se define por zona en lugar de por barrio.

## Cómo quedó (#37)

- **La orden** es `pnpm run municipios` en `tools/capas`, y escribe `convex/datos/municipios.json` y `convex/datos/padron.json`. Lee el `robots.txt` de cada sitio y hace siete peticiones como mucho. Del IGN pide el canal ATOM, del que toma el nombre del producto, los derechos y la fecha, y después el ZIP, que guarda en `~/.cache/celda` con la fecha en el nombre para no volver a pedirlo. Del INE pide el aviso legal, para comprobar que sigue en CC BY 4.0, y el CSV de la tabla 29005, cuya cabecera `Last-Modified` da la fecha de publicación. Si algo no cuadra, no escribe nada.
- **El padrón sale del CSV de `www.ine.es`**, no de la API. `servicios.ine.es` corta la conexión al pedir su `robots.txt`, así que no se pueden leer sus reglas, y el `robots.txt` de `www.ine.es` deja pedir `/jaxiT3/`.
- **Límites y padrón se cruzan por código INE** y la orden falla si un municipio de un lado no está en el otro. Un municipio nuevo con límites y sin padrón para la orden: los ficheros del repositorio se quedan como estaban hasta que el INE publique el padrón con él.
- **Simplificación.** Los recintos se parten en arcos por los vértices donde se juntan tres o más, así el límite entre dos vecinos es un solo arco. Cada arco se simplifica con Douglas-Peucker a 50 m y se guarda en cienmilésimas de grado. Son 31.048 arcos y 368.943 vértices: 5,2 MB en git, 1,8 MB con gzip, con un recinto o un arco por línea. Con 20.000 puntos al azar, el municipio sale distinto del de los límites completos en el 0,37 % de la provincia de Barcelona y en el 0,25 % de la península, siempre a menos de 50 m de un límite.
- **Territorios compartidos y sin provincia.** Un emplazamiento en un territorio compartido va sin municipio pero con la provincia que da el código del IGN. La capa por provincias del ADR 0016 necesita una provincia para cada emplazamiento. En uno de los siete territorios sin provincia (Gibraltar, las plazas de soberanía, la isla de los Faisanes) no lleva ninguna de las dos cosas, y el mar junto a ellos tampoco.
- **Dónde llega.** La ficha tiene un campo opcional `lugar` con el municipio y la provincia. El lote de fichas cita la fuente una vez (`fuenteDeLugares`), y la web la pone al final de «De dónde salen los datos» con la forma que piden las condiciones del IGN. La capa no cambia de formato: la columna del municipio, las tablas por provincia y el crédito del IGN a pie de mapa llegan con el #43. Para ellos están `municipioDelPunto` y `municipiosConHabitantes` en `packages/dominio/src/municipio.ts`.
- **El producto** se cita con el título del canal, «Base de Datos de Límites Jurisdiccionales de España», porque sigue sin estar claro que «BDLJE» sea su identificador oficial.

## Consecuencias

- Los créditos del mapa suman el IGN y, en el ejercicio, el INE.
- El padrón se actualiza una vez al año, hacia diciembre, con una orden a mano como la de los barrios.
- Un municipio nuevo puede tener límites antes que población. El ejercicio lo dice en lugar de dividir por cero.
- Si cambian los límites y no los datos, pasa lo mismo que con los barrios: la versión ya existe con otro contenido y hay que esperar a la siguiente ingesta con cambios (ADR 0004).

## Alternativas descartadas

- **Mandar los polígonos a la web.** Todos los municipios a 200 m son 871 KB con gzip en TopoJSON, más que la capa entera.
- **Secciones censales.** Hay población y límites en el INE, pero para el ejercicio basta el municipio, y en el mapa serían 36.000 zonas.
