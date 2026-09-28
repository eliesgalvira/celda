# Provincias y municipios del IGN como zonas, con el padrón del INE

Estado: propuesta (28/09/2026). Sale de la investigación de la ampliación a toda España (`docs/investigacion/espana.md`, apartado 4). Amplía la parte de barrios del ADR 0004 y la zona del ejercicio de emplazamientos.

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
- **Ausencias solo donde dicen algo.** Un municipio con muy pocos emplazamientos «no tiene» casi todas las compañías, y eso no es un hueco de cobertura. Las ausencias se enseñan en los municipios con al menos 10 emplazamientos; en el resto, solo el número. El umbral lo decide el usuario al aceptar esta propuesta.
- **Ejercicio de emplazamientos:** la zona es un barrio en Barcelona y un municipio en el resto, con la población del padrón del INE. El área va en la tabla. El contorno de la zona, si se dibuja, se descarga al abrir el ejercicio: el de su provincia a 200 m, de 36 a 54 KB con gzip.
- El glosario cambia: **Zona** pasa a ser un barrio, un municipio o una provincia, y **Ausencia** se define por zona en lugar de por barrio.

## Consecuencias

- Los créditos del mapa suman el IGN y, en el ejercicio, el INE.
- El padrón se actualiza una vez al año, hacia diciembre, con una orden a mano como la de los barrios.
- Un municipio nuevo puede tener límites antes que población. El ejercicio lo dice en lugar de dividir por cero.
- Si cambian los límites y no los datos, pasa lo mismo que con los barrios: la versión ya existe con otro contenido y hay que esperar a la siguiente ingesta con cambios (ADR 0004).

## Alternativas descartadas

- **Mandar los polígonos a la web.** Todos los municipios a 200 m son 871 KB con gzip en TopoJSON, más que la capa entera.
- **Secciones censales.** Hay población y límites en el INE, pero para el ejercicio basta el municipio, y en el mapa serían 36.000 zonas.
