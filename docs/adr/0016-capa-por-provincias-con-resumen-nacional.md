# Capa por provincias con resumen nacional, indexada en un Worker

Estado: aceptada el 29/09/2026 con el #43, que la implementa de punta a punta. Sale de la investigación de la ampliación a toda España (`docs/investigacion/espana.md`, apartado 3). Cambia el formato de la capa y la parte del ADR 0004 que reservaba PMTiles para más de 20.000 emplazamientos. Lo que se decidió al implementarla va en «Cómo quedó». Cambiada en parte por el [ADR 0024](0024-datos-discretos-y-rotulos-sobre-los-datos.md) (03/10/2026): el resumen nacional se dibuja hasta z9 en lugar de z8, el hexágono de cada provincia va en su centro visual y el mapa ya no enseña ausencias.

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
  - un resumen nacional con una fila por provincia: código INE, nombre, etiqueta, caja de sus emplazamientos, número, compañías presentes, si alguna zona de barrido la cubre entera y el nombre del fichero de su capa;
  - una capa por provincia, con las columnas del formato 4 más el municipio;
  - la tabla de municipios de cada provincia, con sus habitantes (ADR 0017).

  El formato pasa a 5. `vigente.json` apunta al resumen.
- **Por debajo del zoom 8**, la web solo dibuja el resumen: un hexágono por provincia con su número y sus ausencias.
- **Provincias sin cubrir.** Mientras la ingesta solo barre Cataluña (ADR 0014), el resto de provincias va en el resumen como no cubiertas. La web las dibuja sin número y, si se acerca a una, dice que Celda aún no la cubre. Nunca pinta un trozo de provincia como si estuviera completo.
- **Desde el zoom 8** pide las provincias cuya caja corta la vista con margen y las indexa. Mientras una no ha llegado, se ve su hexágono del resumen, nunca un hueco. Una provincia leída se queda durante la visita.
- **Índice en un Worker.** supercluster 9.1 guarda cada nivel en un KDBush sobre búferes que se pueden transferir. El Worker construye el índice y devuelve los búferes, y el hilo principal lo rehidrata sin volver a agrupar. Las escenas y las transiciones siguen siendo síncronas, que es lo que hizo descartar el Worker en `docs/patterns/rendimiento.md`. Con 100.000 emplazamientos la rehidratación cuesta 45 ms en el hilo principal, frente a 1.040 ms de construir el índice allí.
- **Transición fiel donde hay detalle.** Entre dos niveles del 8 hacia arriba, la jerarquía de supercluster de cada provincia dice a qué hexágono va cada emplazamiento, como hoy. Entre el resumen y el detalle, cada elemento sale del hexágono de su provincia o va a él. En el borde entre dos provincias pueden quedar dos hexágonos cerca uno del otro, uno de cada una: cada uno cuenta bien los suyos.
- **Fichas por provincia.** Los lotes de 128 se hacen dentro de cada provincia, ordenados por la curva de Hilbert como hoy, y se nombran por su contenido. Una publicación solo escribe los de las provincias que cambian.

## Cómo quedó (#43)

**Ficheros.** Todo lo publica la publicación compartida (`packages/publicacion`, ADR 0015), igual desde Convex que desde la ingesta nocturna:

- `fichas/<provincia>/<huella>.json`: un lote de hasta 128 fichas vecinas de una provincia, con el lugar de cada una. No lleva la versión dentro: se nombra por su contenido (SHA-256, 16 cifras), así que lo comparten las versiones que no cambian la provincia.
- `provincias/<provincia>/<huella>.json`: la capa de una provincia, con las columnas del formato 4 salvo la versión, el municipio de cada emplazamiento y la tabla de municipios de la provincia (habitantes, área, número de emplazamientos y compañías). El lote de cada emplazamiento es la posición de su fichero en la lista de lotes de la capa. Los barrios van solo en la de Barcelona.
- `ficheros@<fecha>.json`: el manifiesto de la versión, con sus capas y sus lotes. La web no lo lee; la retirada de versiones viejas borra solo lo que ya no lista ninguna versión que se queda.
- `resumen@<fecha>.<huella>.json`: el resumen nacional, con la versión como primera clave, las fuentes de las zonas, las zonas barridas y, por provincia, su nombre, su etiqueta, la caja de sus emplazamientos, su número, sus compañías, si está cubierta, su último barrido y su capa. `vigente.json` lleva su nombre y se escribe el último.

**Cobertura.** En vez de «si alguna zona la cubre entera», una provincia está cubierta si se han barrido todos los cuadros con datos (los 94 de `ZONAS_DE_BARRIDO`, ADR 0014) que tocan sus límites; así una provincia repartida entre dos zonas queda cubierta al barrer las dos. Su último barrido es el más reciente de las zonas que barren alguno de sus cuadros o tocan la caja de sus emplazamientos. Con Cataluña barrida quedan cubiertas sus cuatro provincias, y Huesca, Castellón, Teruel y Zaragoza quedan a medias: tienen los emplazamientos de los cuadros de Cataluña que las tocan, que están todos, pero su número no es el de la provincia. La web enseña esas con su número, el borde discontinuo y «solo una parte», y sin ausencias; las que no tienen nada barrido, sin número y «aún no está».

**Una fecha de barrido nueva no es una versión nueva.** La versión sigue siendo la fecha del último cambio en los datos, y la del barrido va en el resumen. Por eso el resumen lleva la huella en el nombre: si una noche barre sin cambiar nada, la publicación rehace el resumen del anterior con la cobertura nueva, sin leer la instantánea, y escribe solo el resumen y `vigente.json` (`tipo: "barrido"`). Publicar otra vez sin otro barrido no escribe nada.

**Emplazamientos sin provincia.** Uno en el mar lejos de la costa o en un territorio sin provincia va a la capa de la provincia de etiqueta más cercana; su ficha sigue diciendo que no tiene ni municipio ni provincia.

**Web.**

- Por debajo del zoom 8 dibuja el resumen (`crearAgrupadorNacional` en `apps/web/src/capa/nacional.ts`). Desde el 8 pide las provincias con capa cuya caja corta la vista con su margen (`provinciasDeLaVista`) y, al abrir, las de la vista inicial en cuanto llega el resumen, sin esperar al mapa.
- **Un índice por provincia, no uno global.** Cada provincia se lee y se agrupa en un solo Worker de capas (`capa/worker.ts`), que devuelve la capa leída y los árboles de supercluster transferidos; el hilo principal los rehidrata (`capa/indice.ts`). Un índice global de las provincias cargadas habría que rehacerlo, entero, cada vez que llega una: con 100.000 emplazamientos son 477 ms de Worker con la CPU a ×4 y 45 ms de rehidratar por cada llegada (investigación 08), frente a lo de la provincia que llega. A cambio, en el borde entre dos provincias puede haber dos hexágonos cerca, uno de cada una, y ningún emplazamiento está en dos (prueba en `nacional.test.ts`).
- Las claves de las agrupaciones y los barrios llevan la provincia (`a:08:123`), así no chocan en la misma escena. La transición es la del agrupador de la provincia donde hay detalle a los dos lados, y desde su hexágono o hacia él cuando un lado es el resumen; también en el mismo nivel, cuando llega una provincia mientras se mira (`pintados.ts` anima entonces aunque no cambie el nivel).
- Mientras llega una provincia se ve su hexágono dentro de lo que se ve de ella, latiendo y con `aria-busy`. Si no llega, la marca de agua lo dice con un reintento y no se vuelve a pedir sola al mover el mapa. Una provincia leída se queda para la visita; si su capa ya no está en el origen, se lee la de la vigente y se marca con su versión, y la marca de agua da entonces la fecha de lo que se ve de la más antigua a la más reciente.
- Fuera de lo barrido, de cerca, la marca de agua dice «Celda aún no tiene datos de aquí». El aviso del punto de referencia (#38) usa las cajas de las zonas barridas del resumen, no la de los emplazamientos.
- Un enlace a una ficha lleva su provincia (`?emplazamiento=…&provincia=08`), que se pide en cuanto llega el resumen. Uno sin ella la busca en el índice de claves (#45).
- La web solo lee el formato 5. Con un `vigente.json` del 4 dice que la capa no es la esperada; la siguiente publicación, aunque la versión sea la misma, publica el 5.

Medidas del 29/09/2026. La tabla completa y cómo repetirlas están en `docs/patterns/rendimiento.md`.

| Chromium con GPU, CPU ×4, 390 px; medianas de 3 rondas | España sintética, 100.000 | Cataluña real, 5.049 | Barcelona real, 1.294 |
|---|---|---|---|
| Primer marcador (hexágono de Barcelona) | 1515 ms | 1509 ms | 1515 ms |
| Primeros emplazamientos o agrupaciones | 2125 ms | 1991 ms | 1941 ms |
| Capas al abrir, con gzip | 226 KB | 50 KB | 28 KB |
| fps: alejar a España · acercar a la calle · alejar a provincias · cruzar provincias | 58,4 · 56,8 · 52,1 · 59,2 | 59,3 · 58,3 · 58,1 · 60,0 | 59,9 · 58,3 · 58,7 · 60,0 |
| Memoria de la página y sus Workers | 73 MB | 60 MB | 57 MB |

## Cómo quedó (#45)

**Un enlace sin provincia.** El resumen lista las partes de un índice de claves: 16 ficheros `claves/<huella>.json`, y en cada uno las claves que le tocan por FNV-1a (`parteDeClave`), agrupadas por provincia. La web que abre `?emplazamiento=<clave>` sin `provincia` lee la parte de esa clave, pone la provincia en la dirección con `replaceState` y pide solo esa provincia. Si ninguna la tiene, la ficha dice que el emplazamiento no existe. Con un resumen de antes del índice, el enlace se da por de Barcelona, como antes.

Descarté meter la provincia en la clave: la clave es la identidad del emplazamiento en las fichas, las correcciones y los enlaces ya compartidos, y el código de un emplazamiento del registro no siempre empieza por su provincia: 1.739 de las 5.049 claves de Cataluña no lo hacen. La otra opción era un índice entero en el resumen. Medido con gzip el 29/09/2026:

| | Cataluña real, 5.049 | España, unas 42.900 (estimado) |
|---|---|---|
| Todas las claves con su provincia | 14 KB | 125 KB |
| Una parte de 16 | 1,2 KB | 8 KB |
| Lo que crece el resumen con los nombres de las 16 partes | 215 B (de 2.067 a 2.282) | lo mismo |

Todo el mundo descarga el resumen y casi nadie abre un enlace sin provincia, así que el índice va aparte. Con 32 partes el enlace pediría 4 KB y el resumen crecería 379 B. Las partes van en el manifiesto de la versión y se retiran con ella; una noche que solo barre conserva las del resumen anterior.

**Provincias vecinas.** Las celdas se calculan con las provincias cuya caja queda a 2 km o menos de lo que se ve al zoom de las celdas y del emplazamiento seleccionado. Una celda que podría recortar una provincia de fuera del cálculo no se dibuja ni la usa el sector que da servicio. Para saberlo basta con mirar sus vértices: un emplazamiento de esa provincia recorta la celda si queda más cerca que el suyo de algún punto de ella, y como la celda es convexa, eso pasa si y solo si pasa en algún vértice. Si una celda dudosa se ve, su provincia también se pide, así que una celda del campo que llega a 10 km tampoco sale mal. Las celdas se recortan a la caja de todas las provincias del cálculo, también de las que aún no han llegado: las que se dibujan mientras falta una son las mismas que cuando llegan todas (prueba en `celdas.test.ts`).

La vista de interferencia pide las provincias con estaciones a 1,5 km de lo que se ve o del punto de referencia, en el mismo plano con que `pedirSinr` elige las estaciones. Mientras falta alguna no calcula y lo dice; con todas, da lo mismo que con las provincias juntas en una sola capa. La pista de las celdas y el panel de la vista nombran la provincia que falta y, si no llega, ofrecen pedirla otra vez.

**Hasta dónde llegan los datos.** El aviso del punto de referencia y la marca de agua de «sin datos» miden la distancia a lo barrido recortado a las cajas de los emplazamientos de cada provincia (`distanciaALosDatos`). Los cuadros de 1° de Cataluña llegan al mar y a Francia: Perpiñán queda dentro de uno barrido, pero a 28 km del último emplazamiento de Girona, y ahora sale el aviso.

Medido con Cataluña real, la CPU a ×4 y 390 px, abriendo un enlace sin provincia junto al borde (escenario `borde` de `tools/rendimiento`): de 59,7 a 60 fps al cruzar el borde con las celdas y con la vista de interferencia, sin fotogramas de más de 50 ms. Las cifras están en `docs/patterns/rendimiento.md`.

## Consecuencias

- Abrir la web descarga el resumen (de 2 a 4 KB con gzip, según cuántas zonas lleve) y las provincias de la vista inicial, no toda España.
- Buscar un emplazamiento por su clave ya no puede recorrer toda la capa en el navegador. Los enlaces llevan la provincia, y uno sin ella la busca en el índice de claves (#45, abajo).
- La vista de interferencia y las celdas necesitan también las provincias vecinas de lo que se ve. Desde el #45 las piden y no dibujan nada que una provincia sin cargar pudiera cambiar.
- La agrupación sigue dependiendo de detalles internos de supercluster 9.1: `_getOriginZoom` y, ahora, la forma de sus árboles. La versión sigue fijada y una prueba compara las escenas del índice rehidratado con las del construido en el hilo.
- El resumen es una segunda fuente de verdad para los números por provincia. Sale de la misma instantánea en la misma publicación, así que no puede discrepar de las capas de su versión.

## Alternativas descartadas

- **Una capa entera en JSON, como hoy.** Con los 42.900 reales pesa 522 KB con gzip en el formato 4, la primera vez tarda en pintar el doble que por provincias, y al alejar hasta España pierde fotogramas. Con el índice en un Worker el hilo principal se libra de agrupar, pero la descarga y el análisis del JSON siguen siendo de toda España.
- **PMTiles.** Es lo más fluido con diferencia, pero las agrupaciones de tippecanoe no tienen relación entre niveles y se cortan en los bordes de tesela, así que la transición no puede ser fiel (exploración 03). Además, 16 a 32 MB y 140.000 a 293.000 teselas por versión no caben en la copia de Vercel.
- **PMTiles para la vista de país y JSON por provincias para el detalle**, la propuesta de la exploración 03. El resumen de provincias hace lo mismo con 2 KB y sin teselas.
