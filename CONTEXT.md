# Celda

Celda es una web pública que enseña en un mapa las antenas de telefonía móvil de Barcelona, de qué compañía son y cómo llega su señal. Este glosario fija las palabras que usan la interfaz, el código y las conversaciones sobre el proyecto.

## Lenguaje

### Emplazamientos y red

**Emplazamiento**:
Sitio físico con antenas, como una azotea, una torre o una farola. Lo pueden compartir varias compañías.
_Evitar_: antena, torre, sitio, site, ubicación

**Compañía**:
Empresa de telefonía móvil que emite desde uno o más emplazamientos. En el mapa se reconoce por su logo.
_Evitar_: operador, operadora, teleco, marca

**Estación base**:
Conjunto de equipos de una compañía en un emplazamiento.
_Evitar_: antena, EB, eNB, gNB, nodo

**Sector**:
Porción de unos 120° alrededor de una estación base hacia la que emite una de sus antenas. Se orienta con un azimut, que ninguna fuente publica: es una estimación con ±15° de margen o, si no hay ninguna, una orientación supuesta (0°, 120° y 240°) que la interfaz dice como tal.
_Evitar_: cara, celda

**Banda**:
Frecuencia en MHz en la que emite una estación base. Las bajas llegan más lejos y las altas dan más velocidad.
_Evitar_: canal, portadora, EARFCN

**Celda**:
Zona del mapa en la que un emplazamiento es el más cercano.
_Evitar_: zona de cobertura, cobertura, hexágono

**Sector que da servicio**:
Sector de un emplazamiento que da servicio a un punto de referencia.
_Evitar_: celda servidora, sector servidor, mi antena

**Agrupación**:
Hexágono con un número que recoge los emplazamientos cercanos cuando se aleja el mapa.
_Evitar_: cluster, grupo, hexágono

**Ausencia**:
Compañía que no tiene ningún emplazamiento en un barrio.
_Evitar_: hueco, falta de cobertura

### Procedencia de los datos

**Fuente**:
Origen externo de datos sobre emplazamientos: el registro oficial, antenasmoviles.es o un mapa colaborativo como OpenCelliD.
_Evitar_: proveedor, dataset, origen

**Registro oficial**:
La fuente del Ministerio, que publica los emplazamientos declarados por las compañías.
_Evitar_: Infoantenas, base oficial, catastro

**Observación**:
Lo que una fuente dice de un emplazamiento en una fecha, con enlace a su origen.
_Evitar_: registro, entrada, dato

**Corrección**:
Observación de la comunidad que contradice al registro oficial.
_Evitar_: enmienda, parche, edición

**Fusión**:
Unión de las observaciones de todas las fuentes en emplazamientos. Junta las que están a 15 m o menos, sean de la compañía que sean, y en cada emplazamiento deja una estación base por compañía (ADR 0012).
_Evitar_: cruce, deduplicación, merge

**Confianza**:
Grado de acuerdo entre las observaciones que la fusión ha juntado en un emplazamiento: alta si lo confirman dos fuentes o más, media si solo lo conoce una y baja si tiene conflictos.
_Evitar_: fiabilidad, puntuación

**Conflicto**:
Desacuerdo entre observaciones de un mismo emplazamiento que la fusión no resuelve. Siempre se muestra.
_Evitar_: discrepancia, error

**Estado**:
Cuánto fiarse de un emplazamiento. Es verificado si el registro oficial lo tiene y ninguna otra fuente lo contradice, corregido si una corrección lo contradice y nuevo si solo lo conocen otras fuentes.
_Evitar_: calidad, validez

**Ingesta**:
Proceso programado que trae observaciones de las fuentes y actualiza los emplazamientos sin que nadie lo lance a mano.
_Evitar_: scraping, importación, sincronización

**Extractor**:
Parte de la ingesta que lee una sola fuente. Cada uno se puede apagar sin tocar el resto.
_Evitar_: scraper, crawler, conector

**Ejecución de ingesta**:
Una pasada de un extractor, con su fecha, los cambios que ha escrito y sus errores. Queda completada, fallida, omitida (con el interruptor apagado) o interrumpida (si se cortó y otra la sustituyó).
_Evitar_: job, run, lote

**Interruptor**:
Lo que apaga un extractor. Con él apagado, la ejecución queda omitida sin pedir nada a la fuente.
_Evitar_: flag, kill switch

**Barrido**:
Lectura completa del listado de una fuente en una ejecución. Una observación que falta en dos barridos seguidos se da por retirada; con uno solo no, por si la fuente falló.
_Evitar_: scan, rastreo, crawl

### Mapa publicado

**Capa**:
Copia fija de todos los emplazamientos y agrupaciones, publicada de una vez para dibujar el mapa.
_Evitar_: tiles, teselas, mapa

**Mapa base**:
Callejero de fondo sobre el que se dibujan las capas. No lo produce Celda.
_Evitar_: capa base, fondo

**Versión de capa**:
Fecha de la instantánea de emplazamientos de la que sale una capa.
_Evitar_: build, release

**Ficha**:
Lo que el panel del emplazamiento cuenta de él al seleccionarlo. Se lee en vivo, así que puede ser más reciente que la capa.
_Evitar_: detalle, tarjeta, popup

**Marca de agua**:
Versión de los datos que conoce cada vista. Si la ficha y la capa tienen marcas distintas, la interfaz lo dice.
_Evitar_: timestamp, sello, fecha de actualización

### Ubicación

**Punto de referencia**:
Punto desde el que se calculan el sector que da servicio, la distancia y el rumbo hasta la antena. Es una ubicación GPS o un punto elegido.
_Evitar_: tu ubicación, posición, usuario

**Ubicación GPS**:
Punto de referencia que da el dispositivo, con su círculo de precisión.
_Evitar_: localización, geolocalización

**Punto elegido**:
Punto de referencia que la persona marca a mano en el mapa o con una dirección. Los textos lo llaman «el punto», nunca «tú».
_Evitar_: marcador, chincheta, pin

**Estado de la ubicación**:
Ninguna, denegada, ubicación GPS o punto elegido. Si la ubicación GPS no llega, queda en fallo, con el motivo. Mientras se explica el paso previo, se espera al GPS o se elige un punto, vale el punto de referencia que había.
_Evitar_: estado, permiso

**Paso previo**:
Explicación de para qué se usa la ubicación, que se calcula en el dispositivo, que no se guarda y que se puede quitar. Va siempre antes del aviso del navegador.
_Evitar_: modal de permiso, preaviso

### Medidas y aportaciones

**Medida**:
Lectura de la señal de la red en un punto y un momento. Es siempre una medida propia o una medida de ejemplo, nunca las dos.
_Evitar_: medición, muestra, lectura

**Medida propia**:
Medida que la persona registra en su dispositivo a partir de una captura.
_Evitar_: mi medida, medida real

**Medida de ejemplo**:
Medida que trae Celda para enseñar cómo funciona. No cuenta como de nadie y no es una aportación: no se guarda ni tiene identificador.
_Evitar_: demo, medida falsa, medida simulada

**Potencia de la señal**:
Cuánta señal llega al móvil desde el sector que le da servicio, en dBm. En los textos, su nombre técnico (RSRP) va al final.
_Evitar_: cobertura, intensidad, RSRP a secas

**Calidad de la señal**:
Cuánto se ensucia la señal con la de otras estaciones base y con la gente conectada, en dB. En los textos, su nombre técnico (RSRQ) va al final.
_Evitar_: ruido, RSRQ a secas

**Modo de información**:
Pantalla oculta del móvil, que se abre marcando un código, con los datos de la red a la que está conectado. El código depende de la marca y del sistema. Las pantallas se llaman como las llama el móvil («Field Test», «ServiceMode»), pero el concepto es este.
_Evitar_: modo servicio, field test, modo ingeniero

**Captura**:
Imagen de la pantalla del modo de información de la que sale una medida propia.
_Evitar_: screenshot, foto

**Aportación**:
Dato que la persona crea en su dispositivo: una medida propia, un punto elegido o una corrección propuesta.
_Evitar_: contribución, envío, subida

**Corrección propuesta**:
Aportación que contradice un dato del mapa. Mientras no se comparta solo existe en el dispositivo y no es una corrección.
_Evitar_: corrección, sugerencia

### Simulaciones

**Simulación**:
Cálculo con un modelo que da algo con aspecto de dato. Siempre se muestra marcado como «modelo» y con su versión.
_Evitar_: medida, predicción, estimación

**Diagrama de radiación**:
Forma típica en que un sector reparte la señal según la dirección. Es una simulación.
_Evitar_: patrón de antena, lóbulo

**Vista de interferencia**:
Simulación de dónde se estorban las estaciones base de una misma compañía en una misma banda.
_Evitar_: mapa de SINR, mapa de calor

**Ocupación**:
Parte de la capacidad de la red que se supone en uso en la vista de interferencia. Al subirla empeoran los bordes entre celdas.
_Evitar_: carga, tráfico

### Ejercicios

**Modo estudiante**:
Modo discreto que relaciona lo que se ve con ejercicios de clase de comunicaciones móviles. Quien no lo activa no ve su vocabulario.
_Evitar_: modo asignatura, modo práctica

## Relaciones

- Un **emplazamiento** tiene una o varias **estaciones base**, como mucho una por **compañía**.
- Una **estación base** emite en una o varias **bandas** y reparte su señal en **sectores**, normalmente tres.
- Cada **emplazamiento** tiene una **celda**. Con un **punto de referencia**, la celda se divide en sectores y uno de ellos es el **sector que da servicio**.
- Una **fuente** produce **observaciones** en cada **ejecución de ingesta**. Una **corrección** es una observación.
- La **fusión** convierte observaciones en **emplazamientos**, con su **confianza**, sus **conflictos** y su **estado**.
- Una **capa** sale de una instantánea de emplazamientos y tiene una **versión de capa**. La **ficha** tiene su propia versión. La **marca de agua** de cada vista deja ver cuál es más reciente.
- Una **medida propia** queda unida al emplazamiento y al sector que daban servicio donde se tomó.
- Las **aportaciones** viven en el dispositivo. Una **corrección propuesta** solo pasaría a ser **corrección** si se compartiera.
- Una **simulación** nunca es una **observación** ni una **medida**.

## Ambigüedades señaladas

- En telecomunicaciones, «celda» suele ser lo que aquí es un sector con su banda, y así la usaba el documento de UX v0 (`celda-ux.html`). Celda la usa como la zona de un emplazamiento. El «identificador de celda» de los datos técnicos conserva el sentido técnico, y la historia de usuario «ver la medida unida a la celda que me da servicio» se lee como unida al sector que da servicio.
- Falta decidir si la celda se calcula entre todos los emplazamientos o solo entre los de una compañía. La vista de interferencia trabaja por compañía y banda.
- En un emplazamiento compartido cada compañía puede orientar sus sectores de otra forma. Falta decidir de qué estación base salen los tres sectores en que se divide la celda.
- El público dice «antena» para un emplazamiento, una estación base o el elemento que radia. El glosario lo evita en los tres sentidos. Queda por decidir si los textos de primer uso lo aceptan como palabra de entrada.
- «Estado» a secas es el del emplazamiento. El de la ubicación se nombra siempre completo.
- Falta decidir si una marca que usa la red de otra empresa aparece como compañía.
