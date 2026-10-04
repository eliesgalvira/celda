# Filtro de compañías, con la red que usa cada una aparte

Estado: aceptada el 04/10/2026, con las decisiones del usuario del 04/10/2026 (#69). Añade al resumen nacional del [ADR 0016](0016-capa-por-provincias-con-resumen-nacional.md) una columna opcional, sin cambiar de formato, y cambia la definición de celda del glosario: con un filtro puesto, se calcula entre los emplazamientos de las compañías del filtro.

## Contexto

Una persona de Movistar quiere ver dónde están los emplazamientos de Movistar, no los de todas. El mapa no tenía forma de quitar compañías: los hexágonos, las zonas y las celdas contaban siempre todas.

Filtrar por compañía tiene una trampa: la compañía de la persona no siempre da servicio con sus propios emplazamientos. Donde DIGI no tiene red propia, sus clientes se conectan a la de Movistar, y los de Yoigo usan la de Orange. Un filtro «solo DIGI» que enseñe solo los emplazamientos de DIGI dejaría vacío casi todo el país.

Hay otra dificultad en los números. De lejos el mapa dibuja solo el resumen nacional, sin descargar ninguna capa de provincia (ADR 0016 y 0024). El resumen tenía, por provincia, el número de emplazamientos y las compañías presentes, pero no cuántos tiene cada compañía. Y aunque los tuviera, un emplazamiento compartido por Movistar y Vodafone cuenta una vez para «Movistar y Vodafone»: la suma de los de cada una no sirve.

## Decisión

### Lo que decidió el usuario (04/10/2026)

- **Varias a la vez.** Una fila de chips con las cinco compañías, que se encienden y se apagan por separado. Por defecto se ven todas.
- **La red por la que se conecta cada una.** Con DIGI en el filtro y Movistar no, el mapa enseña los emplazamientos de DIGI y, aparte y más claros, los de Movistar. Lo mismo con Yoigo y Orange.
- **Celdas recalculadas** solo con los emplazamientos del filtro.
- **Se recuerda en el dispositivo**, y un aviso visible dice que hay un filtro puesto y lo quita de un toque.

### Cómo se elige

- **Chips con «Todas».** Sin filtro, el chip «Todas» está pulsado y los de las compañías no. Desde ahí, tocar una deja solo esa: «solo Movistar» es un toque, no cuatro. Después, cada toque añade o quita una. Quitar la última o elegir las cinco vuelve a «Todas». Así se lee «por defecto están todas» sin obligar a apagar cuatro chips para ver una.
- **Dónde.** Una pastilla «Compañías», con un embudo, encima de «Foto aérea». Abre encima un panel con los chips y no se cierra al tocarlos; Escape o un toque fuera lo cierran. Los chips son controles: rectángulos claros con borde de tinta, el logo pequeño y el nombre escrito. Los marcadores, que son los datos, son redondos o hexagonales.
- **El aviso.** Bajo la fecha de los datos: «Solo Movistar» con «Ver todas». Si sale una red aparte, una línea más: «Más claros: la red de Movistar, que usa Digi.»
- **Se guarda en los ajustes del dispositivo** (`Ajustes.companias`, clave opcional). Los ajustes de antes se leen igual, sin subir de esquema. Lo guardado vale al abrir.

### Qué sale con un filtro

`@celda/dominio/filtro`. Un emplazamiento:

- **sale como suyo** si alguna de sus compañías está en el filtro. Un compartido sale una vez, y su logo apaga las porciones de las compañías que no están en el filtro;
- **sale aparte, de la red que usan**, si no tiene ninguna del filtro pero sí la red que usa una de ellas: Movistar para DIGI y Orange para Yoigo (`RED_QUE_USA`). Si la red ya está en el filtro (Movistar y DIGI), no sale nada aparte;
- **no sale** en el resto de casos.

De cerca, cada provincia se agrupa dos veces: lo suyo, con sus zonas de municipio y de barrio, y la red usada aparte, solo en hexágonos y logos, sin zonas. Las agrupaciones de la red van claras, con el borde discontinuo y algo translúcidas. Sus logos van translúcidos y más pequeños. En la regla de choques (ADR 0024) se colocan las últimas y ceden ante todo lo demás: lo que pisa algo ya puesto no se dibuja y sale al acercar. El emplazamiento seleccionado no cede nunca.

Las zonas cuentan solo lo suyo, y un municipio que con el filtro tiene menos de 4 emplazamientos deja de ser zona, como cualquier otro. De lejos, el hexágono de cada provincia cuenta lo suyo; la red usada no se dibuja, y su número va en el nombre accesible.

La ficha de un emplazamiento de la red usada lo explica: «Digi usa aquí la red de Movistar: donde Digi no tiene emplazamientos propios, sus clientes se conectan a los de Movistar».

### Las celdas

Se calculan solo con los emplazamientos suyos, no con los de la red usada: la celda de un cliente de Movistar es la zona más cercana a un emplazamiento de Movistar. Con DIGI, las celdas son las de sus pocos emplazamientos, que en el campo quedan muy grandes. Meter la red usada en las celdas daría en Barcelona las celdas de Movistar, cuando allí los clientes de DIGI se conectan casi siempre a la red de DIGI. Ninguna de las dos es la zona a la que da servicio en la realidad; esta es la que cuenta lo que se ve.

### Los números de lejos: combinaciones en el resumen

El resumen lleva una columna nueva, `provincias.combinaciones`. Por cada provincia, cuántos emplazamientos hay con cada combinación exacta de compañías, en pares de la máscara de la columna `companias` de la capa y su número: `[1, 979, 3, 122, …]` son 979 solo de Movistar y 122 de Movistar y Vodafone. Con ellas se cuenta cualquier filtro, con la red usada, sin descargar nada (`contarConFiltro`). En los datos de toda España del 30/09/2026 una provincia con emplazamientos tiene de 4 a 17 combinaciones. El resumen pasa de 10.745 a 13.798 bytes, y de 4,5 a 5,8 KB con gzip.

**El formato no cambia: sigue siendo el 5.** Es una clave opcional, como `claves` (#45) y `sinFichaEnRegistro` (#59):

- La web de antes lee el resumen con el esquema de Effect, que descarta las claves que no conoce.
- La web nueva lee los resúmenes de antes sin ellas.
- Unas combinaciones que no cuadran con el número de la provincia se leen como si no estuvieran: no tumban el resumen.
- Si alguna provincia no las tiene, el resumen no las lleva para ninguna.

Lo comprueban `provincias.test.ts` y `publicacion.test.ts` de la noche.

**De los datos de antes a los nuevos.** Una noche sin cambios en los datos rehace solo el resumen desde el publicado (ADR 0016). Si el publicado no tiene combinaciones, la publicación lo rehace entero desde la base, como con una vigente del formato 4: las capas y los lotes salen iguales y no se reescriben, y cambian el resumen y `vigente.json`. La primera noche tras este cambio deja publicadas las combinaciones.

**Mientras tanto, la web se las arregla.** Con un resumen sin combinaciones y un filtro puesto, de lejos los hexágonos de las provincias cuentan todas las compañías, y el aviso lo dice: «De lejos aún se cuentan todas las compañías: acércate para ver solo Movistar.» De cerca todo va bien: las capas de provincia tienen las compañías de cada emplazamiento.

### Sin trabajo de más al tocar los chips

Lo cuenta [efectos.md](../patterns/efectos.md):

- **Un toque no redibuja en el acto.** El chip cambia al momento; el mapa, 150 ms después del último toque (`ESPERA_DEL_FILTRO_MS`). Tocar varios seguidos hace un solo cálculo, y ni el Worker de capas ni el de las simulaciones ven los filtros de paso. Lo guardado vale al abrir, sin espera.
- **Cada provincia se agrupa con el filtro en el Worker de capas.** La capa ya está en el hilo principal; le llegan, transferidas, las columnas de lo que sale con el filtro: posición, si cae en un barrio y su municipio. Es un mensaje por provincia y filtro, y el servicio de capa guarda las cuatro últimas agrupaciones de cada provincia: volver a un filtro no pide nada. Una sola a la vez por provincia: la siguiente espera, y si nadie la quiere ya, no se manda. Lo mandado se termina y se guarda aunque se corte la espera, así que llegar otra provincia no lo vuelve a mandar. Sin filtro no se agrupa nada: es el agrupador de siempre. Si el Worker falla, se agrupa en el hilo.
- **Mientras llega una agrupación**, cada provincia sigue con la que se veía; una que acaba de llegar con un filtro puesto se ve con su hexágono, cargando.
- **Cambiar el filtro no descarga nada**: la precarga de fichas de los sueltos que se ven solo se lanza al mover el mapa o al llegar una provincia, no porque el filtro haga sueltos otros emplazamientos.

### La red que usa cada compañía, con sus fuentes

Comprobado el 04/10/2026:

- **DIGI usa la red de Movistar donde no tiene la suya.** Telefónica y DIGI firmaron un acuerdo de itinerancia nacional y compartición de red y de espectro por 16 años, en vigor desde el 1 de enero de 2025: [nota de prensa de Telefónica, 09/07/2024](https://www.telefonica.com/en/communication-room/press-room/telefonica-digi-sign-mobile-network-agreement-16-years/) («The agreement, which will come into force on January 1, 2025, represents an evolution of the current mobile access contract») y [Xataka Móvil, 10/07/2024](https://www.xatakamovil.com/movistar/duda-despejada-digi-usara-cobertura-movistar-otros-16-anos-desplegara-su-propia-red-rapido-gracias-a-telefonica). Sigue en vigor según el [informe del tercer trimestre de 2025 de DIGI, 14/11/2025](https://m.bvb.ro/infocont/infocont25/DIGI_20251114080829_DIGI-Q3-2025-Financial-Report.pdf): «we have also been providing mobile telecommunication services as an MNO via the Spanish National Roaming Agreement and the Spanish RAN Sharing and Spectrum Sharing Agreement with Telefónica». Los remedios de la fusión de Orange y MásMóvil dieron a DIGI la opción de una itinerancia en la red de MasOrange, pero puede quedarse con Telefónica ([Comisión Europea, IP/24/928, 20/02/2024](https://ec.europa.eu/commission/presscorner/detail/en/ip_24_928)), y ninguna fuente de 2025 o 2026 dice que la haya usado. En los datos se ve la compartición: en la provincia de Barcelona, 103 de los 104 emplazamientos de DIGI son también de Movistar.
- **Yoigo usa la red de Orange.** Las dos son de MasOrange desde la fusión de 2024, que apagó casi toda la red propia de Yoigo: en agosto de 2025 quedaban 26 de sus 8.108 antenas ([El Español, 16/09/2025](https://www.elespanol.com/invertia/empresas/tecnologia/20250916/masorange-culmina-apagado-red-movil-yoigo-dentro-plan-alcanzar-millones-sinergias/1003743925831_0.html)). MasOrange dice que sus clientes «ya disponen de cobertura completa a través de la red de MasOrange» ([Xataka, 17/02/2026](https://www.xataka.com/empresas-y-economia/masmovil-ha-dicho-adios-a-cobertura-triple-parezca-no-malas-noticias)). En los datos quedan muy pocos emplazamientos de Yoigo.

**Lo que no se ha podido confirmar**, y lo que hace Celda mientras tanto:

- Ninguna fuente primaria dice que DIGI haya renunciado a la opción de itinerancia en MasOrange; solo que sigue con Telefónica. Celda enseña Movistar.
- No hay ninguna página de Yoigo ni de MasOrange que lo diga: la fuente es la prensa citando a MasOrange. Algunas líneas antiguas de Yoigo aún pueden caer en Movistar mientras se retira la «triple cobertura». Celda enseña solo Orange.
- Vodafone y Orange comparten red en los municipios de 1.000 a 175.000 habitantes ([Vodafone, 25/04/2019](https://www.saladeprensa.vodafone.es/c/notas-prensa/np_acuerdoredes/)). Celda no lo modela: el registro da cada estación base con su compañía, y un emplazamiento compartido ya sale con las dos.

Si cambia un acuerdo, se cambia `RED_QUE_USA` y estas fuentes.

## Cómo quedó (#69)

- **Dominio.** `filtro.ts`: el filtro, su papel por emplazamiento, las redes usadas, lo que resalta cada logo y el recuento por combinaciones. `provincias.ts`: la columna y su lectura. `ajustes.ts`: la clave `companias`.
- **Publicación.** `publicar.ts` escribe las combinaciones y vuelve a publicar entera una vigente sin ellas.
- **Web.** `capa/nacional.ts`: `partesDelFiltro`, `agrupacionConFiltro` y el agrupador nacional con el filtro, la red usada en su propia parte de cada escena (claves `a:08r:…`) y el recuento de lejos (`cuentaDeProvincia`). `capa/indexador.ts`: la solicitud `filtro` del Worker, con las columnas transferidas. `capa/servicio.ts`: `agrupacion(codigo, filtro)`, con su turno y su caché. `filtro/enMapa.ts`: el filtro aplicado tras la espera, las agrupaciones de cada provincia y los emplazamientos de las celdas. `filtro/Filtro.tsx` y `filtro/textos.ts`: la pastilla, los chips y el aviso.
- **Librería.** `filtro/FiltroDeCompanias.tsx` (pastilla, chips, panel y aviso), el tono `red-usada` de `MarcadorEmplazamiento` y `MarcadorAgrupacion`, las porciones apagadas de `LogoCompanias` y `RedUsadaFicha`.
- **Medido** el 04/10/2026 en Chromium sin interfaz con SwiftShader, la build local y la publicación de toda España del 30/09/2026 rehecha con combinaciones (35.667 emplazamientos), en el móvil (390 × 844) y en el escritorio (1400 × 900), con Barcelona a z12 y todo cargado:
  - **Del toque al mapa redibujado**, contando los 150 ms de espera: el primer marcador cambia a los 157-174 ms y el último a los 159-215 ms. Con la CPU a ×4, a los 184-318 ms el primero y, con un filtro nuevo que agrupa el Worker, a los 360 ms en el móvil y 552 en el escritorio el último. La tabla está en [rendimiento.md](../patterns/rendimiento.md#filtro-de-compañías-69).
  - **Red:** 0 peticiones al tocar los chips.
  - **Worker de capas:** 1 mensaje por filtro nuevo y provincia, 0 al volver a uno. Cuatro toques seguidos: 1 mensaje, el del último filtro. Simulaciones: 0 a z12.
  - **Quieto 20 s** tras los toques: 0 peticiones y 0 llamadas a `fetch`, XHR, `setTimeout`, `setInterval`, `requestAnimationFrame` y `postMessage`.
  - **Celdas** en el Eixample a z16: 163 con solo Movistar y 14 con solo DIGI, en el móvil.

## Consecuencias

- La celda deja de ser siempre entre todos los emplazamientos: con un filtro, es entre los de sus compañías. El glosario lo dice.
- De cerca, con DIGI o Yoigo, la red usada llena el mapa de hexágonos claros. Ceden ante lo suyo, las zonas y los rótulos, así que en una ciudad se ven sobre todo donde no hay nada de la compañía.
- Cada provincia guarda hasta cuatro agrupaciones con filtro más la de siempre: los índices de supercluster de lo que sale con cada filtro.
- La pastilla nueva sube la columna de controles 48 px: la vista inicial lo cuenta (`LO_QUE_TAPA_EN_EL_MOVIL` y `_EN_ESCRITORIO`).
- Mientras la publicación no rehaga el resumen, de lejos los números son de todas las compañías y el aviso lo dice.
- Un emplazamiento compartido por las dos redes sale una vez, como suyo: sus porciones de fuera del filtro van apagadas.

## Alternativas descartadas

- **Números por compañía en el resumen**, cinco por provincia. Más pequeño, pero no cuenta un filtro de dos compañías ni la red usada: un compartido estaría en las dos. Las combinaciones son exactas para cualquier filtro.
- **Agrupar como siempre y contar con `map` y `reduce` de supercluster.** Sin volver a agrupar, pero las agrupaciones serían las de todos los emplazamientos: con solo Movistar, hexágonos de «1» y grupos que juntan lo que con el filtro no se pisa. Las zonas tampoco serían las del filtro.
- **Agrupar con el filtro en el hilo principal.** Sin mensajes al Worker, pero indexar Barcelona entera con supercluster son decenas de milisegundos por provincia en el hilo de la interfaz, y más con la CPU de un móvil.
- **Volver a mandar el texto de la capa al Worker** para cada filtro. Habría que guardarlo en el hilo principal y volver a leerlo; las columnas del filtro pesan mucho menos y se transfieren sin copiar.
- **Contar la red usada en los hexágonos y las zonas.** «Solo DIGI» diría lo mismo que «solo Movistar» en casi todo el país. El usuario la quiso aparte y más clara.
- **Meter la red usada en las celdas.** Ver «Las celdas».
- **Tocar un chip desde todas apaga solo esa** (cinco chips encendidos por defecto). Para ver solo una había que apagar cuatro.
