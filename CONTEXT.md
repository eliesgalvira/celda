# Celda

Celda es una web pública que enseña en un mapa las antenas de telefonía móvil de España, de qué compañía son y cómo llega su señal. Tiene las de las zonas que la ingesta ya ha barrido, y de las demás dice que aún no las tiene. Barcelona solo es especial donde tiene datos propios: sus barrios y su padrón por barrio. Este glosario fija las palabras que usan la interfaz, el código y las conversaciones sobre el proyecto. Lo que la interfaz explica al tocar un término subrayado está en `packages/dominio/src/glosario.ts`, con palabras más llanas, y no puede contradecir a este glosario.

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
Zona del mapa en la que un emplazamiento es el más cercano de todos, sea cual sea su compañía. Es una simulación (celdas de Voronoi), no la zona a la que da servicio en la realidad.
_Evitar_: zona de cobertura, cobertura, hexágono

**Sector que da servicio**:
Sector de un emplazamiento que da servicio a un punto de referencia: el que más señal manda en su dirección según el diagrama de sector. Es una simulación sobre la orientación de los sectores, que hoy es siempre supuesta, y no mira si otro emplazamiento queda más cerca.
_Evitar_: celda servidora, sector servidor, mi antena

**Agrupación**:
Hexágono con un número que recoge los emplazamientos cercanos cuando se aleja el mapa.
_Evitar_: cluster, grupo, hexágono

**Barrio**:
Uno de los 73 barrios de Barcelona, con los límites que publica el Ayuntamiento. En el nivel de barrios del mapa, cada uno recoge sus emplazamientos con su número. Los municipios de alrededor no tienen barrios.
_Evitar_: zona, vecindario, distrito

**Municipio**:
Uno de los 8.132 municipios de España, con los límites del IGN y los habitantes del padrón del INE. Se identifica por su código INE de cinco cifras, nunca por su nombre. Cada emplazamiento cae en uno, salvo en un territorio compartido. En los niveles de municipios del mapa, los de una provincia cubierta recogen sus emplazamientos con su número.
_Evitar_: localidad, pueblo, ciudad, término municipal

**Provincia**:
Una de las 50 provincias, o Ceuta o Melilla. Su código son las dos primeras cifras del código INE de sus municipios.
_Evitar_: región, comarca

**Territorio compartido**:
Terreno que el IGN no asigna a ningún municipio porque lo comparten varios, como las Bardenas Reales. Tiene provincia pero no municipio.
_Evitar_: mancomunidad, comunidad (son solo parte del nombre de algunos)

**Zona**:
Barrio, municipio o provincia: lo que el mapa recoge en un hexágono con su número de emplazamientos y su nombre. Provincias de lejos, municipios a media distancia y barrios dentro del municipio de Barcelona. En el mapa, un municipio es zona solo si tiene 4 emplazamientos o más y cabe en la pantalla, y de lejos, además, solo si es grande; si no, sus emplazamientos van en agrupaciones o sueltos. El ejercicio de emplazamientos se hace sobre un barrio de Barcelona o un municipio.
_Evitar_: área, región, zona de barrido (esa es la de la ingesta)

**Ausencia**:
Compañía que no tiene ningún emplazamiento en una zona. Solo cuenta si la compañía tiene algún emplazamiento en la capa: de una que no aparece en ninguna parte no se dice que falte. No es un hueco de cobertura, porque una compañía puede dar servicio con la red de otra, y el mapa no la enseña (ADR 0024).
_Evitar_: hueco, falta de cobertura

### Procedencia de los datos

**Fuente**:
Origen de las observaciones sobre emplazamientos: el registro oficial o la comunidad de Celda, con sus correcciones. Celda no toma datos de otras webs de antenas (ADR 0019).
_Evitar_: proveedor, dataset, origen

**Registro oficial**:
La fuente del Ministerio, que publica los emplazamientos declarados por las compañías.
_Evitar_: Infoantenas, base oficial, catastro

**Observación**:
Lo que una fuente dice de un emplazamiento en una fecha, con enlace a su origen.
_Evitar_: registro, entrada, dato

**Sin ficha en el registro**:
Estación base que el listado del registro oficial incluye pero cuya página de detalle el registro da por no válida («Código de emplazamiento no válido»). La ficha lo dice, con la fecha en que se comprobó, en lugar de darla por pendiente.
_Evitar_: ficha pendiente, ficha rota, error de ficha

**Corrección**:
Observación de la comunidad de Celda que contradice al registro oficial: una corrección propuesta que la moderación ha aceptado. Se publica al lado de lo que dice el registro, con su procedencia, y nunca lo sustituye.
_Evitar_: enmienda, parche, edición

**Fusión**:
Unión de las observaciones de todas las fuentes en emplazamientos. Junta las que están a 15 m o menos, sean de la compañía que sean; las de una compañía con el mismo código salvo ceros a la izquierda, hasta 60 m; las que tienen la misma dirección, hasta 30 m; y las de otras fuentes que llevan el mismo código que una del registro oficial. En cada emplazamiento deja una estación base por compañía (ADR 0012).
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
Lectura completa del listado de una fuente en una zona de barrido. Una observación que falta en dos barridos seguidos de su zona se da por retirada; con uno solo no, por si la fuente falló. Un barrido que falla no cuenta ausencias, y tampoco uno en el que un cuadro con estaciones vuelve vacío. Un barrido cortado se retoma la noche siguiente por el primer cuadro que no llegó a guardarse.
_Evitar_: scan, rastreo, crawl

**Zona de barrido**:
Grupo con nombre de cuadros que la ingesta barre en una misma ejecución, como Cataluña. Hay siete, que juntan comunidades autónomas. La configuración dice cuáles se barren cada noche y cuáles se turnan. La zona de barrido de una observación es la del cuadro en que cae.
_Evitar_: zona a secas (esa es la del mapa y el ejercicio), región, grupo, provincia

**Cuadro**:
Cuadrado de 1° de longitud por 1° de latitud de la rejilla fija con que se recorre el listado del registro oficial. Se escribe con la esquina suroeste en grados enteros: `2,41` es el de Barcelona. Como el listado corta en 1000 registros sin avisar, un cuadro se pide por cajas que se dividen en cuatro al llegar al tope, y guarda las de la última vez.
_Evitar_: celda (esa es la de un emplazamiento), tesela, casilla

### Mapa publicado

**Capa**:
Copia fija de todos los emplazamientos, publicada de una vez para dibujar el mapa. Desde el formato 5 es un resumen nacional y una capa por provincia, que la web pide según lo que se ve.
_Evitar_: tiles, teselas, mapa

**Resumen nacional**:
Parte de la capa con una fila por provincia: su número de emplazamientos, sus compañías, si está cubierta y cuándo se barrió por última vez lo que se sabe de ella. Es lo único que dibuja el mapa de lejos, un hexágono por provincia, y lo que abre la web.
_Evitar_: índice (ese es el de claves), overview, mapa general

**Índice de claves**:
Parte de la capa que dice en qué provincia va cada emplazamiento, repartida en 16 ficheros por su clave. El resumen nacional lista esos ficheros. Sirve para abrir el enlace a una ficha que no dice su provincia sin descargar ninguna capa.
_Evitar_: diccionario, tabla de búsqueda, índice a secas

**Provincia cubierta**:
Provincia de la que se han barrido todos los cuadros con datos que la tocan: su número es el de toda la provincia. Si solo se ha barrido una parte, sus emplazamientos de esa parte están todos, pero su número es el de esa parte y la interfaz lo dice. Sin nada barrido, no tiene número.
_Evitar_: provincia completa, provincia cargada (esa es la que ya ha llegado al navegador)

**Publicación**:
Paso que, al acabar cada ingesta, escribe la capa y las fichas de la instantánea en una misma versión y después cambia la versión vigente. Sin cambios en los datos no escribe nada; con un barrido nuevo y los mismos datos, solo el resumen nacional con su fecha.
_Evitar_: despliegue, exportación, subida

**Mapa base**:
Callejero de fondo sobre el que se dibujan las capas, con sus rótulos y sus límites. Celda le pone el estilo y los límites de comunidades y provincias, pero no produce sus teselas.
_Evitar_: capa base, fondo

**Mapa base de reserva**:
El mapa base vectorial del IGN, con el mismo aspecto, que Celda pone si el de OpenFreeMap no llega al abrir, como pasa cuando las operadoras bloquean Cloudflare. Dura hasta la siguiente visita.
_Evitar_: mapa de respaldo, fallback, mapa del IGN (en la interfaz)

**Foto aérea**:
Ortofoto del IGN que la persona puede poner bajo el mapa base, con las vías y los rótulos encima. Va apagada al abrir.
_Evitar_: satélite, vista de satélite, ortofoto (en la interfaz)

**Rótulo**:
Nombre que escribe el mapa base: el de un lugar, una calle o un río. El nombre de una zona lo escribe Celda junto a su hexágono y no es un rótulo.
_Evitar_: etiqueta (es la de una zona), label

**Nombre de lugar**:
Nombre con que Celda escribe un municipio, una provincia o un lugar del mapa base: el oficial, en una sola forma. Si el oficial tiene dos, la local en la Comunitat Valenciana y la castellana en el resto (ADR 0025).
_Evitar_: topónimo, exónimo, nombre local

**Centro visual**:
Punto de una provincia en el que el mapa pone su hexágono: el más alejado de sus bordes dentro de su parte más poblada. No es su capital ni su centro geométrico.
_Evitar_: centroide, centro, capital

**Versión de capa**:
Fecha de la instantánea de emplazamientos de la que sale una capa.
_Evitar_: build, release

**Ficha**:
Lo que el panel del emplazamiento cuenta de él al seleccionarlo. Se publica con la capa, en su misma versión, y la web la lee de ahí, no de un backend.
_Evitar_: detalle, tarjeta, popup

**Marca de agua**:
Versión de los datos que conoce cada vista. La ficha sale de la misma versión que la capa de su provincia en el mapa, salvo que esa versión ya no esté publicada y se lea la vigente; entonces la ficha es posterior y la interfaz lo dice. Una provincia que llega cuando su versión ya no está publicada llega de la vigente, y la marca de agua del mapa da las dos fechas.
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

**Rumbo**:
Hacia dónde queda el emplazamiento visto desde el punto de referencia, en grados desde el norte. Sale de las dos posiciones, así que es de fiar aunque la orientación de los sectores sea supuesta.
_Evitar_: azimut (ese es el de un sector), dirección, orientación

### Mejorar la señal

**Consejo**:
Lo que Celda dice que se puede hacer para recibir mejor: hacia qué ventana poner un router 4G/5G, a qué rumbo apuntar una antena exterior y que girar el móvil en la mano apenas cambia nada. Sin punto de referencia es general; con punto, depende del rumbo, la distancia y el sector que da servicio.
_Evitar_: recomendación, truco, optimización

**Router 4G/5G**:
Aparato con tarjeta SIM que recibe la señal móvil y la reparte por wifi en casa.
_Evitar_: módem, CPE, router a secas

**Antena exterior**:
Antena direccional que se pone fuera de casa y se conecta al router 4G/5G. Hay que apuntarla al emplazamiento.
_Evitar_: antena a secas (el público la usa para el emplazamiento), Yagi

**Brújula**:
La del dispositivo, que dice hacia dónde apunta la parte de arriba del móvil para alinear una antena exterior. Solo está activa con lecturas de verdad. En un ordenador, o si el móvil no la da, una barra simula el giro y lo dice.
_Evitar_: compás, giroscopio, sensor

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
Imagen de la pantalla del modo de información de la que sale una medida propia. Se lee en el dispositivo y nunca sale de él.
_Evitar_: screenshot, foto

**Aportación**:
Dato que la persona crea en su dispositivo: una medida propia, un punto elegido, una corrección propuesta o una corroboración.
_Evitar_: contribución, envío, subida

**Corrección propuesta**:
Aportación que contradice un dato del mapa: dónde está un emplazamiento, si una compañía está en él, si sigue existiendo o si falta uno. Solo pasa a ser corrección si se comparte y la moderación la acepta.
_Evitar_: corrección, sugerencia

**Corroboración**:
Aportación que respalda una corrección que la ficha ya enseña («yo también lo veo»). Suma una persona a las que la sostienen.
_Evitar_: voto, me gusta, confirmación

**Aportación compartida**:
Aportación que la persona ha enviado a Celda. Espera la moderación y, mientras, no cambia nada de lo publicado.
_Evitar_: envío, subida, contribución

**Buzón**:
Donde llegan las aportaciones compartidas, en Convex, a esperar la moderación. El mapa nunca lee de él: lo aceptado se publica con la capa (ADR 0020).
_Evitar_: servidor, backend, bandeja

**Identidad del dispositivo**:
Token anónimo que el buzón da a un dispositivo la primera vez que comparte algo. No dice nada de la persona; sirve para los límites, los vetos y para contar a cada uno una vez.
_Evitar_: cuenta, usuario, sesión

**Huella de la IP**:
HMAC de la IP con la clave del buzón y una sal que cambia cada día. Es lo único que el buzón guarda de la IP, y lo borra a las 24 horas.
_Evitar_: IP, hash de la IP

**Moderación**:
Revisión a mano de cada aportación compartida, que acaba aceptada o rechazada, con su motivo. Solo lo aceptado llega a publicarse.
_Evitar_: aprobación, validación (esa es la comprobación automática al recibirla), revisión

**Veredicto propuesto**:
Lo que la herramienta de moderación sugiere hacer con una aportación compartida: aceptarla, rechazarla o mirarla con calma, con sus razones. No cambia nada: cuenta solo el veredicto que confirma el usuario, con su motivo.
_Evitar_: decisión, recomendación, voto

**Veto**:
Lo que impide a una identidad del dispositivo o a una huella de la IP enviar nada más, con su motivo. Lo que tenía pendiente sale marcado en la moderación. El de una huella dura lo que ella, 24 horas.
_Evitar_: bloqueo, ban

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

**Interferencia**:
Señal de otros sectores de la misma compañía en la misma banda que llega a un punto y estorba a la del sector que le da servicio.
_Evitar_: ruido, solapamiento

**Ocupación**:
Parte de la capacidad de la red que se supone en uso en la vista de interferencia. Al subirla empeoran los bordes entre celdas.
_Evitar_: carga, tráfico

**Señal frente a interferencia**:
Cuánto destaca, en dB, la señal del sector que da servicio sobre la interferencia y el ruido en un punto de la vista de interferencia. Es una simulación. En los textos, su nombre técnico (SINR) va al final.
_Evitar_: calidad de la señal (esa es la medida, RSRQ), SNR, SINR a secas

### Ejercicios

**Modo estudiante**:
Modo discreto que relaciona lo que se ve con ejercicios de clase de comunicaciones móviles. Se enciende en los ajustes, empieza apagado y el dispositivo lo recuerda. Quien no lo activa no ve su vocabulario.
_Evitar_: modo asignatura, modo práctica

**Ajustes**:
Lo que la persona elige una vez y el dispositivo recuerda, sin cuenta. No es una aportación: nunca se compartiría.
_Evitar_: preferencias, configuración

**Ejercicio de emplazamientos**:
Ejercicio del modo estudiante que cuenta, para una zona, las estaciones base de cada compañía, su radio de cobertura, los habitantes y usuarios por estación base y las tecnologías y bandas, y da la tabla para descargar.
_Evitar_: práctica, dimensionado


**Radio de cobertura**:
En el ejercicio, la mitad de la distancia media de cada estación base a su vecina más cercana de la misma compañía, esté o no en la zona. Es una estimación del ejercicio, no la cobertura real.
_Evitar_: alcance, radio de la celda

**Penetración**:
Líneas móviles por cada 100 habitantes. Es un parámetro del ejercicio, con el valor de la CNMC por defecto.
_Evitar_: tasa, adopción

**Cuota de líneas**:
Parte de las líneas móviles que tiene una compañía. Orange y Yoigo comparten la suya porque la estadística oficial no las separa.
_Evitar_: cuota de mercado a secas, share

**Usuarios por estación base**:
Líneas de la zona que le tocan a cada estación base de una compañía: habitantes por penetración por cuota, entre sus estaciones base de la zona.
_Evitar_: clientes, carga

## Relaciones

- Un **emplazamiento** tiene una o varias **estaciones base**, como mucho una por **compañía**.
- Una **estación base** emite en una o varias **bandas** y reparte su señal en **sectores**, normalmente tres.
- Un **emplazamiento** de Barcelona cae en un solo **barrio**; uno de otro municipio, en ninguno.
- Un **emplazamiento** cae en un **municipio** y en su **provincia**, o solo en una **provincia** si está en un **territorio compartido**.
- Cada **emplazamiento** tiene una **celda**. Con un **punto de referencia**, la celda se divide en sectores y uno de ellos es el **sector que da servicio**.
- Una **fuente** produce **observaciones** en cada **ejecución de ingesta**. Una **corrección** es una observación.
- La **fusión** convierte observaciones en **emplazamientos**, con su **confianza**, sus **conflictos** y su **estado**.
- Una **zona de barrido** tiene uno o varios **cuadros**, y cada cuadro es de una sola zona. Un **barrido** recorre los cuadros de una zona y solo cuenta ausencias a las **observaciones** que caen en ellos.
- Una **capa** sale de una instantánea de emplazamientos y tiene una **versión de capa**. La **publicación** escribe con ella la **ficha** de cada uno de sus emplazamientos. La ficha lleva además la fecha en que cambió su emplazamiento, y la **marca de agua** de cada vista deja ver si es más reciente que el mapa.
- Una **medida propia** queda unida al emplazamiento y al sector que daban servicio donde se tomó.
- Las **aportaciones** viven en el dispositivo hasta que la persona comparte una. Una **corrección propuesta** compartida pasa a ser **corrección** solo si la **moderación** la acepta. La **captura** y el **punto elegido** nunca se comparten.
- Una **medida propia** compartida solo se publica dentro de un agregado, nunca suelta.
- Una **aportación compartida** llega al **buzón** con la **identidad del dispositivo** y la **huella de la IP**. Una **corroboración** pasa por la **moderación** como una **corrección propuesta**, y cada identidad cuenta una vez por **corrección**.
- Una **corrección** se enseña junto a la **observación** del **registro oficial** que contradice, con cuántas personas la sostienen.
- Una **simulación** nunca es una **observación** ni una **medida**.
- Una **zona** es un **barrio**, un **municipio** o una **provincia**, y cada **ausencia** es de una zona.
- El hexágono de una **provincia** va en su **centro visual**. Los **rótulos** de ciudad van por encima de los hexágonos de **zona**; si se pisan, se dibuja el del sitio con más habitantes y el otro sale al acercar.
- El **ejercicio de emplazamientos** se hace sobre una **zona**: un barrio de Barcelona o un municipio. Cada **emplazamiento** de la zona en que emite una **compañía** cuenta como una **estación base** suya.
- Al abrir, el mapa encuadra la **provincia** del **punto elegido** que guarda el dispositivo o, sin él, las **provincias cubiertas** del **resumen nacional**. La **ubicación GPS** no cuenta: nunca se pide al abrir.
- Con un **punto de referencia**, cada **emplazamiento** tiene un **rumbo** y los **consejos** dicen a qué rumbo apuntar una **antena exterior**. La **brújula** ayuda a alinearla.

## Ambigüedades señaladas

- En telecomunicaciones, «celda» suele ser lo que aquí es un sector con su banda, y así la usaba el documento de UX v0 (`celda-ux.html`). Celda la usa como la zona de un emplazamiento. El «identificador de celda» de los datos técnicos conserva el sentido técnico, y la historia de usuario «ver la medida unida a la celda que me da servicio» se lee como unida al sector que da servicio.
- La celda se calcula entre todos los emplazamientos, no por compañía (decidido el 26/09/2026). El mapa dibuja un marcador por emplazamiento, y con celdas por compañía saldrían cinco teselados superpuestos que se cruzan, justo las capas que se descartaron en los prototipos. Un móvil se conecta a las estaciones base de su compañía, así que la celda no es la zona a la que da servicio: esa pregunta, por compañía y banda, la contesta la vista de interferencia.
- En un emplazamiento compartido cada compañía puede orientar sus sectores de otra forma. Falta decidir de qué estación base salen los tres sectores en que se divide la celda.
- El público dice «antena» para un emplazamiento, una estación base o el elemento que radia. El glosario lo evita en los tres sentidos. Queda por decidir si los textos de primer uso lo aceptan como palabra de entrada.
- Los ADR 0014 y 0015 y la investigación 08 llaman «celdas de 1°» a los cuadros y «grupos» a las zonas de barrido. Se escribieron antes de fijar estas palabras; «celda» ya era la de un emplazamiento.
- «Estado» a secas es el del emplazamiento. El de la ubicación se nombra siempre completo.
- La ingesta llama «ficha» también a la página de cada estación en el registro oficial (`detalleEstacion.do`), de la que salen las bandas, y «cola de fichas» a las que quedan por leer. En la interfaz, ficha es solo la del panel, con una excepción: «el registro no tiene ficha para este emplazamiento», que se dice de una estación base sin ficha en el registro.
- Falta decidir si una marca que usa la red de otra empresa aparece como compañía.
- El INE escribe con barra los nombres oficiales con dos formas («Valencia/València», «Donostia/San Sebastián»), y OpenStreetMap a veces también. Los datos los guardan así; lo que se ve es el nombre de lugar, en una sola forma.
