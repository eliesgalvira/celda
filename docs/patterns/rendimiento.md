# Rendimiento

Qué se midió en septiembre de 2026, qué se cambió por esas medidas, qué se descartó y cómo repetirlo. La queja de partida fue la del autor con su Android: «no se ve lento, pero tampoco diría que es fluido».

## Cómo se mide

`tools/rendimiento` abre Celda en Chromium sin interfaz, con GPU (`--use-angle=vulkan`), como un móvil: 390 × 844 px, DPR 2,6, pantalla táctil, la CPU frenada ×4 y ×6 por CDP y la red de «Fast 4G» de DevTools (9 Mb/s de bajada, 1,5 de subida, 165 ms de latencia). Sirve la web construida y las capas publicadas con un servidor local que imita a Vercel: las cabeceras de `vercel.json` y gzip. El mapa base viene de OpenFreeMap de verdad, así que hace falta conexión.

Cada ronda abre una visita nueva, con la caché vacía, y hace siempre lo mismo:

1. Carga: espera al mapa base y a los marcadores, y anota los tiempos, los bytes y las tareas largas.
2. Toca el hexágono de Barcelona y acerca tres veces con el botón, hasta Barcelona entera (zoom 10,7 más o menos, hexágonos). Arrastra con un dedo, pellizca hacia dentro y hacia fuera y gira la rueda. Hasta el #52 la web abría ahí, a zoom 10,75; ahora abre en lo que Celda tiene, de lejos, y al abrir solo descarga el resumen nacional. Las cifras de carga de abajo son de antes de ese cambio.
3. Acerca tres veces con el botón, hasta el nivel de los barrios y los hexágonos del zoom 13,75, y repite los tres gestos.
4. Acerca dos veces más, hasta el zoom 15,75, donde casi todo son logos sueltos, y repite los gestos.
5. Toca el marcador más cercano al centro, cierra la ficha, toca uno vecino y vuelve a tocar el primero.
6. Aleja cinco veces con el botón.
7. Abre otra pestaña con la caché de la primera: la visita repetida.

En el móvil, Acercar y Alejar están dentro del menú «Funciones». La medida lo abre antes de cada pulsación, como haría una persona, y ese menú entra en lo medido.

De cada gesto salen los intervalos entre `requestAnimationFrame` (fps, percentil 95, máximo, cuántos pasan de 20 ms, que es perder al menos un refresco, y cuántos de 50 ms) y los Long Animation Frames del navegador, con el guion que más pesa. La medida cuenta también el segundo y medio que sigue al gesto, cuando el mapa se asienta y los marcadores se reagrupan. La ficha se mide desde el `pointerdown` hasta el fotograma que ya la pinta. El INP es la interacción más lenta de toda la visita.

Los arrastres van con `Input.dispatchTouchEvent`, un evento cada 16 ms. `synthesizeScrollGesture` no sirve: el navegador se queda el gesto como desplazamiento y MapLibre no recibe ningún `touchmove`, así que el mapa no se mueve y todo sale a 60 fps. Las primeras medidas de los arrastres tenían ese fallo.

### Repetirlo

Hace falta una carpeta publicada (`vigente.json`, la capa y los lotes), por ejemplo la de `pnpm run publicar:local` de `tools/capas` o la de una vista previa. Dentro de `nix develop`:

```sh
pnpm run build                           # desde la raíz: apps/web/dist
cd tools/rendimiento
pnpm run medir -- --capas <carpeta publicada>
pnpm run medir -- --capas <carpeta> --web <dist de antes>,../../apps/web/dist --repeticiones 3
pnpm run medir -- --capas <carpeta> --trazas /tmp/trazas --perfil /tmp/perfiles
```

- `--web` admite varias carpetas separadas por comas. Las rondas se alternan entre ellas, así el ruido de la máquina reparte igual.
- Antes de cada ronda espera a que la CPU esté por debajo del 8 % (`--calma`). Otro navegador o una compilación en marcha frenan el móvil simulado y dan fotogramas largos que no son de Celda. Durante este trabajo otro agente abría Chromium con SwiftShader a la vez, y una ronda sin esa espera salió el doble de mala.
- `--trazas` graba una traza de CDP de cada gesto en una ronda aparte, que no cuenta en las medianas, y resume el tiempo propio por hilo y por tipo de trabajo. `--perfil` guarda el perfil de CPU de V8 de cada gesto; para leerlo, construye la web sin minificar (`npx vp build --minify false`).
- `--solo-carga` se salta los gestos, `--cascada` imprime las peticiones de la carga con su inicio y su fin, y `--json` guarda las rondas enteras.
- `--escenario espana` cambia los gestos por el recorrido de varias provincias (ADR 0016): alejar con el botón hasta ver toda España con el resumen, tocar el hexágono de Barcelona, acercar con el botón hasta el nivel de municipios y arrastrar y pellizcar allí, acercar hasta la calle tocando cada vez la agrupación o la zona mayor, alejar hasta el nivel de provincias y cruzar de una a otra con seis arrastres largos. Al final mide la memoria de la página y sus Workers (`measureUserAgentSpecificMemory`, con el sitio aislado por COOP y COEP) y el montón del hilo principal, y cuenta lo pedido de las capas en toda la visita.
- `--escenario borde --ruta "/?emplazamiento=<clave>"` abre la web con el enlace a la ficha de un emplazamiento junto al borde de dos provincias, sin su provincia (#45). Cierra la ficha, cruza el borde con cuatro arrastres de 500 px con las celdas, abre la vista de interferencia, lo cruza otra vez y aleja y acerca dos niveles.
- Para medir con muchos datos sin ingerir nada, `pnpm run sintetica` en `tools/capas` publica en `CELDA_CAPAS_CARPETA` una España sintética de `CELDA_SINTETICOS` emplazamientos (100.000 por defecto, la de la investigación 08) con la publicación de verdad.
- El Chromium es el del sistema (`/usr/bin/chromium`, o `--chromium`, o `CELDA_CHROMIUM`): `playwright-core` no descarga navegadores.

## Antes y después

Medianas de tres rondas alternadas del 28/09/2026, con la capa publicada de 1318 emplazamientos. «Antes» es `celda/v1` con el logo y los controles nuevos; «después», esta rama sobre ella. Tiempos en ms desde que se pide la página.

| Carga | ×4 antes | ×4 después | ×6 antes | ×6 después |
|---|---|---|---|---|
| Primeros marcadores | 2619 | 1511 | 2834 | 1709 |
| Mapa base visible (llega la primera tesela) | 2619 | 2109 | 2834 | 2353 |
| Primera tesela recibida | 2183 | 2004 | 2332 | 2209 |
| Capa recibida | 1200 | 1191 | 1321 | 1328 |
| LCP | 1240 | 1228 | 1376 | 1660 |
| Tareas largas: cuántas / la mayor / bloqueo | 4 / 343 / 344 | 3 / 315 / 346 | 5 / 447 / 549 | 4 / 458 / 586 |
| Visita repetida: mapa base / marcadores | 1052 / 1052 | 1056 / 981 | 1423 / 1423 | 1420 / 1302 |
| Bytes / peticiones | 980 KB / 14 | 1121 KB / 15 | igual | igual |

El LCP es el enlace «© Ajuntament de Barcelona» de los créditos, que sale con la capa. Con ×6 se pinta 280 ms más tarde porque en ese momento el hilo principal evalúa MapLibre y crea el mapa, que antes llegaban un segundo después. Es el precio de tener el mapa medio segundo antes. Los bytes no suben de verdad: ver los límites de la medida.

Gestos. Cada celda dice fps, fotogramas de más de 20 ms, de más de 50 ms y el Long Animation Frame más largo, en ms. Los arrastres y los gestos de cerca dan 60 fps, 0 y 0 antes y después, y no van en la tabla.

| Gesto | ×4 antes | ×4 después | ×6 antes | ×6 después |
|---|---|---|---|---|
| Pellizco, Barcelona entera | 58,7 · 3 · 0 · 54 | 59,1 · 2 · 0 · 51 | 56,5 · 6 · 1 · 78 | 58,2 · 2 · 0 · 55 |
| Rueda, Barcelona entera | 59,6 · 1 · 0 · 50 | 59,6 · 1 · 0 · — | 57,9 · 4 · 0 · 72 | 58,6 · 4 · 0 · 58 |
| Acercar tres veces con el botón | 57,9 · 4 · 1 · 104 | 59,5 · 2 · 0 · 64 | 54,8 · 11 · 2 · 146 | 58,8 · 3 · 0 · 75 |
| Pellizco, zoom 13,75 | 55,3 · 6 · 2 · 75 | 57,7 · 4 · 0 · 69 | 56,1 · 5 · 1 · 114 | 52,5 · 8 · 3 · 83 |
| Rueda, zoom 13,75 | 58,3 · 3 · 1 · 83 | 59,3 · 2 · 0 · 62 | 54,2 · 13 · 2 · 101 | 59,7 · 1 · 0 · 63 |
| Acercar dos veces más | 58,6 · 2 · 1 · 69 | 60,0 · 0 · 0 · 53 | 55,2 · 8 · 3 · 109 | 58,5 · 3 · 1 · 60 |
| Alejar cinco veces | 58,5 · 7 · 1 · 65 | 59,8 · 1 · 0 · 74 | 58,1 · 11 · 1 · 74 | 56,4 · 14 · 2 · 79 |

Con ×4, los fotogramas de más de 50 ms pasan de 6 a 0 en toda la sesión, y el más largo, de 104 a 74 ms. Con ×6 pasan de 10 a 6, casi todos al alejar y al pellizcar a zoom medio, cuando el mapa se asienta y los marcadores se reagrupan.

| Ficha | ×4 antes | ×4 después | ×6 antes | ×6 después |
|---|---|---|---|---|
| La primera que se toca | 312 | 165 | 360 | 233 |
| Una vecina | 78 | 76 | 122 | 137 |
| La primera otra vez | 74 | 67 | 111 | 123 |
| INP de la visita | 104 | 168 | 120 | 240 |

La primera ficha tardaba lo que tarda su lote por la red. Ahora el lote ya está cuando se toca, y la ficha sale entera en la misma interacción. Por eso el INP sube: antes esa interacción solo pintaba el esqueleto de la ficha y el resto llegaba con la red, fuera de la medida. La ficha se ve antes, pero ese primer pintado cuesta más, sobre todo por compilar y montar por primera vez el código del panel. Las siguientes fichas salen en 70 ms con ×4.

Qué cuesta ahora el peor fotograma, en las trazas con ×4: el de reagrupar al asentarse dura unos 45 ms, con 11 de estilo, 8 de JavaScript de la web, 3 de maquetación y 4 de MapLibre. Antes, el peor era el de cruzar al nivel de barrios a mitad del zoom: 102 ms, con 27 de JavaScript, 27 de estilo y 13 de maquetación, sobre todo del texto de las 73 etiquetas de barrio. En los arrastres el hilo principal se va casi entero en MapLibre (`_render`, `draw`, `_calcMatrices`); los marcadores solo cambian su `transform`.

## Capa por provincias (#43)

Medianas de tres rondas del 29/09/2026 con la CPU a ×4, en las mismas condiciones de arriba y con el escenario `espana`. Tres capas del formato 5: la España sintética de 100.000 emplazamientos (`pnpm run sintetica`), la Cataluña real de la primera pasada del #40 (5.049 emplazamientos, con Barcelona, Girona, Lleida y Tarragona cubiertas y cuatro provincias a medias) y Barcelona real, esa misma base con solo los emplazamientos de la caja de Barcelona (1.294). La vista inicial es la de siempre, Barcelona a zoom 10,75, así que al abrir se piden el resumen y las provincias que corta.

| Carga (ms desde que se pide la página) | España sintética, 100.000 | Cataluña real, 5.049 | Barcelona real, 1.294 |
|---|---|---|---|
| Resumen recibido | 1227 | 1211 | 1223 |
| Primera capa de provincia recibida | 1473 | 1440 | 1433 |
| Primer marcador (el hexágono de Barcelona, mientras llega) | 1515 | 1509 | 1515 |
| Primeros emplazamientos o agrupaciones | 2125 | 1991 | 1941 |
| Mapa base visible | 2238 | 2161 | 2145 |
| Capas al abrir, con gzip | 226 KB, 5 peticiones | 50 KB, 3 | 28 KB, 3 |
| Capas tras todo el recorrido | 485 KB, 25 | 153 KB, 12 | 64 KB, 7 |
| Memoria: página y Workers / montón del hilo principal | 73 / 24 MB | 60 / 17 MB | 57 / 15 MB |
| INP de la visita | 80 | 80 | 64 |

| Gesto: fps · fotogramas de más de 20 ms · de más de 50 ms | España sintética | Cataluña real | Barcelona real |
|---|---|---|---|
| Alejar hasta ver España (seis veces el botón) | 58,4 · 9 · 1 | 59,3 · 3 · 0 | 59,9 · 1 · 0 |
| Tocar el hexágono de Barcelona | 56,8 · 2 · 1 | 57,3 · 2 · 1 | 59,1 · 1 · 0 |
| Acercar hasta la calle por las agrupaciones | 56,8 · 9 · 6 | 58,3 · 6 · 2 | 58,3 · 3 · 2 |
| Alejar hasta el nivel de provincias | 52,1 · 36 · 6 | 58,1 · 9 · 1 | 58,7 · 5 · 1 |
| Cruzar provincias arrastrando a zoom 8 | 59,2 · 11 · 1 | 60,0 · 0 · 0 | 60,0 · 0 · 0 |

Con los gestos de siempre sobre Barcelona real salen las mismas cifras que en «Antes y después»: 60 fps en los arrastres, de 56,8 a 60 en el resto, primeros marcadores a 1493 ms y la primera ficha en 177 ms.

Lo que dicen:

- **Abrir no depende del tamaño de España.** El resumen (de 2 a 4 KB con gzip) llega a los 1,2 s y el hexágono de Barcelona se pinta a los 1,5 s en los tres casos, lo mismo que la capa entera de 1318 emplazamientos en el formato 4. Lo que cambia es cuánto tarda en llegar el detalle: medio segundo después con Barcelona real y 0,7 s con la Barcelona sintética de 13.226 emplazamientos, porque el Worker tiene que leer y agrupar 720 KB de JSON. Mientras tanto se ve el hexágono con su número, no un hueco.
- **Bytes.** La capa de una provincia lleva las claves de los emplazamientos, que son casi la mitad del fichero: la Barcelona sintética pesa 176 KB con gzip y la real de Cataluña, 48 KB. El banco de la investigación, sin claves, se quedaba en 20 KB al abrir; en el formato real son 28 KB con Barcelona y 226 KB con la sintética.
- **Fluidez.** Con datos reales todo va a 57-60 fps. Con 100.000 el peor gesto es alejar hasta el nivel de provincias, 52 fps y 36 fotogramas de más de 20 ms: por el camino llegan otras provincias con miles de emplazamientos (hasta 25 capas en todo el recorrido), y rehidratar su índice y pintar sus agrupaciones se hace en el hilo principal. La investigación daba 52 fps al alejar a España con 100.000 en el banco; aquí alejar a España va a 58, porque de lejos solo se pintan los 45 hexágonos del resumen.
- **Un índice por provincia y no uno global.** Uno global habría que rehacerlo entero en el Worker cada vez que llega una provincia (477 ms con 100.000 y la CPU a ×4, más 45 ms de rehidratar, según la investigación). Por provincia, cada llegada cuesta lo de esa provincia. No medí la variante global en la web porque con esas cifras no compensa. Lo que cuesta la provincial es que en un borde puede haber dos hexágonos cerca, y cada uno cuenta solo los suyos.
- **El Worker va menos frenado que el hilo principal** con CDP, como ya dijo la investigación. En un móvil de verdad el detalle tardaría algo más en llegar; la fluidez no cambia, porque ese tiempo no bloquea la página.
- La máquina tenía otros agentes trabajando, así que cada ronda esperó a que la CPU bajara del 25 % (`--calma 0.25`) y no del 8 %.

## Niveles de municipios (#44)

Medianas de tres rondas alternadas del 29/09/2026 con la CPU a ×4, 390 px y el escenario `espana`, que desde el #44 acerca con el botón del zoom 8 al 11 alrededor de Manresa y arrastra y pellizca allí antes de bajar a la calle. «Antes» es `celda/v1` con el #43; «después», esta rama. Cada celda dice fps, fotogramas de más de 20 ms y de más de 50 ms.

| Gesto | Cataluña real, antes | Cataluña real, después | España sintética, antes | España sintética, después |
|---|---|---|---|---|
| Alejar hasta ver España | 59,2 · 6 · 0 | 59,3 · 4 · 0 | 58,1 · 8 · 2 | 57,8 · 10 · 3 |
| Tocar el hexágono de Barcelona | 56,9 · 2 · 1 | 57,7 · 2 · 1 | 56,4 · 2 · 1 | 55,5 · 2 · 1 |
| Acercar del 8 al 11 | 58,4 · 2 · 2 | 57,6 · 5 · 2 | 56,9 · 4 · 3 | 56,5 · 4 · 3 |
| Arrastrar a zoom 11 | 60,0 · 0 · 0 | 59,8 · 1 · 0 | 59,7 · 2 · 0 | 59,4 · 3 · 0 |
| Pellizcar a zoom 11 | 60,0 · 0 · 0 | 60,0 · 0 · 0 | 55,1 · 6 · 2 | 55,1 · 5 · 2 |
| Acercar hasta la calle | 60,0 · 0 · 0 | 60,0 · 0 · 0 | 54,7 · 6 · 4 | 52,6 · 5 · 2 |
| Alejar hasta el nivel de provincias | 57,5 · 13 · 1 | 57,2 · 16 · 2 | 56,3 · 18 · 3 | 56,7 · 15 · 2 |
| Cruzar provincias a zoom 8 | 60,0 · 0 · 0 | 60,0 · 0 · 0 | 59,7 · 6 · 0 | 59,6 · 7 · 0 |

A zoom 11 se ven 17 etiquetas de municipio en la Cataluña real (antes, 9 hexágonos y 10 logos) y la memoria no cambia (60 MB con Cataluña, 143 MB con la sintética). Las diferencias entre antes y después caben en el ruido de ±1 fotograma largo por gesto. El fotograma más largo de «acercar hasta la calle» con la sintética es la rehidratación del índice de Barcelona (13.226 emplazamientos) al llegar del Worker, antes y después.

La primera medida con la sintética dio 21 fps al arrastrar a zoom 11: sus emplazamientos caen al azar, también en el mar, y los que no tienen municipio iban sueltos, 734 logos en la pantalla. Ahora van en hexágonos de su propio índice (ADR 0017). En los datos reales de Cataluña no hay ninguno sin municipio.

La prueba de resistencia sigue en 0 en todo salvo `setTimeout` (331 con 330 lecturas).

## Junto al borde de dos provincias (#45)

Medianas de tres rondas del 29/09/2026 con la CPU a ×4, 390 px y GPU, con el escenario `borde` y la Cataluña real de antes, publicada otra vez con el índice de claves. Cada ronda abre el enlace sin provincia de un emplazamiento de Barcelona a menos de 1,3 km de otra provincia: `movistar-0804787`, en Cubelles, junto a Tarragona, y `movistar-0801317`, en Malgrat de Mar, junto a Girona. A zoom 16, 500 px son unos 600 m, así que cada arrastre cruza el borde.

| Gesto: fps · fotogramas de más de 20 ms · de más de 50 ms | Barcelona–Tarragona | Barcelona–Girona |
|---|---|---|
| Cerrar la ficha | 60,0 · 0 · 0 | 60,0 · 0 · 0 |
| Cruzar el borde con las celdas | 60,0 · 0 · 0 | 60,0 · 0 · 0 |
| Abrir la vista de interferencia | 59,7 · 1 · 0 | 59,7 · 1 · 0 |
| Cruzar el borde con la vista | 59,9 · 1 · 0 | 60,0 · 0 · 0 |
| Alejar y acercar dos niveles | 59,8 · 1 · 0 | 60,0 · 0 · 0 |
| Capas en toda la visita, con gzip | 76 KB, 6 peticiones | 89 KB, 7 |
| Memoria: página y Workers / montón del hilo principal | 63 / 17 MB | 61 / 17 MB |
| INP de la visita | 72 | 80 |

Las seis peticiones de Cubelles son `vigente.json`, el resumen, una parte del índice de claves (1,2 KB), la capa de Barcelona, un lote de fichas y la de Tarragona, que piden las celdas. El primer marcador sale a 1,5 s, como sin el índice: la parte se pide a la vez que el mapa base. El peor Long Animation Frame de la vista, unos 55 ms, es pasar la trama calculada a GeoJSON al llegar del Worker, en el hilo principal; no llega a perder un fotograma de 50 ms.

## Mapa base con la paleta A (#61)

Medido el 03/10/2026 en Chromium con GPU, contra `celda/v1` en las mismas condiciones, con OpenFreeMap de verdad.

- **JavaScript.** El trozo de la primera pantalla crece 2,4 KB con gzip (206,0 → 208,4 KB con `gzip -9`): las capas del estilo, que están en `estilo.ts` y lo importa `precarga.ts`. El contorno de España (`mapa/espana.json`, 72 KB, 24 KB con gzip, 30 polígonos y 4.075 vértices) no va ahí: lo importa `mapaBase.ts`, así que va en el trozo del mapa, que se descarga en paralelo con MapLibre y crece 26,6 KB con gzip (270,3 → 296,9 KB).
- **Teselas.** Las mismas URL en cada vista: de 2 a 12 teselas de OpenFreeMap por vista, en el móvil y en 1400 px. Cambiar `zoomLevelsToOverscale` no pide teselas nuevas: las del 15 salen de partir las del 14.
- **Glifos.** Se precargan tres ficheros en lugar de uno (regular, negrita y cursiva, del rango 0-255), porque de lejos ya salen las capitales en negrita y los mares en cursiva. En la sesión entera se piden menos: sin los rótulos de Marruecos, Argelia y Portugal de lejos no hacen falta los rangos árabe, tifinagh ni otros.
- **Sesión de móvil**, 390 × 844 a DPR 3, de España (z5,5) al tejado de un emplazamiento del Eixample (z18,5) y vuelta, por Cataluña y Barcelona, con la caché HTTP de verdad (contado con el registro de red de Chromium, solo lo que sale a la red):

| | `celda/v1` | #61 |
|---|---|---|
| Saltando de vista en vista: mapa base | 4,36 o 5,92 MB | 4,35 o 5,92 MB |
| Con vuelos animados: mapa base, de ronda en ronda | 7,03 a 8,60 MB | 6,15 a 7,71 MB |
| Glifos en la sesión con vuelos | 486 KB en 10 ficheros | 344 KB en 7 |

  Con saltos se piden exactamente las mismas URL de teselas; los dos valores de cada lado dependen de si las dos teselas del zoom 4 del oeste (unos 1,5 MB) llegan a pedirse antes del primer salto, y salen igual en las dos ramas. Con vuelos el número de teselas depende de los fotogramas del vuelo y varía de una ronda a otra en los dos lados; la diferencia constante son los glifos. El prototipo midió 5,2 MB con otro recorrido.
- **Quieto.** Al abrir y tras acercar y alejar (z9,5 → 18 → 5,5), 20 s quieto en el móvil y en 1400 px: 0 peticiones, 0 `render` de MapLibre y 0 llamadas a `fetch`, XHR, `requestAnimationFrame`, `setTimeout`, `setInterval` y `postMessage`, igual que `celda/v1`.
- **Fluidez.** `pnpm run medir` no llega a medir con la capa publicada de hoy, ni en `celda/v1`: con la vista inicial de toda España, el hexágono de Barcelona queda fuera de los 390 px y la medida no lo encuentra para tocarlo. Se midió aparte, con la CPU a ×4 y 390 × 844 a DPR 2,6, cinco vuelos de 2,5 s (España → Cataluña → Barcelona z12 → Eixample z17 → Barcelona z11 → España), siete rondas alternadas. Medianas de fps:

| Vuelo | `celda/v1` | #61 |
|---|---|---|
| España → Cataluña z8 | 55,5 | 54,2 |
| Cataluña → Barcelona z12 | 57,4 | 54,8 |
| Barcelona → Eixample z17 | 57,7 | 55,8 |
| Eixample → Barcelona z11 | 57,6 | 50,9 |
| Barcelona → España z5,5 | 55,6 | 53,3 |

  El hilo principal gasta un 25-30 % más de JavaScript en los vuelos: casi todo es recibir y deserializar lo que mandan los workers de MapLibre (`receive`), porque cada tesela trae más cosas que dibujar. Se reparte entre los rótulos nuevos (pueblos y aldeas, puntos de interés, avenidas, números de carretera, ríos), el suelo nuevo (usos, verdes, ríos) y el corte de las teselas en el 15: quitando cualquiera de los tres se recupera una parte, ninguno solo lo explica. Lo que sí se arregló: las vías van en dos capas (bordes y rellenos, con el color, el grosor y el orden por clase) y no en catorce, el suelo en dos y no en seis, y los municipios que son zona se quitan con un estado del estilo (`setGlobalStateProperty`) y no con `setFilter`, que mandaba a los workers el contorno de España de cada capa de lugares. Queda abierto: al alejar desde la calle se pierden de 1 a 7 fps según el tramo, y donde más, al alejar desde la calle.

## Foto aérea (#64)

Medido el 03 y el 04/10/2026 en Chromium con SwiftShader contra la build local, con el PNOA de verdad, un contexto nuevo en cada medida y el registro de red de CDP. El móvil es de 390 × 844 a DPR 3.

| Medida | #64 | Prototipo (ADR 0022) |
|---|---|---|
| Con la foto apagada, en toda la visita | 0 peticiones a `tms-pnoa-ma.idee.es` | 0 |
| Eixample a z18 en el móvil, al encender la foto | 15 teselas, 267 KB | 15 teselas, 266 KB |
| Barcelona a z12 en el móvil, al encender la foto | 15 teselas, 206 KB | 15 teselas, 206 KB |
| De España al tejado de Passeig de Gràcia 68 y vuelta, con la foto encendida, con vuelos de 2,5 s | de 2,48 a 2,97 MB en 207 a 276 peticiones, según la ronda | 2,3 MB en 232 peticiones |
| Lo mismo saltando de vista en vista | 0,91 MB en 71 peticiones | — |
| «Ver el edificio» en el móvil, desde la ficha abierta a z16 | unas 31 teselas y 470 KB, 8 canceladas por el vuelo | — |
| Tiempo de una tesela del PNOA | mediana de 21 a 30 ms en el servidor y de 30 a 85 ms hasta tenerla entera | 148 ms en frío y 91 en caliente |
| Quieto 20 s: foto apagada, encendida, tras «Ver el edificio» y tras pulsar «Foto aérea» diez veces | 0 peticiones, 0 `render` de MapLibre y 0 llamadas a `fetch`, XHR, `requestAnimationFrame`, `setTimeout`, `setInterval` y `postMessage` | igual |
| Capas y fuentes tras pulsar «Foto aérea» diez veces | las mismas 47 capas y 8 fuentes, sin repetir ninguna | — |

Con vuelos, cuántas teselas se piden depende de los fotogramas de cada vuelo, como ya pasaba con el callejero: la diferencia con el prototipo es de recorrido y de ronda. Las teselas canceladas son las que MapLibre deja de esperar al seguir volando. En la primera ronda de Barcelona a z12 la mediana hasta tener la tesela entera fue de 1,3 s con la CloudFront fría; en las siguientes, de 80 ms.

## Qué entró

**La cadena de descargas del mapa base se adelanta** (`apps/web/src/mapa/precarga.ts`). Antes iba en serie: la web, MapLibre al acabar de pintar la pantalla, su worker al crear el mapa, el TileJSON, las teselas y por último los glifos, que la primera tesela necesita para sus rótulos. Ahora `entrada.tsx` importa `precarga.ts` lo primero, y en cuanto llega el código de la web pide MapLibre, deja el código del worker en la caché HTTP con un `prefetch` y precarga el TileJSON y los glifos que usa la vista inicial (`RECURSOS_INICIALES_MAPA_BASE` en `packages/ui/src/mapa/estilo.ts`). Un `import()` normal no empieza a descargar hasta que acaba la tarea que lo llama, y evaluar la web es una tarea de 300 ms con ×4. Por eso `vite.config.ts` pone el propio trozo en `modulePreload.resolveDependencies`: el cargador de Vite lo pide en el acto con un `<link rel="modulepreload">`. Con ×4, el mapa base sale 510 ms antes.

**Los marcadores salen en cuanto existe el mapa.** Solo necesitan su proyección, y la capa llega un segundo antes que la primera tesela. Se pintan sobre el fondo liso mientras sigue el aviso «Cargando el mapa base», como ya pedía el ADR 0010 si el callejero no llega. Con ×4, los primeros marcadores salen 1,1 s antes.

**La agrupación se decide al asentarse el mapa** (`apps/web/src/mapa/vista.ts`). Antes, cada vez que el zoom cruzaba un nivel, a mitad del gesto, se volvía a agrupar: crear y quitar decenas de nodos, en los fotogramas en que MapLibre también trabaja más. Un pellizco de tres niveles lo hacía tres veces. Ahora, al acercar, lo dibujado se separa con el zoom y la agrupación nueva llega al soltar, con su transición. Al alejar sí se agrupa por el camino, pero solo si además la vista se ha salido de la caja con margen ya dibujada, para que los bordes no queden vacíos. Es lo que quita los fotogramas de más de 50 ms con ×4.

**Las fichas de lo que se ve de cerca se descargan antes de tocarlas.** Cuando la agrupación se decide y hay marcadores de emplazamiento sueltos a la vista, `FichasPublicadas.precargar` pide sus lotes, como mucho dos (`LOTES_PRECARGADOS`), los que más marcadores tienen. De cerca eso cubre casi siempre lo que se ve; más lejos, los sueltos caen en muchos lotes y no se sabe cuál se va a abrir. En Barcelona hay once lotes, así que una visita pide como mucho esos once, y son las mismas peticiones que haría al abrir las fichas (ADR 0004 y 0008). Con ×4, la primera ficha sale en 165 ms en vez de 312.

**Las secciones de la ficha fuera de la vista no se maquetan al abrirla** (`content-visibility: auto` en `SeccionFicha`). En el móvil, al abrir la ficha solo se ve el resumen. En una traza con ×4, la tarea de abrir la primera ficha bajó de 155 a 125 ms.

## Qué se descartó

- **Reciclar los nodos de los marcadores.** En el fotograma de reagrupar, crear los nodos es unos 8 ms de JavaScript con ×4; el estilo de los nodos nuevos, 11. Reciclar ahorraría parte de lo primero y poco de lo segundo, porque el marcador que entra se anima con `@starting-style`, que solo funciona al insertar el nodo. Habría que rehacer esas animaciones con la Web Animations API, y un nodo reciclado con el foco del teclado pasaría a ser otro emplazamiento. No compensa.
- **Indexar supercluster en un worker**, con la capa entera de Barcelona. Crear el agrupador cuesta unos 29 ms con ×4, una vez, al llegar la capa. Las escenas y las transiciones se piden de forma síncrona en cada reagrupación, y con un worker pasarían a ser asíncronas. Con toda España sí entró (ADR 0016, #43): el Worker devuelve los árboles de supercluster ya hechos y el hilo principal los rehidrata, así que las escenas siguen siendo síncronas.
- **`fadeDuration: 0` en MapLibre.** Medido en rondas alternadas: con ×4 salieron más fotogramas largos al pellizcar y girar la rueda de cerca, no menos, y los rótulos aparecían de golpe.
- **Montar el cuerpo de la ficha un fotograma después.** El resumen saldría antes, pero ni la primera ficha ni el INP bajaron en la medida.
- **Descargar MapLibre sin evaluarlo hasta después del primer pintado**, con un `modulepreload` de la URL del trozo sacada con un plugin de Vite. Ni el mapa base ni el LCP cambiaron, y el plugin partía el código compartido en un trozo más.
- **`preconnect` a OpenFreeMap en el HTML.** La primera petición a OpenFreeMap, la precarga del TileJSON, ya sale en cuanto llega la web. Con la red emulada de DevTools, que no simula el saludo TLS, no se puede medir lo que ahorraría.
- **Pedir las teselas de la vista inicial antes de crear el mapa.** Ahorraría unos 300 ms, pero habría que calcular a mano qué teselas pide MapLibre para ese encuadre y esa pantalla. Si no coinciden, se tiran 460 KB de datos móviles.
- **Un Service Worker para las visitas repetidas.** La visita repetida ya sale de la caché HTTP, porque todo lo que tiene versión en el nombre es inmutable durante un año, y tarda lo que tarda la CPU. Un Service Worker solo ahorraría revalidar el HTML, unos 170 ms, a cambio de su propio arranque en Android y del riesgo de servir una web vieja. `vigente.json` se seguiría pidiendo a la red.
- **Partir la web para que el primer pintado llegue antes.** El trozo principal pesa 170 KB con gzip, y de ellos el panel de la ficha, el ejercicio, medir y la interferencia son unos 100 KB sin comprimir. Cargarlos aparte ahorraría unos 50 ms del primer pintado, pero la primera ficha esperaría a su trozo y las pruebas de pantalla pasarían a ser asíncronas.
- **Quitar `tailwind-merge` de los marcadores.** Iniciarlo cuesta unos 19 ms con ×4 la primera vez que se usa `cn`, al montar la pantalla. Está en `packages/ui`, en el botón y los controles, que se estaban rediseñando a la vez.

## Garantías con prueba

- `tools/rendimiento/src/resistencia.ts`, en la CI: con la web quieta 30 s no se abre nada ni se pide ningún fotograma. Ver [efectos.md](efectos.md).
- `apps/web/src/capa/agrupacion.test.ts`: el índice construido en un Worker y rehidratado da las mismas escenas, con lo mismo dentro de cada elemento, y las mismas transiciones entre cualquier par de niveles que el construido en el hilo.
- `apps/web/src/capa/nacional.test.ts`: de lejos, solo el resumen; desde el zoom 8, las provincias que corta la vista; en el borde entre dos provincias ningún emplazamiento está dos veces y cada número cuadra, y cada provincia sale de su hexágono al acercar o al llegar.
- `apps/web/src/mapa/vista.test.ts`: arrastrar o acercar varios niveles no vuelve a agrupar hasta que el mapa se asienta; al alejar, agrupa por el camino solo si cambia de nivel y la vista se ha salido de lo dibujado; se recoloca como mucho una vez por fotograma.
- `apps/web/src/ficha/servicio.test.ts`: la precarga pide como mucho `LOTES_PRECARGADOS` lotes, los que más claves tienen; abrir después una ficha de ese lote no pide nada, y un fallo al precargar no falla y no se guarda.
- `packages/ui/src/mapa/estilo.test.ts`: lo que se pide por adelantado (`RECURSOS_INICIALES_MAPA_BASE`) es el TileJSON del estilo y los glifos de los rótulos que se ven de lejos. Si alguien cambia la letra o la fuente del callejero, la precarga no se queda pidiendo lo que ya no se usa.

Los fps y los tiempos no tienen prueba automática. Dependen de la máquina, de la GPU y de OpenFreeMap, y en la CI no hay ni GPU ni un móvil con el que compararlos.

## Límites de la medida

- La GPU es la de un ordenador de escritorio. Lo que cuesta pintar el mapa en la GPU de un móvil, a DPR 2,6 o 3, no sale aquí. Limitar `pixelRatio` de MapLibre a 2 quitaría un 40 % de píxeles, pero sin poder medirlo no se ha tocado.
- La red emulada de DevTools reparte el ancho de banda a partes iguales y no hace caso de las prioridades (`fetchpriority`), a diferencia de HTTP/2 en Vercel.
- Playwright no cuenta los bytes del worker de MapLibre cuando lo pide el propio worker. Antes salía con 0,3 KB. Ahora se precarga desde la página y cuenta 141 KB: por eso «web» pasa de 454 a 595 KB sin que se descargue nada más.
- Los números llevan ruido de ±1 fotograma largo por gesto entre rondas. Por eso van en medianas de tres rondas alternadas.
