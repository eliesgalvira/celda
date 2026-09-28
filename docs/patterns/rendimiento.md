# Rendimiento

Qué se midió en septiembre de 2026, qué se cambió por esas medidas, qué se descartó y cómo repetirlo. La queja de partida fue la del autor con su Android: «no se ve lento, pero tampoco diría que es fluido».

## Cómo se mide

`tools/rendimiento` abre Celda en Chromium sin interfaz, con GPU (`--use-angle=vulkan`), como un móvil: 390 × 844 px, DPR 2,6, pantalla táctil, la CPU frenada ×4 y ×6 por CDP y la red de «Fast 4G» de DevTools (9 Mb/s de bajada, 1,5 de subida, 165 ms de latencia). Sirve la web construida y las capas publicadas con un servidor local que imita a Vercel: las cabeceras de `vercel.json` y gzip. El mapa base viene de OpenFreeMap de verdad, así que hace falta conexión.

Cada ronda abre una visita nueva, con la caché vacía, y hace siempre lo mismo:

1. Carga: espera al mapa base y a los marcadores, y anota los tiempos, los bytes y las tareas largas.
2. Con Barcelona entera (zoom 10,75, hexágonos): arrastra con un dedo, pellizca hacia dentro y hacia fuera y gira la rueda.
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

## Qué entró

**La cadena de descargas del mapa base se adelanta** (`apps/web/src/mapa/precarga.ts`). Antes iba en serie: la web, MapLibre al acabar de pintar la pantalla, su worker al crear el mapa, el TileJSON, las teselas y por último los glifos, que la primera tesela necesita para sus rótulos. Ahora `entrada.tsx` importa `precarga.ts` lo primero, y en cuanto llega el código de la web pide MapLibre, deja el código del worker en la caché HTTP con un `prefetch` y precarga el TileJSON y los glifos que usa la vista inicial (`RECURSOS_INICIALES_MAPA_BASE` en `packages/ui/src/mapa/estilo.ts`). Un `import()` normal no empieza a descargar hasta que acaba la tarea que lo llama, y evaluar la web es una tarea de 300 ms con ×4. Por eso `vite.config.ts` pone el propio trozo en `modulePreload.resolveDependencies`: el cargador de Vite lo pide en el acto con un `<link rel="modulepreload">`. Con ×4, el mapa base sale 510 ms antes.

**Los marcadores salen en cuanto existe el mapa.** Solo necesitan su proyección, y la capa llega un segundo antes que la primera tesela. Se pintan sobre el fondo liso mientras sigue el aviso «Cargando el mapa base», como ya pedía el ADR 0010 si el callejero no llega. Con ×4, los primeros marcadores salen 1,1 s antes.

**La agrupación se decide al asentarse el mapa** (`apps/web/src/mapa/vista.ts`). Antes, cada vez que el zoom cruzaba un nivel, a mitad del gesto, se volvía a agrupar: crear y quitar decenas de nodos, en los fotogramas en que MapLibre también trabaja más. Un pellizco de tres niveles lo hacía tres veces. Ahora, al acercar, lo dibujado se separa con el zoom y la agrupación nueva llega al soltar, con su transición. Al alejar sí se agrupa por el camino, pero solo si además la vista se ha salido de la caja con margen ya dibujada, para que los bordes no queden vacíos. Es lo que quita los fotogramas de más de 50 ms con ×4.

**Las fichas de lo que se ve de cerca se descargan antes de tocarlas.** Cuando la agrupación se decide y hay marcadores de emplazamiento sueltos a la vista, `FichasPublicadas.precargar` pide sus lotes, como mucho dos (`LOTES_PRECARGADOS`), los que más marcadores tienen. De cerca eso cubre casi siempre lo que se ve; más lejos, los sueltos caen en muchos lotes y no se sabe cuál se va a abrir. En Barcelona hay once lotes, así que una visita pide como mucho esos once, y son las mismas peticiones que haría al abrir las fichas (ADR 0004 y 0008). Con ×4, la primera ficha sale en 165 ms en vez de 312.

**Las secciones de la ficha fuera de la vista no se maquetan al abrirla** (`content-visibility: auto` en `SeccionFicha`). En el móvil, al abrir la ficha solo se ve el resumen. En una traza con ×4, la tarea de abrir la primera ficha bajó de 155 a 125 ms.

## Qué se descartó

- **Reciclar los nodos de los marcadores.** En el fotograma de reagrupar, crear los nodos es unos 8 ms de JavaScript con ×4; el estilo de los nodos nuevos, 11. Reciclar ahorraría parte de lo primero y poco de lo segundo, porque el marcador que entra se anima con `@starting-style`, que solo funciona al insertar el nodo. Habría que rehacer esas animaciones con la Web Animations API, y un nodo reciclado con el foco del teclado pasaría a ser otro emplazamiento. No compensa.
- **Indexar supercluster en un worker.** Crear el agrupador cuesta unos 29 ms con ×4, una vez, al llegar la capa. Las escenas y las transiciones se piden de forma síncrona en cada reagrupación, y con un worker pasarían a ser asíncronas.
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
- `apps/web/src/mapa/vista.test.ts`: arrastrar o acercar varios niveles no vuelve a agrupar hasta que el mapa se asienta; al alejar, agrupa por el camino solo si cambia de nivel y la vista se ha salido de lo dibujado; se recoloca como mucho una vez por fotograma.
- `apps/web/src/ficha/servicio.test.ts`: la precarga pide como mucho `LOTES_PRECARGADOS` lotes, los que más claves tienen; abrir después una ficha de ese lote no pide nada, y un fallo al precargar no falla y no se guarda.
- `packages/ui/src/mapa/estilo.test.ts`: lo que se pide por adelantado (`RECURSOS_INICIALES_MAPA_BASE`) es el TileJSON del estilo y los glifos de los rótulos que se ven de lejos. Si alguien cambia la letra o la fuente del callejero, la precarga no se queda pidiendo lo que ya no se usa.

Los fps y los tiempos no tienen prueba automática. Dependen de la máquina, de la GPU y de OpenFreeMap, y en la CI no hay ni GPU ni un móvil con el que compararlos.

## Límites de la medida

- La GPU es la de un ordenador de escritorio. Lo que cuesta pintar el mapa en la GPU de un móvil, a DPR 2,6 o 3, no sale aquí. Limitar `pixelRatio` de MapLibre a 2 quitaría un 40 % de píxeles, pero sin poder medirlo no se ha tocado.
- La red emulada de DevTools reparte el ancho de banda a partes iguales y no hace caso de las prioridades (`fetchpriority`), a diferencia de HTTP/2 en Vercel.
- Playwright no cuenta los bytes del worker de MapLibre cuando lo pide el propio worker. Antes salía con 0,3 KB. Ahora se precarga desde la página y cuenta 141 KB: por eso «web» pasa de 454 a 595 KB sin que se descargue nada más.
- Los números llevan ruido de ±1 fotograma largo por gesto entre rondas. Por eso van en medianas de tres rondas alternadas.
