# Vista de puntos, con la agrupada como opción

Estado: aceptada el 08/10/2026, con la decisión del usuario del 08/10/2026 tras ver el prototipo de la rama desechable `prototipo/puntos` (b0d4965, 71da2c3), y las dos animaciones que pidió el mismo día. La lleva a cabo el #74. Cambia del [ADR 0016](0016-capa-por-provincias-con-resumen-nacional.md) el formato, que pasa a 8 con un fichero más por versión, y lo que dibuja el mapa por debajo del zoom 15; del [ADR 0024](0024-datos-discretos-y-rotulos-sobre-los-datos.md), que de lejos los hexágonos de provincias y zonas ya no son lo que se ve al abrir. El 20/10/2026, con la retirada del [ADR 0005](0005-simulaciones-puras-interfaz-fija.md), ya no hay celdas ni vista de interferencia que pidan capas de provincia entre z9 y z14, y el verde azulado de los puntos ya no es también el de las celdas.

## Contexto

Con toda España, el mapa de lejos era una rejilla de hexágonos: uno por provincia hasta z9, y de ahí a la calle municipios, barrios y agrupaciones con su número. Se leía como un recuento, no como un mapa: no se veía dónde hay antenas dentro de una provincia, ni las costas, las ciudades o las carreteras que dibujan. Y cada hexágono es un nodo del DOM que se mueve, se agrupa y se reparte en cada cambio de nivel, lo que más costaba en los vuelos.

El prototipo dibujó cada emplazamiento como un punto en una capa de MapLibre, sin agrupar, hasta el zoom de los logos. Se probaron tres variantes (`fino`, `denso` y `calor`, una mancha de calor bajo los puntos); el usuario eligió la fina. Las capturas están en `~/.cache/celda-puntos/capturas/comparar.html` de la máquina del prototipo.

Medido en el prototipo con `pnpm run medir -- --escenario vuelos` en el móvil (390 × 844, DPR 2,6, CPU ×4, GPU), dos rondas alternadas con la publicación del 07/10/2026 (35.689 emplazamientos), fps de cada vuelo:

| Gesto | Hexágonos | Puntos |
|---|---|---|
| Vuelo a Cataluña z8 | 56,0 | 58,7 |
| Vuelo a Barcelona z12 | 53,8 | 57,5 |
| Vuelo al Eixample z17 | 43,8 | 54,4 |
| Vuelo a Barcelona z11 | 47,6 | 56,9 |
| Vuelo a España z5,5 | 49,1 | 59,7 |
| Alejar del Eixample a España | 43,2 | 53,8 |
| Barcelona, del 9,5 al 14,5 y vuelta | 54,6 | 59,8 |

De 3 a 11 fps más, y el hilo principal de un 14 a un 46 % menos. Lo que costaba en el prototipo: un GeoJSON de 490 KB con gzip con la clave de cada punto (457 KB pedidos de capas en la visita, frente a 7), un toque de lejos que saltaba a pie de calle, ningún camino por teclado, la cabecera sin números, puntos y logos encima unos de otros entre z15 y z15,5, y las provincias pedidas e indexadas desde z9 para nada.

## Decisión

### Lo que se ve

- **Puntos por defecto.** Cada emplazamiento es un punto del verde azulado de Celda (`--mapa-punto`, el mismo que las celdas en los dos temas), semitransparente, bajo los rótulos del mapa base, desde España hasta el zoom 15. El radio y la opacidad son los de la variante fina: 1,3 px a z4, 1,6 a z6, 2 a z8, 2,5 a z10, 3,1 a z12, 4 a z14 y 4,6 a z15; opacidad 0,8 a z4, 0,7 a z7, 0,6 a z9, 0,55 a z11, 0,7 a z13 y 0,9 a z14,5. Donde se juntan, se suman: una ciudad sale casi opaca y uno suelto en el campo se sigue viendo.
- **Desde el zoom 15 todo es como antes**, en las dos vistas: logos y, donde varios emplazamientos quedan muy juntos, sus agrupaciones con número. Lo aclaró el usuario el 08/10/2026: la opción solo cambia lo que se dibuja por debajo del 15.
- **La vista agrupada** de antes (provincias, zonas y agrupaciones) es una opción de «Funciones», «Vista agrupada», que el dispositivo recuerda como el modo estudiante (`Ajustes.vistaAgrupada`). Hasta leer los ajustes no se dibuja ni se pide nada que dependa de la vista.
- **El filtro de compañías** filtra los puntos, con la red usada al 40 %, como sus logos (ADR 0026).
- **El elegido**, el de la ficha abierta o el que se acaba de tocar, lleva un punto mayor con un anillo, encima de los rótulos.
- **Sobre la foto aérea** cada punto lleva un borde claro de 1 px. Con el mapa base de reserva del IGN siguen igual: van en el estilo como las demás capas de Celda y pasan con sus cambios (`conLoDeCelda`).
- **La cabecera** dice cuántos emplazamientos tiene el sitio que se mira, en una segunda línea: «35.689 emplazamientos» en España, los de la provincia por el resumen y los del municipio por los puntos (o, con la vista agrupada, por la capa de su provincia si ha llegado). Sigue al filtro como los hexágonos, y de una provincia a medias añade «solo una parte».

### Los datos: los puntos de toda España (formato 8)

La publicación escribe por versión `puntos/<huella>.json`, que lista el manifiesto y nombra el resumen (`puntos`). Va en columnas: las provincias, por cada una sus municipios en tramos (las tres últimas cifras del código INE y cuántos emplazamientos seguidos tiene), y por emplazamiento la longitud y la latitud en cienmilésimas de grado, como diferencia con el anterior, y la máscara de sus compañías. Dentro de cada provincia van por municipio y, dentro de cada municipio, por la curva de Hilbert: las posiciones seguidas están cerca y sus diferencias son números pequeños.

No lleva las claves. Con ellas pesaba 299 KB con gzip con los 35.689 de hoy; sin ellas, 176 KB (452 KB sin comprimir, 152 KB con brotli), unos 212 KB con los 42.900 de toda España. Medido con la publicación del 07/10/2026:

| Variante | gzip -9 |
|---|---|
| Por clave, al metro | 204 KB |
| Por la curva de Hilbert, al metro | 165 KB |
| Lo mismo, a la décima de metro | 201 KB |
| Por Hilbert, con las claves | 299 KB |
| Por municipio y Hilbert, con los tramos (la elegida) | 176 KB |

Saber qué emplazamiento se ha tocado no necesita la clave: el punto dice su provincia y su posición al metro, y la capa de esa provincia, que hace falta igual para abrir la ficha, tiene el más cercano. Dos emplazamientos no están nunca a menos de 15 m (ADR 0012).

La web solo lee el formato 8. El build de Vercel falla con una vigente del 7 hasta que la ingesta nocturna publica la primera del 8, que lo hace sola: una vigente de otro formato se vuelve a publicar entera.

La web pide los puntos al abrir solo con la vista de puntos, en cuanto llega el resumen. Los lee el Worker de capas, que escribe también su GeoJSON; el hilo principal lo pasa a MapLibre en una URL `blob:` que dura la visita, sin copiar 40.000 objetos con `setData`.

### Qué se pide

Con la vista de puntos las provincias de lo que se ve se piden desde el nivel 14, uno antes de los logos, para que estén agrupadas al llegar al 15. Más lejos, solo la que se toca para abrir su ficha. Con la agrupada, como antes, desde el 9.

### Tocar

- **De lejos, o con muchos bajo el dedo, acerca** 2,5 niveles hacia el dedo, sin pasar del 14: un toque desde España no salta a pie de calle.
- **De cerca abre la ficha del más cercano sin mover el zoom**, con su anillo: desde z10 si bajo el dedo (22 px, la mitad de un objetivo de 44) hay tres o menos, y desde z13 siempre. Mientras llega la capa de su provincia, el anillo ya está; si la ficha queda bajo el panel, el mapa se aparta lo justo, como con un marcador.
- La ficha que se abre después de abrir la web ya no lleva el mapa a z16: eso solo pasa con un enlace a una ficha.

### El camino por teclado y lector de pantalla

Los puntos no son botones. «Funciones» tiene «Lista de emplazamientos», que abre un diálogo con los que se ven: un botón de 44 px por emplazamiento, del más cercano al centro al más lejano, con sus logos, sus compañías escritas y dónde queda («a 230 m al noreste del centro»), y la red usada dicha. Van los 40 más cercanos y el diálogo dice cuántos se ven. Elegir uno abre su ficha como un toque. Desde el zoom 15 los logos vuelven a ser botones, como siempre. Se descartó una lista siempre a la vista, que tapaba el mapa, y hacer focalizables los puntos, que con miles de ellos no se puede recorrer.

### El paso a los logos

Al cruzar el zoom 15 los logos salen solo cuando todas las provincias que se ven están agrupadas, y los puntos se apagan a la vez: nunca hay puntos y logos encima, ni un hueco sin ninguno, ni hexágonos de provincia «cargando» sobre los puntos. El usuario pidió además que el paso fuera natural:

- **Al acercar**, cada logo crece desde el tamaño de su punto y los puntos de una agrupación se deslizan a su hexágono, que brota allí. **Al alejar**, al revés: los logos se encogen hasta su punto y los puntos salen del hexágono. Son puntos del DOM, solo los que se ven, en una lámina bajo los marcadores, con la curva de los logos (`deslizar`) y su máquina de transiciones (`@starting-style`, el desplazamiento de la lámina). Como los marcadores, se vuelven a colocar cada vez que cambia el zoom, aunque el gesto siga a mitad de paso, y lo que se anima es solo cuánto han avanzado hacia su marcador: van siempre entre su emplazamiento y su marcador, y acaban en su emplazamiento. Los puntos del mapa se apagan al salir los logos y vuelven cuando los del DOM están llegando.

### El cambio de vista

Al cambiar de vista de lejos, los puntos vuelan a su hexágono, que sale con su número, y al volver salen de él. Con decenas de miles de puntos no se puede mover uno a uno desde JavaScript: es una capa propia de MapLibre (`CustomLayerInterface`, `ui/mapa/vuelo.ts`) que sube dos búferes al empezar, el sitio de cada punto y el de su hexágono, y en cada fotograma solo cambia un número, `t`, de 0 a 1 en 550 ms; el sombreador de vértices los mezcla. El hexágono de cada punto es el que dibujaría la vista agrupada en ese momento: el de su provincia de lejos, o su municipio, su barrio o su agrupación más cerca. Al acabar siguen los hexágonos del DOM, que brotan cuando los puntos llegan, o los puntos de siempre. Va en su propio commit para poder quitarlo si falla en algún móvil.

Con la preferencia de reducir movimiento, los dos cambios son directos.

## Consecuencias

- Abrir la web descarga unos 176 KB más con la vista de puntos (212 KB con toda España). Con la agrupada, nada más.
- De lejos y a media distancia el mapa ya no da números por zona: los da la cabecera, del sitio que se mira. Quien los quiera por zona tiene la vista agrupada.
- Entre z9 y z14 la vista de puntos no pide capas de provincia: las celdas, la interferencia y el ejercicio siguen pidiendo las suyas como antes. La interferencia se puede abrir cuando hay alguna provincia cargada, como con la agrupada a lo lejos.
- Medido el 08/10/2026 con esta implementación en el móvil con la CPU a ×4: los vuelos y el alejamiento ganan de 2 a 12 fps frente a la vista agrupada y los niveles de 4 a 6, los arrastres siguen a 60, y el cambio de vista con el vuelo va a 50,7 y 56,7 fps sobre España (54,0 y 58,7 sin él). Las tablas están en `docs/patterns/rendimiento.md`.

## Alternativas descartadas

- **Las variantes `denso` y `calor` del prototipo.** Puntos más grandes y claros, o una mancha de calor bajo los finos de lejos. El usuario eligió la fina.
- **Los puntos con su clave**, como en el prototipo: 299 KB con gzip, por encima de los 250 que pedía el #74.
- **Un toque que abre siempre el más cercano**, como el prototipo desde z11: en una ciudad a z11 hay decenas bajo el dedo y el que se abre es casi al azar.
- **Apagar los puntos solo por zoom entre el 15 y el 15,5**, como el prototipo: los logos salen al asentarse el mapa, así que había medio nivel con los dos encima o ninguno.
