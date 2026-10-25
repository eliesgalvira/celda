# Efectos que abren recursos

Léelo antes de escribir un `createEffect` o un `onSettled`, o de tocar algo que abra el GPS, la brújula, escuchadores, temporizadores, fotogramas, peticiones o el Worker.

## El fallo que lo motivó

En septiembre de 2026 el GPS se abrió 3135 veces en 7 s en Chromium (commits d34ea08 y 1351233). El efecto que lo abría leía todo el estado de la ubicación en su primera función. Cada lectura del GPS escribía ese estado, el efecto volvía a correr aunque el `true` fuera el mismo, cerraba el GPS (`clearWatch`) y lo reabría, y el navegador entregaba al momento la posición en caché. Vuelta a empezar. La brújula tenía el mismo fallo. Las pruebas no lo vieron por dos motivos: el GPS de prueba no emitía al abrirse y nadie contaba aperturas.

## Qué hace Solid 2

Comprobado con la versión de `solid-js` del catálogo en `packages/ui/src/recurso.test.ts`, bloque «Solid 2: igualdad de efectos y memos». Si una subida de versión lo cambia, esas pruebas fallan.

- La segunda función de `createEffect` corre otra vez, y antes llama a la limpieza que devolvió, cada vez que cambia algo que lee la primera. No compara lo que devuelve la primera: ni un primitivo igual (`true` y `true`) ni el mismo objeto. En el código de Solid, el nodo de un efecto nace con `_equals: false`.
- `createMemo` compara con `===` por defecto. Un primitivo igual no avisa a quien lo lee; un objeto nuevo con los mismos campos, sí. Con `{ equals }` compara con esa función.
- Una señal a la que se escribe el mismo valor no avisa.
- `onSettled` corre una vez, no sigue lo que lee y llama a su limpieza al desmontar.
- `onCleanup` dentro de la segunda función de un efecto no se llama nunca: la limpieza hay que devolverla. En el cuerpo del dueño sí se llama al desmontar.
- Una fila que sale de una lista (`<For>`, `mapArray`) en el mismo flush en que vuelve a correr un memo suyo cierra lo que abrió esa vuelta. Con rc.9 no lo hacía: un `recurso` dentro de un `<Show>` de la fila quedaba abierto. Lo arregló `@solidjs/signals` rc.10, y lo comprueba la prueba de `recurso.test.ts` sobre la fila que sale de una lista.

Así que un efecto solo se frena con un memo delante que compare. `recurso()` lo lleva dentro.

## recurso()

`packages/ui/src/recurso.ts`, en `@celda/ui` porque lo usan la librería y la web.

```ts
recurso(nombre, clave, abrir, { iguales });
recursoFijo(nombre, abrir); // abre al montar, cierra al desmontar
```

- `clave` es una lectura reactiva. `false`, `null` o `undefined` dejan el recurso cerrado.
- La clave pasa por un memo con `iguales` (por defecto `Object.is`). Mientras no cambie, no se cierra ni se abre nada.
- Una clave que es un objeto nuevo en cada cálculo necesita comparador: `mismosCampos` compara campo a campo, `mismasListas` elemento a elemento, `mismaCoordenada` (`@celda/dominio/area`) por coordenadas.
- `abrir(clave)` corre sin seguimiento y devuelve el cierre, que también corre sin seguimiento. Lo que lean no reabre nada, y no hace falta `untrack` dentro. El cierre recibe la clave con la que se va a reabrir, o `undefined` si se cierra del todo.
- `nombre` identifica el recurso ante el vigilante.

Ejemplo, el GPS (`apps/web/src/ubicacion/controlador.ts`):

```ts
recurso("gps", () => gpsEncendido(ubicacion().estado), () => {
  const parar = new AbortController();
  void runtime.runPromiseExit(/* seguir el GPS */, { signal: parar.signal });
  return () => parar.abort();
});
```

Cada lectura cambia `ubicacion()`, pero la clave sigue siendo `true` y el GPS sigue abierto.

## El vigilante

En desarrollo y en las pruebas (`import.meta.env.DEV`), `recurso()` cuenta las aperturas de cada nombre. Si pasan de `MAXIMO_POR_SEGUNDO` (10) en un segundo, avisa en la consola con `[Celda]` y apunta el exceso. `packages/ui/src/pruebas/vigilante.ts` se carga en todas las pruebas de `apps/web` y `packages/ui` y hace fallar la prueba con excesos, aunque lo que comprueba salga bien.

El mismo fichero hace fallar la prueba en la que Solid avisa de algo, con el código del aviso y el camino de dueños donde salió. El más común es `STRICT_READ_UNTRACKED`, que sale al leer una señal o un memo donde Solid no lo sigue, en el cuerpo de un componente o en la segunda función de un efecto, y es la única forma de distinguir una lectura que no sigue nada a propósito de una que debería seguir algo. Si es a propósito, como el valor inicial de una señal o el estado que un efecto consulta sin depender de él, la lectura va en `untrack`. El vigilante lee los avisos del canal de diagnósticos de Solid, `OBSERVE.diagnostics`.

Un bucle como el del GPS iba a 450 por segundo.

El mismo fichero desmonta después de cada prueba lo que montó. `@solidjs/testing-library` solo lo hace con los globales de Vitest, que no están activados, y las apps de las pruebas anteriores seguían montadas, con el GPS y los escuchadores abiertos, reaccionando a la dirección de la siguiente prueba. El vigilante lo destapó al contar once paneles abiertos en un segundo.

## La regla celda/abrir-con-recurso

`tools/oxlint-plugin-celda/reglas/abrir-con-recurso.ts`. Marca como error, dentro de la segunda función de `createEffect` o `createRenderEffect` (también en la forma `{ effect, error }`) o dentro de `onSettled`, incluidas las funciones anidadas:

- `watchPosition`, `getCurrentPosition`, `addEventListener`, `on`, `once`, `postMessage`, `observe`;
- `fetch`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback`, solas o desde `window`, `globalThis` o `self`;
- `indexedDB.open`;
- `new Worker`, `SharedWorker`, `WebSocket`, `EventSource`, `BroadcastChannel` y los observadores;
- `runPromise`, `runPromiseExit`, `runFork`, `runCallback` de un runtime de Effect.

Además, `eslint/no-restricted-imports` no deja importar `onCleanup` de `solid-js` fuera de `recurso.ts` y su prueba. Lo que se cierra lo cierra `recurso()`, y un `onCleanup` en la segunda función de un efecto no se llamaría nunca.

La regla solo ve lo escrito en esa función. Lo que se abra a través de otra función llamada desde ahí (`calcular()`, `props.alVer()`) no lo ve; para eso están el vigilante y la prueba de resistencia. Contra `celda/v1` marca el GPS, la brújula, el permiso, el clic del mapa, los fotogramas de los marcadores, los cálculos de celdas y los escuchadores de las explicaciones.

## Dobles de prueba

Imitan lo que hace el navegador con el recurso, no lo que conviene a la prueba:

- El GPS (`ubicacion/pruebas.ts`) entrega al abrirse la última posición que tenga, como `watchPosition` con `maximumAge`; la primera, `enCache`. Su permiso llega un momento después de montar y no se acaba. `permisoLeido()` dice si la app ya lo tiene.
- La brújula (`mejorar/pruebas.ts`) da lo último leído al empezar a escuchar, como `deviceorientation` al añadir el escuchador; la primera vez, `rumbo`. `pedirPermiso` contesta en otra tarea.
- El almacén y el buscador contestan en otra tarea, como IndexedDB y la red.

Con el GPS y la brújula nuevos, las pruebas «con una posición ya guardada en el navegador…» (`Ubicacion.test.tsx`) y «con el móvil ya apuntando…» (`MejorarSenal.test.tsx`) fallan con el código de antes de d34ea08 y 1351233.

## Prueba de resistencia

`tools/rendimiento/src/resistencia.ts`. Abre la web construida en Chromium sin interfaz, con WebGL por SwiftShader, como un Android de pantalla ancha con el permiso de ubicación y los sensores concedidos. Sirve una capa sintética de 25 emplazamientos (`capaSintetica.ts`) y contesta en local el mapa base con teselas vacías (`red.ts`), así que no necesita GPU ni conexión. Hace dos pasadas, cada una en un contexto nuevo, una con el mapa base principal y otra con el de reserva, con OpenFreeMap cortando la conexión. Hasta el 20/10/2026 iba siempre con la reserva sin querer, porque el TileJSON falso no declaraba sus capas (#85, ver [rendimiento.md](rendimiento.md#las-pruebas-del-navegador-sin-red-20102026-85)). En cada pasada abre un emplazamiento, enciende el GPS y la brújula, filtra por Digi (salen también, más claros, los de Movistar, la red que usa, ADR 0026), espera a que la página quede quieta y la deja así 30 s. Hasta el 20/10/2026 abría además la vista de interferencia, con las celdas calculadas a zoom 16, y pulsaba una tecla que quitaba la salvedad de las celdas antes de la ventana quieta (#81). Desde entonces espera también a que la región del mapa deje de estar ocupada (`esperarVistaInicial`), con el mapa base y el resumen ya puestos. El aviso del mapa base que esperaba antes ya no salía desde el 05/10/2026, y quien esperaba de verdad al mapa base era el clic en «Interferencia», que no se activaba hasta tenerlo. Sin él, el paso al mapa de reserva, que entonces se pedía al IGN de verdad, caía a veces dentro de la ventana quieta: 2 de 6 pasadas fallaron con 58 `addEventListener`, 1 `fetch`, unos 250 `postMessage` y 25 fotogramas de más. Quieta es 2 s sin que crezca nada salvo `setTimeout` y sin fotogramas pendientes; si en 30 s no lo consigue, falla. Mientras, el GPS da una lectura por segundo en el mismo sitio con otra precisión y la brújula diez por segundo. Un guion inyectado (`contador.ts`) cuenta las llamadas; la prueba falla si en esos 30 s crecen más de:

| API | Tope | Por qué |
|---|---|---|
| `watchPosition`, `clearWatch`, `getCurrentPosition` | 0 | El GPS se abre una vez, al pulsar. |
| `addEventListener`, `removeEventListener` | 0 | Sin tocar la pantalla no hay nada nuevo que escuchar. |
| `fetch`, `new Worker`, `postMessage`, `setInterval` | 0 | Con el punto quieto no se pide ni se recalcula nada. |
| `requestAnimationFrame` | 0 | No hay nada animándose. |
| `setTimeout` | 2 por lectura (660) | Effect agenda con `setTimeout` el trabajo de cada lectura que llega por una cola. |

También falla si al preparar `watchPosition` se llamó más de una vez, si la web no usa el mapa base de la pasada y si la página o sus Workers piden algo que la prueba no sabe contestar. En ese caso da su URL. Chromium no resuelve ningún nombre salvo 127.0.0.1, así que nada de lo que pida llega a la red. Hasta el 04/10/2026 esperaba 3 s fijos antes de empezar a contar, y en una CI lenta el último fotograma de MapLibre llegaba ya dentro de la ventana: un `removeEventListener` sin `addEventListener`, el de la cancelación del fotograma, sin nada abierto. Con la espera recortada a 0,9 s fallaba igual 211d945, de antes de las celdas con la red usada. El 28/09/2026 creció 0 en todo salvo `setTimeout`, que subió 332 con 330 lecturas. Con el GPS de antes de d34ea08 salieron 3825 `watchPosition` en 7 s; con la vista de interferencia de antes de este arreglo, 140 `postMessage` y 52 fotogramas en 10 s.

Para correrla, desde la raíz de Celda:

```sh
nix develop .#resistencia     # trae Chromium en CELDA_CHROMIUM
pnpm run build
pnpm run resistencia          # --segundos 10 para pasadas cortas
```

Fuera de ese entorno usa `/usr/bin/chromium`. En la CI va en su propio trabajo, `resistencia`, de `.github/workflows/celda.yml`.

## Auditoría

Septiembre de 2026, sobre `celda/v1` después de d34ea08 y 1351233. Todos los `createEffect`, `onSettled` y memos que abren algo, y todo lo que abre un recurso en `apps/web/src` y `packages/ui/src`. «Antes» dice qué hacía el sitio en `celda/v1`; la columna «Ahora», con qué se abre en esta rama.

Veredictos: **seguro**, no podía reabrirse solo ni por cambios ajenos; **arreglado**, lo hacía y ya no; **riesgo**, no lo hacía, pero volvía a correr por cambios que no le tocan y dependía de que otra pieza lo frenara.

### Lo que se abre desde Solid

| Sitio | Abre | Clave (depende de) | Antes | Veredicto | Ahora |
|---|---|---|---|---|---|
| `ubicacion/controlador.ts`, GPS | `watchPosition` por el servicio | `gpsEncendido(estado)` | Reabría con cada lectura hasta d34ea08; después, un memo lo frenaba | arreglado (d34ea08) | `recurso("gps")` |
| `ubicacion/controlador.ts`, permiso | `permissions.query` y su `change` | fija | `onSettled`, una vez | seguro | `recursoFijo("geolocalizacion:permiso")` |
| `ubicacion/controlador.ts`, punto guardado | lectura de IndexedDB | fija | `onSettled`, una vez | seguro | `recursoFijo("almacen:punto-elegido")` |
| `mejorar/MejorarSenal.tsx`, brújula | `deviceorientationabsolute` y una espera de 3 s | `escuchando(estado)` | Reabría con cada lectura hasta 1351233 | arreglado (1351233) | `recurso("brujula")` |
| `mejorar/MejorarSenal.tsx`, disponibilidad | lectura del servicio | fija | `onSettled`, sin cancelar al desmontar | seguro | `recursoFijo("brujula:disponibilidad")`, descarta la respuesta tras desmontar |
| `ajustes/ajustes.ts` | lectura de IndexedDB | fija | `onSettled` | seguro | `recursoFijo("almacen:ajustes")` |
| `datos.tsx`, runtime | los servicios (Worker, GPS…) hasta desmontar | fija | `onSettled` que solo cierra | seguro | `recursoFijo("runtime")` |
| `mapa/PantallaMapa.tsx`, mapa | MapLibre, WebGL, sus workers y escuchadores | fija | `onSettled` | seguro | `recursoFijo("mapa")` |
| `mapa/PantallaMapa.tsx`, capa | `fetch` de `vigente.json` y del resumen; con él, las capas de las provincias de la vista inicial y de la ficha de la dirección | fija | `onSettled` | seguro | `recursoFijo("capa")`, que al cerrar cancela también las provincias que se estén pidiendo |
| `mapa/PantallaMapa.tsx`, provincias | `fetch` de la capa de una provincia y su índice en el Worker de capas | la vista que decide `Marcadores` (`alCambiarVista`), la vista inicial, el cambio de vista (desde la segunda función de un efecto sobre `vistaDibujada`), un punto tocado, el ejercicio, un enlace sin provincia o el botón de reintentar | — | seguro | `pedirProvincias`, desde esos sitios, una vez por provincia y visita; una que falla no se vuelve a pedir sola al mover el mapa. Lo que se está pidiendo lo cancela `recursoFijo("capa")` |
| `mapa/PantallaMapa.tsx`, enlace sin provincia o con una clave de antes | lectura de una parte del índice de claves | la clave del enlace, con resumen, mientras no dice su provincia o su provincia ha llegado sin esa clave | — | seguro | `recurso("capa:clave")`, que cancela la lectura si cambia el enlace |
| `mapa/PantallaMapa.tsx`, provincias de la vista inicial | las provincias de lo que se verá al abrir, con `pedirProvincias` | si ya se sabe la vista inicial | nuevo (#52) | riesgo → seguro | `recurso("capa:vista-inicial")`; no cierra nada. Hasta el 25/10/2026 la clave era el encuadre, que con un punto guardado es la caja de su provincia, un objeto nuevo cada vez que llegaba un contorno de la cabecera. Se volvía a abrir con cada uno, y lo frenaba que `pedirProvincias` no repite las provincias ya pedidas |
| `mapa/PantallaMapa.tsx`, puntos de toda España | `fetch` del fichero de los puntos | el intento, con la vista de puntos y el resumen | nuevo (#74) | seguro | `recurso("capa:puntos")`; cada intento se pide una vez, y lo que está en marcha termina aunque se cambie de vista |
| `ajustes/tema.ts` (`repintarConElTema`, desde `PantallaMapa`), colores del mapa | repinta el mapa y, con Sistema, escucha el `change` de `matchMedia("(prefers-color-scheme: dark)")` | el mapa pintado y el tema elegido, por `mismosCampos` | nuevo (#75); desde el #76 la clave lleva la elección | seguro | `recurso("mapa:tema")`; cada elección nueva repinta una vez, y con Claro u Oscuro no escucha al sistema |
| `mapa/PantallaMapa.tsx`, ancho de pantalla | `matchMedia` y su `change` | fija | `onSettled` | seguro | `recursoFijo("pantalla:escritorio")` |
| `mapa/PantallaMapa.tsx`, clic en el mapa | `map.on("click")` | el mapa listo | `createEffect(mapaListo)`, cambia al crear el mapa | seguro | `recurso("mapa:clic")` |
| `mapa/PantallaMapa.tsx`, modelo del móvil | `getHighEntropyValues` | fija | `onSettled` | seguro | `recursoFijo("navegador:modelo")`, descarta la respuesta tras desmontar |
| `mapa/lugar.ts`, lugares de la cabecera | las lecturas de `provincias.json` y de los contornos, hasta desmontar | fija | nuevo (#52) | seguro | `recursoFijo("lugares")`, que al cerrar cancela lo que se esté leyendo |
| `mapa/lugar.ts`, provincias | lectura de `provincias.json` | si hay algún punto que situar y aún no se han pedido | nuevo (#52) | seguro | `recurso("lugares:provincias")`; se piden una vez, y la clave pasa a falso al pedirlas |
| `mapa/lugar.ts`, contornos | lectura del contorno de cada provincia | las provincias en cuya caja cae un punto que situar y cuyo contorno falta, por `mismasListas` | nuevo (#52) | seguro | `recurso("lugares:contornos")`; cada contorno se pide una vez por visita |
| `mapa/vistaInicial.ts`, gestos | `map.on("movestart")`, para saber si una persona ha movido el mapa | el mapa, con la vista inicial activa | nuevo (#52) | seguro | `recurso("vista-inicial:gestos")` |
| `mapa/Marcadores.tsx`, vista del mapa | `map.on("move"/"moveend")`, sin fotograma propio | el mapa | `onSettled` con `untrack` | seguro | `recurso("marcadores:vista")` |
| `mapa/Marcadores.tsx`, rótulos de ciudad | `map.on("idle")`, que lee los rótulos colocados con `queryRenderedFeatures` | el mapa, con el lector del código del mapa | nuevo (#66) | seguro | `recurso("marcadores:rotulos")`; la lectura se compara por claves y zoom, así que un `idle` sin cambios no decide nada |
| `mapa/Marcadores.tsx`, movimiento reducido | `matchMedia` | fija | `onSettled` | seguro | `recursoFijo("marcadores:movimiento-reducido")` |
| `mapa/Marcadores.tsx`, paso a los logos | un `setTimeout` que acaba el paso y, al alejar, otro que vuelve a encender los puntos del mapa | el último paso entre los puntos y los logos, un objeto nuevo solo al cruzar el zoom de los logos con la vista de puntos | nuevo (#74) | seguro | `recurso("marcadores:traspaso")`; con la preferencia de reducir movimiento no espera nada |
| `mapa/Marcadores.tsx`, vuelo al cambiar de vista | una capa propia de MapLibre (`capaDeVuelo`) con los puntos en WebGL | cada cambio de vista, un objeto nuevo solo cuando la vista cambia | nuevo (#74) | seguro | `recurso("marcadores:vuelo")`; la capa se quita sola al acabar, y el cierre la quita si sigue puesta |
| `mapa/Marcadores.tsx`, precarga de fichas | `fetch` de lotes por `alVer` | las claves sueltas que se ven | Volvía a pedir con cada escena, también al seleccionar un marcador; la caché del servicio evitaba la red salvo tras un fallo | riesgo → seguro | `recurso("fichas:precarga")`, `mismasListas`; desde el #69 solo pide si ha cambiado la vista o han llegado provincias: cambiar el filtro de compañías no descarga nada |
| `filtro/enMapa.ts`, aplicar el filtro de compañías | un `setTimeout` de `ESPERA_DEL_FILTRO_MS` (150 ms) | el filtro guardado, por `mismoFiltro` | nuevo (#69) | seguro | `recurso("filtro:aplicar")`; cada toque cierra la espera anterior, así que varios seguidos aplican el último una vez. Lo guardado al abrir vale al momento, sin temporizador |
| `filtro/enMapa.ts`, agrupaciones del filtro | `agrupacion` del servicio de capa: un mensaje al Worker de capas por provincia y filtro nuevo | el filtro aplicado, en texto, y la lista de las provincias que han llegado, comparada elemento a elemento | nuevo (#69) | riesgo → seguro | `recurso("capa:filtro")`; solo pide las provincias sin la agrupación del filtro. Cerrarlo no corta lo ya mandado, que el servicio termina y guarda (`Effect.uninterruptible` tras su turno), así que llegar otra provincia no lo repite. Del 22/10/2026 (5c2dcd5) al 25/10/2026 la lista se comparaba por referencia, y era nueva cada vez que cambiaba el estado de alguna provincia, también cuando una empezaba a pedirse: el recurso se cerraba, descartaba las respuestas que esperaba y volvía a pedir las que faltaban. Lo comprueba `filtro/enMapa.test.tsx` |
| `ui/filtro/FiltroDeCompanias.tsx` | `pointerdown` del documento | fija | nuevo (#69) | seguro | `recursoFijo("menu-de-companias:fuera")` |
| `mapa/CapaAgrupada.tsx`, latido | `requestAnimationFrame` hasta que acaba la transición | si queda algo yéndose | Se pedía desde la segunda función del efecto; el bucle se paraba solo | seguro | `recurso("marcadores:latido")` |
| `ubicacion/ReferenciaEnMapa.tsx` | `map.on("move")`, sin fotograma propio | el mapa | `onSettled` | seguro | `recurso("referencia:movimiento")` |
| `puntos/enMapa.ts`, datos de los puntos | una URL `blob:` con el GeoJSON de los puntos | los puntos, que llegan una vez por visita | nuevo (#74) | seguro | `recurso("puntos:url")`; el cierre revoca la URL |
| `ejercicio/PanelEjercicio.tsx`, zonas | lectura del índice de zonas y de los habitantes por barrio | fija | `onSettled` | seguro | `recursoFijo("ejercicio:zonas")` |
| `ejercicio/PanelEjercicio.tsx`, provincias | pide la capa de la provincia de la zona y la de las vecinas del borde a la pantalla del mapa, que no repite las ya pedidas | la provincia, un texto; las que faltan, unidas en un texto | nuevo | seguro | `recurso("ejercicio:provincia")`, `recurso("ejercicio:vecinas")` |
| `ejercicio/PanelEjercicio.tsx`, contornos | lectura del contorno de la provincia | la provincia de un municipio con capa | nuevo | seguro | `recurso("ejercicio:contornos")`; cada provincia se lee una vez |
| `ubicacion/Ubicacion.tsx`, atribución del buscador | lectura del servicio | fija | `onSettled` | seguro | `recursoFijo("buscador:atribucion")`, descarta la respuesta tras desmontar |
| `ubicacion/Ubicacion.tsx`, búsqueda de direcciones | petición al buscador | cada envío del formulario | desde el manejador; una respuesta vieja se descartaba con un contador y la petición seguía al cerrar la elección | seguro | `recurso("buscador:busqueda")`, la cierra la búsqueda siguiente o cerrar la elección |
| `ui/controles/MenuDeControles.tsx` | `pointerdown` del documento | fija | `onSettled` | seguro | `recursoFijo("menu-de-controles:fuera")` |
| `ui/ubicacion/MenuUbicacion.tsx` | `pointerdown` del documento | fija | `onSettled` | seguro | `recursoFijo("menu-de-ubicacion:fuera")` |
| `ui/termino/Termino.tsx` | `pointerdown`, `keydown`, `resize`, `scroll` y fotogramas | fija | `onSettled` | seguro | `recursoFijo("termino:explicacion")` |
| `ui/panel/PanelEmplazamiento.tsx` | `resize` de la ventana | fija | `onSettled` | seguro | `recursoFijo("panel:ventana")` |
| `ui/DisposicionMapa.tsx` | `setTimeout` de 5 s (`ABIERTOS_MS`) que pliega los créditos | si los créditos están abiertos | `onSettled` | seguro | `recurso("creditos:pliegue")`; abrirlos empieza la espera y plegarlos la cierra |
| `buzon/DialogoAportaciones.tsx` | lectura de las aportaciones del dispositivo | si se ve la lista | nuevo (#56) | seguro | `recurso("buzon:aportaciones")`; se lee al abrir la lista y otra vez al volver a ella, por si se ha compartido algo |
| `buzon/DialogoCorroborar.tsx` | el borrador de la corroboración, con su identificador y su fecha | fija | nuevo (#56) | seguro | `recursoFijo("buzon:corroboracion")` |
| `foto/enMapa.ts`, foto aérea | el estado `fotoAerea` del estilo, la visibilidad de la capa de la foto y, con ella, las teselas del PNOA | el lienzo y si se ve: encendida, con la cámara sin volar y sin un «Ver el edificio» por despegar, por `mismosCampos` | nuevo (#64); desde el #67 se quita durante los vuelos | seguro | `recurso("mapa:foto")`; no cierra nada: apagar es otra clave. Encenderla y apagarla a mitad de vuelo no toca el mapa hasta que llega |
| `foto/enMapa.ts`, vuelos de la cámara | `map.on("movestart"/"moveend")` | el lienzo | nuevo (#67) | seguro | `recurso("mapa:vuelos")`; el aviso escribe el lienzo que vuela, que no cambia mientras dura el vuelo. Un vuelo cambia la clave de la foto dos veces, al despegar y al llegar; un gesto, un salto o un vuelo que interrumpe otro en la misma tarea, ninguna |
| `foto/enMapa.ts`, «Ver el edificio» | `flyTo`, `moveend` y un `idle`, y el edificio resaltado | el lienzo y el pedido de la pulsación, un objeto nuevo por pulsación; otro emplazamiento lo borra | nuevo (#64) | seguro | `recurso("mapa:edificio")`; el cierre quita los escuchadores y, si no hay otro pedido, el resaltado |
| `foto/enMapa.ts`, pista sin contorno | una espera de 4 s (`esperar`) | el resultado de la última pulsación si no encontró edificio | nuevo | seguro | `recurso("mapa:edificio-pista")`; al vencer apunta ese resultado como visto, y la clave no cambia |
| `foto/enMapa.ts`, pista «Acércate» | una espera de 4 s (`PISTA_ACERCATE_MS`) | la última pulsación del control desde demasiado lejos, mientras el mapa siga lejos | nuevo (05/10/2026) | seguro | `recurso("mapa:foto-acercate")`; otra pulsación es otro objeto y vuelve a contar el plazo, y llegar al zoom de la foto la cierra |
| `ui/Dialogo.tsx` | `showModal` y el foco | fija | `onSettled` | seguro | `recursoFijo("dialogo")` |

### Efectos y memos que no abren nada

| Sitio | Hace | Depende de | Veredicto |
|---|---|---|---|
| `App.tsx` | `document.title` | la ruta | seguro |
| `ficha/PanelFicha.tsx` | vuelve al resumen | la clave (`defer`) | seguro |
| `ficha/PanelFicha.tsx`, memo `ficha` | lee el lote (red) con `leerEnSolid` | la clave y la provincia del enlace, dos textos | seguro |
| `ficha/Exposicion.tsx`, memo `baremo` | lee el baremo de exposición de la provincia (red) con `leerEnSolid` | la provincia, un texto; el componente se monta una vez por provincia | seguro |
| `ejercicio/PanelEjercicio.tsx` | olvida las bandas leídas | la zona (`defer`) | seguro |
| `ejercicio/PanelEjercicio.tsx` | manda la zona al mapa | la zona resuelta y el dibujo, calculado en la primera función | seguro |
| `mapa/PantallaMapa.tsx` | lleva el mapa a la primera lectura (`easeTo`) | todo el estado de la ubicación; solo actúa al pasar de «pidiendo» a GPS | seguro |
| `mapa/PantallaMapa.tsx` | `setData` de la zona y `fitBounds` | mapa y zona; el encuadre solo al cambiar de zona | seguro |
| `mapa/PantallaMapa.tsx` | salta al emplazamiento de la dirección | una vez | seguro |
| `mapa/PantallaMapa.tsx` | `setData` de la línea hasta el punto | el mapa, el emplazamiento seleccionado y el punto, estos dos por coordenadas | seguro |
| `mapa/PantallaMapa.tsx` | apunta que ya se sabe la vista inicial | si se sabe el encuadre, un booleano | seguro |
| `mapa/PantallaMapa.tsx` | abre la ficha del punto tocado cuando llega su provincia | el punto pendiente y el estado de su provincia | seguro |
| `mapa/vistaInicial.ts` | pone el mapa en la vista inicial (`fitBounds`), una sola vez | el mapa y el encuadre | seguro |
| `mapa/lugar.ts` | escribe el sitio que nombra la cabecera | la vista y las zonas leídas; el sitio se compara por tipo y nombre | seguro |
| `mapa/CapaAgrupada.tsx` | calcula lo pintado y enciende el latido | la escena | seguro |
| `mapa/Marcadores.tsx` | `setData` de los huecos de los marcadores (#66) | los huecos de la escena y cada `idle`; con el mapa moviéndose no hace nada, y si son los mismos no toca el mapa | seguro |
| `mapa/Marcadores.tsx` | escribe en el estado del estilo los municipios que son zona (`quitarRotulosDeMunicipios`, con `setGlobalStateProperty`), y sus rótulos del mapa base se quitan | los nombres de los municipios de la escena, con `mismasListas` | seguro |
| `puntos/enMapa.ts` | pone en el estilo los puntos, si se ven, su fundido, el filtro de compañías y el elegido, en cinco efectos (#74) | el lienzo y un valor cada uno, el filtro por `mismoFiltro`; MapLibre no hace nada si ya estaba igual | seguro |
| `ui/Eleccion.tsx`, `ui/Termino.tsx`, `ui/Dialogo.tsx` | escriben el campo, colocan, enfocan | un valor o un título | seguro |

### Lo que se abre fuera de los efectos

Se abre una vez por lo que lo crea, no por una reejecución:

- Al cargar el módulo: `lib/rutas.ts` (`popstate`) y `mapa/precarga.ts` (MapLibre, `prefetch` y `preload`).
- Una vez por mapa: `mapa/mapaBase.ts` (`sourcedata`, `error`, el plazo de 4 s del callejero principal y, si vence o falla, un `setStyle` al de reserva, una sola vez; el plazo se cancela al llegar la primera tesela o con `remove`) y `PantallaMapa.crear` (`zoom`, `moveend`, `load`).
- Una vez por Worker: `capa/navegador.ts`, el Worker que lee e indexa las capas de provincia; se crea con la primera provincia y dura la visita, y una lectura interrumpida no lo termina: su respuesta se descarta.
- Los servicios de Effect (`geolocalizacion.ts`, `brujula.ts`, `almacen.ts`, las lecturas de red de `capa/`, `ficha/` y `buscador.ts`) abren con `acquireRelease` y cierran al interrumpirse. Los abre el sitio de Solid de la primera tabla.
- Escuchadores en el propio nodo desde un `ref` (`Dialogo`, `MenuDeControles`, `MenuUbicacion`, `PanelEmplazamiento`, `MarcadorReferencia`): uno por nodo, y mueren con él.
- Manejadores de eventos (usar la ubicación, elegir, quitar, pedir permiso a la brújula): los abre la persona. Buscar una dirección solo escribe la búsqueda pedida, y la abre `recurso("buscador:busqueda")`.

Resumen: 51 sitios abren algo desde Solid, uno por fila de la primera tabla. La auditoría encontró 29. Después llegaron los dos del #45, los dos de la foto aérea del #64, la lectura de los rótulos de ciudad del #66, los vuelos de la cámara del #67, los tres del filtro de compañías del #69 y los colores del mapa con el tema del #75, y el 20/10/2026 (#81) salieron con la simulación las celdas, la vista de interferencia, el sector que da servicio y las provincias vecinas que pedían. El 25/10/2026 entraron en la tabla doce sitios que ya abrían algo y no estaban en ella: los cinco de la cabecera y la vista inicial del #52, los dos del buzón del #56, la pista «Acércate» de la foto aérea y los cuatro de la vista de puntos del #74. El resto de efectos y memos, en la segunda tabla, no abren nada.

Cuatro tenían el fallo: el GPS y la brújula (ya arreglados en d34ea08 y 1351233) y la vista de interferencia y el sector que da servicio, que recalculaban con cada lectura del GPS en el mismo sitio. La precarga de fichas era un riesgo sin fallo visible. Todos abren ahora con `recurso()` o `recursoFijo()`. El 25/10/2026 se quitaron dos riesgos sin fallo visible: las agrupaciones del filtro y las provincias de la vista inicial se volvían a abrir por cambios que no les tocaban, y las frenaba que lo ya pedido no se repite.
