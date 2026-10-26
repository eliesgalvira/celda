# Celda

Celda enseña, con los datos oficiales, qué antenas de móvil hay en un sitio, de qué compañía son, en qué bandas emiten y qué ha medido el ministerio a su alrededor, y explica a quién acudir cuando algo va mal (ADR 0031).

Es una web pública con las antenas de telefonía móvil de España en un mapa. Tiene las de las zonas que la ingesta ya ha barrido, y de las demás dice que aún no las tiene. Barcelona solo es especial donde tiene datos propios: sus barrios y su padrón por barrio. Este glosario fija las palabras que usan la interfaz, el código y las conversaciones sobre el proyecto. Lo que la interfaz explica al tocar un término subrayado está en `packages/dominio/src/glosario.ts`, con palabras más llanas, y no puede contradecir a este glosario.

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
Porción de unos 120° alrededor de una estación base hacia la que emite una de sus antenas. Apunta hacia un azimut que ninguna fuente publica, así que Celda no dibuja sectores ni dice cuál da servicio a un punto (ADR 0005, retirado el 20/10/2026).
_Evitar_: cara, celda

**Banda**:
Frecuencia en MHz en la que emite una estación base. Las bajas llegan más lejos y las altas dan más velocidad.
_Evitar_: canal, portadora, EARFCN

**Filtro de compañías**:
Las compañías que la persona elige ver en el mapa, con los chips de «Compañías». Sin filtro se ven todas. Con él, los emplazamientos, las agrupaciones y las zonas son solo los de las compañías del filtro; un compartido sale si alguna de las suyas está. El dispositivo lo recuerda, como los ajustes (ADR 0026).
_Evitar_: operador, filtro de operadoras, capa de compañía

**Red usada**:
La red de otra compañía a la que se conectan los clientes de una del filtro donde esta no tiene la suya: la de Movistar para DIGI y la de Orange para Yoigo. Con DIGI en el filtro y Movistar no, los emplazamientos de Movistar salen aparte, más claros, sin contar en las zonas ni en las agrupaciones.
_Evitar_: itinerancia, roaming (en la interfaz), red prestada, cobertura

**Compañía sin red propia**:
Empresa de telefonía móvil sin emplazamientos que da servicio con la red de una compañía, como Simyo con la de Orange. No sale en el mapa ni en los chips: se elige en «¿No sale la tuya?», y eso pone el filtro de su red (ADR 0026). Las que usan más de una red no están.
_Evitar_: operador móvil virtual, OMV, marca blanca

**Agrupación**:
Hexágono con un número que recoge los emplazamientos cercanos cuando se aleja el mapa: en la vista agrupada y, en las dos vistas, desde el zoom de los logos, donde varios quedan muy juntos.
_Evitar_: cluster, grupo, hexágono

**Vista de puntos**:
Cómo dibuja el mapa los emplazamientos si nadie elige otra cosa: cada uno es un punto pequeño del verde azulado de Celda, sin agrupar, hasta el zoom de los logos, el 15. Desde ahí, logos y agrupaciones, como en la vista agrupada. Sin número en el mapa: cuántos hay lo dice la cabecera, del sitio que se mira (ADR 0028).
_Evitar_: mapa de calor, nube de puntos, densidad

**Vista agrupada**:
La otra forma de dibujarlos, que se elige en «Funciones»: provincias, zonas y agrupaciones con su número hasta la calle. El dispositivo la recuerda.
_Evitar_: vista de hexágonos, clusters

**Paso a los logos**:
En la vista de puntos, el cruce del zoom de los logos: cada logo crece desde su punto y los puntos de una agrupación se deslizan hasta su hexágono, y al alejar al revés.
_Evitar_: traspaso (en la interfaz), transición, handover

**Barrio**:
Uno de los 73 barrios de Barcelona, con los límites que publica el Ayuntamiento. En el nivel de barrios del mapa, cada uno recoge sus emplazamientos con su número. Los municipios de alrededor no tienen barrios.
_Evitar_: zona, vecindario, distrito

**Municipio**:
Uno de los 8.132 municipios de España, con los límites del IGN y los habitantes del padrón del INE. Se identifica por su código INE de cinco cifras, nunca por su nombre. Cada emplazamiento cae en uno, salvo en un territorio compartido. En los niveles de municipios del mapa, los de una provincia cubierta recogen sus emplazamientos con su número.
_Evitar_: localidad, pueblo, ciudad, término municipal

**Capital de municipio**:
Núcleo principal de un municipio, con el punto oficial que le da el Nomenclátor Geográfico Básico de España del IGN. El hexágono de un municipio va junto a ella: en la media de sus emplazamientos a menos de 2 km o, si no tiene ninguno, en ella.
_Evitar_: cabecera, centro del municipio, capital a secas (la de una provincia es otra)

**Provincia**:
Una de las 50 provincias, o Ceuta o Melilla. Su código son las dos primeras cifras del código INE de sus municipios.
_Evitar_: región, comarca

**Territorio compartido**:
Terreno que el IGN no asigna a ningún municipio porque lo comparten varios, como las Bardenas Reales. Tiene provincia pero no municipio.
_Evitar_: mancomunidad, comunidad (son solo parte del nombre de algunos)

**Zona**:
Barrio, municipio o provincia: lo que el mapa recoge en un hexágono con su número de emplazamientos y su nombre, en la vista agrupada. Provincias de lejos, municipios a media distancia y barrios dentro del municipio de Barcelona. En el mapa, un municipio es zona solo si tiene 4 emplazamientos o más y cabe en la pantalla, y de lejos, además, solo si es grande; si no, sus emplazamientos van en agrupaciones o sueltos. El ejercicio de emplazamientos se hace sobre un barrio de Barcelona o un municipio.
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

**Medida de exposición del ministerio**:
Punto alrededor de una estación base donde se midió la exposición a campos electromagnéticos, tal como lo publica su ficha en el registro oficial: a qué distancia, en qué dirección vista desde la estación (acimut) y cuántos µW/cm². El ministerio no dice cuándo se midió. Sirve para comprobar que no se pasa del nivel de referencia y no dice nada de la señal que recibe un móvil allí. Su acimut tampoco es la orientación de un sector. No hay que confundirla con una **medida**, que es una lectura de la señal.
_Evitar_: medición, nivel de señal, potencia, cobertura, medida a secas

**Nivel de referencia**:
La densidad de potencia que la norma no deja superar donde suele haber gente, de 200 a 1.000 µW/cm² según la frecuencia (anexo II del Real Decreto 1066/2001). Una medida de exposición del ministerio suma todas las frecuencias, así que se compara con el más bajo, 200 µW/cm², el de la radio FM. El decreto sigue la Recomendación 1999/519/CE, hecha con las guías de la Comisión Internacional de Protección contra la Radiación No Ionizante (ICNIRP). Una persona expuesta justo al nivel de referencia absorbe, incluso en el peor caso, 0,08 W/kg, 50 veces menos de los 4 W/kg que en 30 minutos calientan el cuerpo un grado.
_Evitar_: límite de seguridad, umbral peligroso

**Baremo de exposición**:
Con lo que Celda compara cada medida de exposición del ministerio con las de su zona, teniendo en cuenta la distancia a la antena: por provincia, lo típico a cada distancia y cuánto se aparta de ello la mitad de las medidas, y por zona, cuántas de cada 100 quedan por debajo. La zona es el municipio si tiene medidas de bastantes emplazamientos, y si no, la provincia. Lleva además, de toda España, la medida más alta y cuántas no llegan al 1 % del nivel de referencia. Lo calcula el montaje de las capas (ADR 0030). Dice cómo queda una medida entre las publicadas. No dice si es segura ni nada de la señal.
_Evitar_: ranking, nota, puntuación, índice de riesgo

**Archivo de páginas**:
Copia privada de cada página del registro oficial que lee la ingesta, el listado de cada caja y la página de cada estación base, tal como llegó y con la fecha de cada lectura. Sirve para volver a leerlas sin pedirlas otra vez cuando cambia la forma de leerlas. Nunca se publica (ADR 0027).
_Evitar_: caché, histórico, backup

**Historial de un registro**:
Lo que la ingesta ha visto de un registro del registro oficial, hecho a hecho y con la fecha en que lo vio: cuándo apareció, cuándo cambiaron su dirección o sus bandas, cuándo se retiró. Su punto de partida es lo que ya estaba en el registro cuando empezó el historial, que se dice «en el registro antes del <fecha>» (ADR 0027).
_Evitar_: log, eventos, histórico de cambios

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
Proceso programado que trae observaciones de las fuentes y actualiza los emplazamientos sin que nadie lo lance a mano. Corre el primer fin de semana de cada mes (ADR 0029).
_Evitar_: scraping, importación, sincronización

**Extractor**:
Parte de la ingesta que lee una sola fuente. Cada uno se puede apagar sin tocar el resto.
_Evitar_: scraper, crawler, conector

**Ejecución de ingesta**:
Una pasada de un extractor, con su fecha, los cambios que ha escrito y sus errores. Queda completada, fallida, omitida (con el interruptor apagado) o interrumpida (si se cortó y otra la sustituyó). El temporizador lanza una el primer sábado de cada mes, que empieza una ronda, y otra el domingo siguiente, que solo pide a la fuente lo que la del sábado dejó sin leer o con errores. Nunca corre entre semana.
_Evitar_: job, run, lote, noche

**Ronda**:
Las ejecuciones de ingesta que leen una vez todo lo de una fuente: la del primer sábado de cada mes y la del domingo siguiente. Lo leído en el último día y medio es de la ronda y no se vuelve a pedir en ella, ni el listado de una zona con su barrido completado ni una ficha. Si la del sábado no corre, la del domingo lo lee todo.
_Evitar_: ciclo, pasada, tanda

**Interruptor**:
Lo que apaga un extractor. Con él apagado, la ejecución queda omitida sin pedir nada a la fuente.
_Evitar_: flag, kill switch

**Barrido**:
Lectura completa del listado de una fuente en una zona de barrido. Cada ronda hace uno por zona. Una observación que falta en dos barridos seguidos de su zona se da por retirada, así que retirarla tarda dos meses; con uno solo no, por si la fuente falló. Un barrido que falla no cuenta ausencias, y tampoco uno en el que un cuadro con estaciones vuelve vacío. Un barrido cortado se retoma en la ejecución siguiente de la ronda por el primer cuadro que no llegó a guardarse. Uno que se queda a medias no pasa a la ronda siguiente, que lo empieza de cero.
_Evitar_: scan, rastreo, crawl

**Zona de barrido**:
Grupo con nombre de cuadros que la ingesta barre en una misma ejecución, como Cataluña. Hay siete, que juntan comunidades autónomas. Cada ronda barre las de la configuración, por defecto las siete. La zona de barrido de una observación es la del cuadro en que cae.
_Evitar_: zona a secas (esa es la del mapa y el ejercicio), región, grupo, provincia

**Cuadro**:
Cuadrado de 1° de longitud por 1° de latitud de la rejilla fija con que se recorre el listado del registro oficial. Se escribe con la esquina suroeste en grados enteros: `2,41` es el de Barcelona. Como el listado corta en 1000 registros sin avisar, un cuadro se pide por cajas que se dividen en cuatro al llegar al tope, y guarda las de la última vez.
_Evitar_: celda, tesela, casilla

### Mapa publicado

**Capa**:
Copia fija de todos los emplazamientos, publicada de una vez para dibujar el mapa. Desde el formato 5 es un resumen nacional y una capa por provincia, que la web pide según lo que se ve, y desde el 8 lleva además los puntos de toda España.
_Evitar_: tiles, teselas, mapa

**Resumen nacional**:
Parte de la capa con una fila por provincia: su número de emplazamientos, sus compañías, cuántos hay con cada combinación de compañías, si está cubierta y cuándo se barrió por última vez lo que se sabe de ella. Es lo único que dibuja el mapa de lejos, un hexágono por provincia, y lo que abre la web.
_Evitar_: índice (ese es el de claves), overview, mapa general

**Índice de claves**:
Parte de la capa que dice en qué provincia va cada emplazamiento, repartida en 16 ficheros por su clave. El resumen nacional lista esos ficheros. Sirve para abrir el enlace a una ficha que no dice su provincia sin descargar ninguna capa.
_Evitar_: diccionario, tabla de búsqueda, índice a secas

**Puntos de toda España**:
Parte de la capa con la posición al metro, las compañías y el municipio de cada emplazamiento, sin sus claves, en un solo fichero. Es lo que dibuja la vista de puntos, y lo que cuenta los emplazamientos de un municipio en la cabecera. Desde el formato 8 (ADR 0028).
_Evitar_: GeoJSON, nube, puntos a secas en el código (son los de la vista de puntos)

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
Punto desde el que se calculan la distancia y el rumbo hasta cada emplazamiento. Es una ubicación GPS o un punto elegido.
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
Hacia dónde queda el emplazamiento visto desde el punto de referencia, en grados desde el norte. Sale de las dos posiciones y no depende de hacia dónde apunten los sectores.
_Evitar_: azimut (ese es el de un sector), dirección, orientación

### Mejorar la señal

**Consejo**:
Lo que Celda dice que se puede hacer para recibir mejor: hacia qué ventana poner un router 4G/5G, a qué rumbo apuntar una antena exterior y que girar el móvil apenas cambia la señal y taparlo con la mano sí. Sin punto de referencia es general; con punto, depende del rumbo y la distancia.
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
Cuánta señal llega al móvil desde el sector al que está conectado, en dBm. En los textos, su nombre técnico (RSRP) va al final.
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

### Si algo va mal

**Si algo va mal**:
El panel que dice, para seis problemas, a quién se acude, en qué orden, con qué plazos y qué conviene guardar, con enlaces a las páginas oficiales: la cobertura en casa, un barrio entero, la televisión estropeada por el 4G o el 5G, un aparato que interfiere, un emplazamiento sin licencia municipal y la exposición cerca de un colegio. Se abre desde «Funciones» y desde el final de «Mejorar la señal». No tiene formularios ni envía nada, y solo da por seguro lo que la investigación 09 comprobó en una fuente primaria (ADR 0031).
_Evitar_: reclamaciones, denuncias, ayuda, soporte

### Ejercicios

**Modo estudiante**:
Modo discreto que relaciona lo que se ve con ejercicios de clase de comunicaciones móviles. Se enciende en los ajustes, empieza apagado y el dispositivo lo recuerda. Quien no lo activa no ve su vocabulario.
_Evitar_: modo asignatura, modo práctica

**Ajustes**:
Lo que la persona elige una vez y el dispositivo recuerda, sin cuenta: el modo estudiante, el filtro de compañías y la vista agrupada. No es una aportación: nunca se compartiría.
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
- Con un **filtro de compañías**, un **emplazamiento** es suyo si alguna de sus **compañías** está en el filtro, de la **red usada** si no tiene ninguna pero sí la red que usa una de ellas, y si no, no sale. Solo los suyos cuentan en las **zonas** y las **agrupaciones**.
- Una **fuente** produce **observaciones** en cada **ejecución de ingesta**. Una **corrección** es una observación.
- Una **ronda** tiene una **ejecución de ingesta**, la del primer sábado de cada mes, o dos, si la del domingo siguiente retoma lo que la del sábado dejó. Cada **zona de barrido** tiene un **barrido** por ronda.
- La **fusión** convierte observaciones en **emplazamientos**, con su **confianza**, sus **conflictos** y su **estado**.
- Una **zona de barrido** tiene uno o varios **cuadros**, y cada cuadro es de una sola zona. Un **barrido** recorre los cuadros de una zona y solo cuenta ausencias a las **observaciones** que caen en ellos.
- Una **capa** sale de una instantánea de emplazamientos y tiene una **versión de capa**. La **publicación** escribe con ella la **ficha** de cada uno de sus emplazamientos. La ficha lleva además la fecha en que cambió su emplazamiento, y la **marca de agua** de cada vista deja ver si es más reciente que el mapa.
- Una **medida propia** queda unida al emplazamiento que le daba servicio donde se tomó.
- Las **aportaciones** viven en el dispositivo hasta que la persona comparte una. Una **corrección propuesta** compartida pasa a ser **corrección** solo si la **moderación** la acepta. La **captura** y el **punto elegido** nunca se comparten.
- Una **medida propia** compartida solo se publica dentro de un agregado, nunca suelta.
- Una **aportación compartida** llega al **buzón** con la **identidad del dispositivo** y la **huella de la IP**. Una **corroboración** pasa por la **moderación** como una **corrección propuesta**, y cada identidad cuenta una vez por **corrección**.
- Una **corrección** se enseña junto a la **observación** del **registro oficial** que contradice, con cuántas personas la sostienen.
- Una **zona** es un **barrio**, un **municipio** o una **provincia**, y cada **ausencia** es de una zona.
- En la **vista de puntos** cada **emplazamiento** es un punto hasta el zoom de los logos; en la **vista agrupada**, va en una **zona** o una **agrupación** hasta que se separa. Desde el zoom de los logos las dos vistas son iguales.
- El hexágono de una **provincia** va en su **centro visual**. Los **rótulos** de ciudad van por encima de los hexágonos de **zona**; si se pisan, se dibuja el del sitio con más habitantes y el otro sale al acercar.
- El **ejercicio de emplazamientos** se hace sobre una **zona**: un barrio de Barcelona o un municipio. Cada **emplazamiento** de la zona en que emite una **compañía** cuenta como una **estación base** suya.
- Al abrir, el mapa encuadra la **provincia** del **punto elegido** que guarda el dispositivo o, sin él, la península entera. La **ubicación GPS** no cuenta: nunca se pide al abrir.
- Con un **punto de referencia**, cada **emplazamiento** tiene un **rumbo** y los **consejos** dicen a qué rumbo apuntar una **antena exterior**. La **brújula** ayuda a alinearla.

## Ambigüedades señaladas

- En telecomunicaciones, «celda» suele ser un sector con su banda, y así la usaba el documento de UX v0 (`celda-ux.html`). En Celda es solo el nombre de la web. Hasta el 20/10/2026 nombraba también la zona de un emplazamiento, una simulación que se retiró con el ADR 0005. El «identificador de celda» de los datos técnicos conserva el sentido técnico, y la historia de usuario «ver la medida unida a la celda que me da servicio» se lee como unida al emplazamiento que le daba servicio.
- El público dice «antena» para un emplazamiento, una estación base o el elemento que radia. El glosario lo evita en los tres sentidos. La misión y la descripción de la web lo usan como palabra de entrada, porque es la que busca el público (ADR 0031).
- Los ADR 0014 y 0015 y la investigación 08 llaman «celdas de 1°» a los cuadros y «grupos» a las zonas de barrido. Se escribieron antes de fijar estas palabras.
- «Estado» a secas es el del emplazamiento. El de la ubicación se nombra siempre completo.
- La ingesta llama «ficha» también a la página de cada estación en el registro oficial (`detalleEstacion.do`), de la que salen las bandas, y «cola de fichas» a las que quedan por leer en la ronda. En la interfaz, ficha es solo la del panel, con una excepción: «el registro no tiene ficha para este emplazamiento», que se dice de una estación base sin ficha en el registro.
- El servicio de NixOS y el paquete se llaman `celda-nocturna`, y la orden que lanza una ejecución de ingesta, `noche`, de cuando la ingesta corría cada noche. Desde el ADR 0029 corre el primer fin de semana de cada mes, y conservan el nombre.
- La interfaz llama «compañías» a las compañías sin red propia («Estas compañías no tienen antenas propias…»), aunque no emiten desde ningún emplazamiento. DIGI y Yoigo sí son compañías, porque tienen emplazamientos, aunque usen también la red de otra (ADR 0026).
- El INE escribe con barra los nombres oficiales con dos formas («Valencia/València», «Donostia/San Sebastián»), y OpenStreetMap a veces también. Los datos los guardan así; lo que se ve es el nombre de lugar, en una sola forma.
