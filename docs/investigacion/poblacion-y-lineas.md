# Habitantes por barrio y líneas móviles por compañía

Consultado el 26/09/2026. Son los datos que usa el ejercicio de emplazamientos del modo estudiante (`packages/dominio/src/ejercicio.ts`) para pasar de habitantes a usuarios por estación base.

## Habitantes: padrón municipal de Open Data BCN

- **Conjunto:** «Població de Barcelona segons el Padró Municipal d'Habitants», `pad_mdbas`, en [Open Data BCN](https://opendata-ajuntament.barcelona.cat/data/es/dataset/pad_mdbas).
- **Licencia:** CC BY 4.0 (`license_id` del conjunto). Se cita como «Ajuntament de Barcelona», con la licencia y la fecha, igual que los límites de barrio.
- **Contenido:** un CSV por año con los habitantes a 1 de enero de cada sección censal, con su barrio (`Codi_Barri`, `Nom_Barri`) y el valor en `Valor`. El de 2026 (`2026_pad_mdbas.csv`, publicado el 28/05/2026) tiene 1068 secciones y suma 1.729.963 habitantes en los 73 barrios.
- **Cómo se descarga:** `pnpm run poblacion` en `tools/capas`. Hace dos peticiones con 10 s entre ellas, el `Crawl-delay` del `robots.txt` del portal: los metadatos del conjunto por su API CKAN (`package_show`), para la licencia y el CSV más reciente, y el CSV. Suma las secciones por barrio, calcula el área con los límites de `datos/barrios.json`, simplifica el límite a 6 m para dibujarlo y escribe `apps/web/src/ejercicio/poblacion.json`. Falla si cambia la licencia, si falta una columna, si un barrio no tiene habitantes o si aparece uno que no está en los límites.
- **Cuándo:** una vez al año, cuando sale el padrón nuevo (finales de mayo). No es parte de la ingesta.
- **En la web:** el fichero va en un trozo aparte (unos 20 kB comprimido) que solo se descarga al abrir el ejercicio.

El ejercicio usa los habitantes empadronados del barrio entero. No cuenta la población flotante (gente que trabaja o estudia allí), que en barrios como Pedralbes o les Corts puede pesar más que la residente.

Fuera de Barcelona la zona del ejercicio es el municipio, con las cifras oficiales del padrón del INE a 1 de enero de 2025 (tabla 29005) que lleva la capa de cada provincia (ADR 0017). Barcelona se puede hacer por barrio, con el padrón del Ayuntamiento de 2026, o entera, con el del INE de 2025: las dos cifras no coinciden, porque son de años distintos. Las secciones censales del INE siguen fuera.

## Líneas por habitante y cuotas: CNMC

Son parámetros que el estudiante puede cambiar. El valor por defecto es el último publicado por la CNMC para toda España:

- **Fuente:** nota de prensa «[Estadísticas telecomunicaciones, julio 2026](https://www.cnmc.es/prensa/datos-telecos-julio-20260923)», publicada el 23/09/2026, con datos de julio de 2026. La nota permite reproducir los datos citando la fuente.
- **Penetración:** «La penetración fue de 128,3 líneas por cada 100 habitantes». Corresponde a los 63,61 millones de líneas móviles, sin las de máquina a máquina.
- **Cuotas de líneas móviles:** Movistar 26,13 %, Vodafone 18,72 %, MasOrange 40,60 %, Digi 12,71 % y resto 1,84 %. El texto de la nota da la suma («Movistar, Vodafone y MASORANGE concentraron el 85,4 %… Si se incluye DIGI… el 98,2 %»); el reparto por compañía está en el gráfico «Cuota de mercado líneas móviles julio 2026» del PDF. Las cinco suman 100 %.

Cómo se usan:

- **Orange y Yoigo van juntas.** Desde abril de 2024 la CNMC da las líneas de MasOrange sin separar Orange de Yoigo. El ejercicio reparte las líneas del grupo entre las estaciones base de las dos compañías en la zona.
- **El resto no se reparte.** El 1,84 % es de operadores virtuales independientes, que usan la red de otra compañía; la estadística no dice de cuál. Los virtuales propiedad de una compañía ya van dentro de su cuota.
- **Es una media de España.** La CNMC no publica penetración por municipio. Su conjunto provincial de [CNMCData](https://data.cnmc.es/telecomunicaciones-y-sector-audiovisual/conjuntos-de-datos/datos-provinciales/telecomunicaciones) (CC BY-SA 4.0) da líneas por compañía y provincia de 2025: en la provincia de Barcelona salen unas 120 líneas por cada 100 habitantes, y cuotas de MasOrange 39,6 %, Movistar 33,4 %, Vodafone 17,9 % y Digi 5,8 %. No se usan por defecto porque son de un año antes y no están en una nota con fecha de publicación que citar; quien quiera usarlas las puede escribir en el ejercicio.

La estimación de tráfico (datos por línea, hora cargada) y la de capacidad quedan fuera de la v1.
