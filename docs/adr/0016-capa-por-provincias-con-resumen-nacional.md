# Capa por provincias con resumen nacional, indexada en un Worker

Estado: propuesta (28/09/2026). Sale de la investigación de la ampliación a toda España (`docs/investigacion/espana.md`, apartado 3). Si se acepta, cambia el formato de la capa y la parte del ADR 0004 que reservaba PMTiles para más de 20.000 emplazamientos.

## Contexto

El ADR 0004 eligió una capa entera en JSON, agrupada en el navegador con supercluster, porque es la única forma de que los puntos se deslicen hacia su hexágono al alejar y salgan de él al acercar. Dejó PMTiles para cuando la capa pasara de unos 20.000 emplazamientos.

Toda España son unos 42.900 emplazamientos. El 28/09/2026 medí tres formas de servirlos en Chromium sin interfaz con GPU (Vulkan), 390 × 844 px, DPR 2,6 y la CPU a ×4, con datos sintéticos de 100.000 y con las posiciones reales de los 42.855 marcadores de antenasmoviles.es. Medianas de tres rondas:

| Con los 42.855 reales | Al abrir | Primer marcador | Índice en el hilo principal | Alejar hasta España: fps y fotogramas de más de 50 ms |
|---|---|---|---|---|
| Capa única en JSON, como hoy | 301 KB, 1 petición | 965 ms | 414 ms | 51, 9 |
| Capa única, índice en un Worker | 301 KB, 1 | 865 ms | 17 ms | 51, 9 |
| Resumen nacional y una capa por provincia, índice en un Worker | 20 KB, 2 | 410 ms | 1 ms | 55, 5 |
| PMTiles con agrupaciones de tippecanoe y símbolos | 25 KB, 7 | 1.187 ms | 0 | 60, 0 |

Con 100.000 sintéticos, la capa única tarda 1.040 ms en indexarse en el hilo principal y baja a 41 fps al alejar; por provincias con el Worker, 52 fps. Los bytes son los del formato del banco, sin claves; en el formato 4 real la capa única de España pesa 522 KB con gzip. La tabla completa y cómo se midió están en la investigación.

## Decisión

- **La capa de una versión son varios ficheros:**
  - un resumen nacional con una fila por provincia: código INE, nombre, etiqueta, caja de sus emplazamientos, número, compañías presentes y el nombre del fichero de su capa;
  - una capa por provincia, con las columnas del formato 4 más el municipio;
  - la tabla de municipios de cada provincia, con sus habitantes (ADR 0017).

  El formato pasa a 5. `vigente.json` apunta al resumen.
- **Por debajo del zoom 8**, la web solo dibuja el resumen: un hexágono por provincia con su número y sus ausencias.
- **Desde el zoom 8** pide las provincias cuya caja corta la vista con margen y las indexa. Mientras una no ha llegado, se ve su hexágono del resumen, nunca un hueco. Una provincia leída se queda durante la visita.
- **Índice en un Worker.** supercluster 9.1 guarda cada nivel en un KDBush sobre búferes que se pueden transferir. El Worker construye el índice y devuelve los búferes, y el hilo principal lo rehidrata sin volver a agrupar. Las escenas y las transiciones siguen siendo síncronas, que es lo que hizo descartar el Worker en `docs/patterns/rendimiento.md`. Con 100.000 emplazamientos la rehidratación cuesta 45 ms en el hilo principal, frente a 1.040 ms de construir el índice allí.
- **Transición fiel donde hay detalle.** Entre dos niveles del 8 hacia arriba, la jerarquía de supercluster de cada provincia dice a qué hexágono va cada emplazamiento, como hoy. Entre el resumen y el detalle, cada elemento sale del hexágono de su provincia o va a él. En el borde entre dos provincias pueden quedar dos hexágonos cerca uno del otro, uno de cada una: cada uno cuenta bien los suyos.
- **Fichas por provincia.** Los lotes de 128 se hacen dentro de cada provincia, ordenados por la curva de Hilbert como hoy, y se nombran por su contenido. Una publicación solo escribe los de las provincias que cambian.

## Consecuencias

- Abrir la web descarga el resumen (2 KB con gzip) y las provincias de la vista inicial, no toda España.
- Buscar un emplazamiento por su clave ya no puede recorrer toda la capa en el navegador. Hace falta un índice de claves por provincia en el resumen, o buscar solo en las provincias cargadas y decirlo.
- La vista de interferencia y las celdas se calculan con las provincias cargadas. En el borde de una provincia sin cargar faltarían vecinos, así que hay que cargar también las provincias vecinas antes de calcular.
- La agrupación sigue dependiendo de detalles internos de supercluster 9.1: `_getOriginZoom` y, ahora, la forma de sus árboles. La versión sigue fijada y una prueba compara las escenas del índice rehidratado con las del construido en el hilo.
- El resumen es una segunda fuente de verdad para los números por provincia. Sale de la misma instantánea en la misma publicación, así que no puede discrepar de las capas de su versión.

## Alternativas descartadas

- **Una capa entera en JSON, como hoy.** Con los 42.900 reales pesa 522 KB con gzip en el formato 4, la primera vez tarda en pintar el doble que por provincias, y al alejar hasta España pierde fotogramas. Con el índice en un Worker el hilo principal se libra de agrupar, pero la descarga y el análisis del JSON siguen siendo de toda España.
- **PMTiles.** Es lo más fluido con diferencia, pero las agrupaciones de tippecanoe no tienen relación entre niveles y se cortan en los bordes de tesela, así que la transición no puede ser fiel (exploración 03). Además, 16 a 32 MB y 140.000 a 293.000 teselas por versión no caben en la copia de Vercel.
- **PMTiles para la vista de país y JSON por provincias para el detalle**, la propuesta de la exploración 03. El resumen de provincias hace lo mismo con 2 KB y sin teselas.
