# Efectos que abren recursos

Léelo antes de escribir un `createEffect` o un `onSettled`, o de tocar algo que abra el GPS, la brújula, escuchadores, temporizadores, fotogramas, peticiones o el Worker.

## El fallo que lo motivó

En septiembre de 2026 el GPS se abrió 3135 veces en 7 s en Chromium (commits 480e670 y 119001f). El efecto que lo abría leía todo el estado de la ubicación en su primera función. Cada lectura del GPS escribía ese estado, el efecto volvía a correr aunque el `true` fuera el mismo, cerraba el GPS (`clearWatch`) y lo reabría, y el navegador entregaba al momento la posición en caché. Vuelta a empezar. La brújula tenía el mismo fallo. Las pruebas no lo vieron por dos motivos: el GPS de prueba no emitía al abrirse y nadie contaba aperturas.

## Qué hace Solid 2

Comprobado con `solid-js` 2.0.0-rc.9 en `packages/ui/src/recurso.test.ts`, bloque «Solid 2: igualdad de efectos y memos». Si una subida de versión lo cambia, esas pruebas fallan.

- La segunda función de `createEffect` corre otra vez, y antes llama a la limpieza que devolvió, cada vez que cambia algo que lee la primera. No compara lo que devuelve la primera: ni un primitivo igual (`true` y `true`) ni el mismo objeto. En el código de Solid, el nodo de un efecto nace con `_equals: false`.
- `createMemo` compara con `===` por defecto. Un primitivo igual no avisa a quien lo lee; un objeto nuevo con los mismos campos, sí. Con `{ equals }` compara con esa función.
- Una señal a la que se escribe el mismo valor no avisa.
- `onSettled` corre una vez, no sigue lo que lee y llama a su limpieza al desmontar.
- `onCleanup` dentro de la segunda función de un efecto no se llama nunca: la limpieza hay que devolverla. En el cuerpo del dueño sí se llama al desmontar.

Así que un efecto solo se frena con un memo delante que compare. `recurso()` lo lleva dentro.

## recurso()

`packages/ui/src/recurso.ts`, en `@celda/ui` porque lo usan la librería y la web.

```ts
recurso(nombre, clave, abrir, { iguales, maximoPorSegundo });
recursoFijo(nombre, abrir); // abre al montar, cierra al desmontar
```

- `clave` es una lectura reactiva. `false`, `null` o `undefined` dejan el recurso cerrado.
- La clave pasa por un memo con `iguales` (por defecto `Object.is`). Mientras no cambie, no se cierra ni se abre nada.
- Una clave que es un objeto nuevo en cada cálculo necesita comparador: `mismosCampos` compara campo a campo, `mismasListas` elemento a elemento, `mismaCoordenada` (`@celda/dominio/area`) por coordenadas.
- `abrir(clave)` corre sin seguimiento y devuelve el cierre. El cierre recibe la clave con la que se va a reabrir, o `undefined` si se cierra del todo. El sector que da servicio lo usa para no interrumpir el cálculo en curso cuando lo siguiente es del mismo emplazamiento.
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

En desarrollo y en las pruebas (`import.meta.env.DEV`), `recurso()` cuenta las aperturas de cada nombre. Si pasan de `maximoPorSegundo` en un segundo (10 por defecto), avisa en la consola con `[Celda]` y apunta el exceso. `packages/ui/src/pruebas/vigilante.ts` se carga en todas las pruebas de `apps/web` y `packages/ui` y hace fallar la prueba con excesos, aunque lo que comprueba salga bien.

Los cálculos que siguen un gesto (arrastrar el punto, mover el deslizador de la vista de interferencia) abren uno por evento y llevan `SIGUE_UN_GESTO`, 120 por segundo, un evento por fotograma a 120 Hz. Un bucle como el del GPS iba a 450 por segundo.

El mismo fichero desmonta después de cada prueba lo que montó. `@solidjs/testing-library` solo lo hace con los globales de Vitest, que no están activados, y las apps de las pruebas anteriores seguían montadas, con el GPS y los escuchadores abiertos, reaccionando a la dirección de la siguiente prueba. El vigilante lo destapó al contar once paneles abiertos en un segundo.

## La regla celda/abrir-con-recurso

`tools/oxlint-plugin-celda/reglas/abrir-con-recurso.ts`. Marca como error, dentro de la segunda función de `createEffect` o `createRenderEffect` (también en la forma `{ effect, error }`) o dentro de `onSettled`, incluidas las funciones anidadas:

- `watchPosition`, `getCurrentPosition`, `addEventListener`, `on`, `once`, `postMessage`, `observe`;
- `fetch`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback`, solas o desde `window`, `globalThis` o `self`;
- `indexedDB.open`;
- `new Worker`, `SharedWorker`, `WebSocket`, `EventSource`, `BroadcastChannel` y los observadores;
- `runPromise`, `runPromiseExit`, `runFork`, `runCallback` de un runtime de Effect.

Solo ve lo escrito en esa función. Lo que se abra a través de otra función llamada desde ahí (`calcular()`, `props.alVer()`) no lo ve; para eso están el vigilante y la prueba de resistencia. Contra `celda/v1` marca el GPS, la brújula, el permiso, el clic del mapa, los fotogramas de los marcadores, los cálculos de celdas y los escuchadores de las explicaciones.

## Dobles de prueba

Imitan lo que hace el navegador con el recurso, no lo que conviene a la prueba:

- El GPS (`ubicacion/pruebas.ts`) entrega al abrirse la última posición que tenga, como `watchPosition` con `maximumAge`; la primera, `enCache`. Su permiso llega un momento después de montar y no se acaba. `permisoLeido()` dice si la app ya lo tiene.
- La brújula (`mejorar/pruebas.ts`) da lo último leído al empezar a escuchar, como `deviceorientation` al añadir el escuchador; la primera vez, `rumbo`. `pedirPermiso` contesta en otra tarea.
- El Worker (`packages/sim/src/pruebas.ts`) recibe una copia de cada solicitud y contesta en otra tarea; si se termina antes, la respuesta no llega. `simuladorDePrueba` es el simulador de la web sobre un Worker de prueba que contesta solo. Las pruebas de pantalla usan ese y no `simuladorEnHilo`, que contesta en el acto.
- El almacén y el buscador contestan en otra tarea, como IndexedDB y la red.

Con el GPS y la brújula nuevos, las pruebas «con una posición ya guardada en el navegador…» (`Ubicacion.test.tsx`) y «con el móvil ya apuntando…» (`MejorarSenal.test.tsx`) fallan con el código de antes de 480e670 y 119001f.

## Prueba de resistencia

`tools/rendimiento/src/resistencia.ts`. Abre la web construida en Chromium sin interfaz, con WebGL por SwiftShader, como un Android de pantalla ancha con el permiso de ubicación y los sensores concedidos. Sirve una capa sintética de 25 emplazamientos (`capaSintetica.ts`) y contesta en local las peticiones a OpenFreeMap con teselas vacías: no necesita GPU ni conexión. Abre un emplazamiento, enciende el GPS y la brújula, filtra por Digi (las celdas cuentan también las de Movistar, la red que usa, ADR 0026), abre la vista de interferencia (las celdas ya están calculadas a zoom 16), espera a que la página quede quieta y la deja así 30 s. Quieta es 2 s sin que crezca nada salvo `setTimeout` y sin fotogramas pendientes; si en 30 s no lo consigue, falla. Mientras, el GPS da una lectura por segundo en el mismo sitio con otra precisión y la brújula diez por segundo. Un guion inyectado (`contador.ts`) cuenta las llamadas; la prueba falla si en esos 30 s crecen más de:

| API | Tope | Por qué |
|---|---|---|
| `watchPosition`, `clearWatch`, `getCurrentPosition` | 0 | El GPS se abre una vez, al pulsar. |
| `addEventListener`, `removeEventListener` | 0 | Sin tocar la pantalla no hay nada nuevo que escuchar. |
| `fetch`, `new Worker`, `postMessage`, `setInterval` | 0 | Con el punto quieto no se pide ni se recalcula nada. |
| `requestAnimationFrame` | 0 | No hay nada animándose. |
| `setTimeout` | 2 por lectura (660) | Effect agenda con `setTimeout` el trabajo de cada lectura que llega por una cola. |

También falla si al preparar `watchPosition` se llamó más de una vez. Hasta el 04/10/2026 esperaba 3 s fijos antes de empezar a contar, y en una CI lenta el último fotograma de MapLibre llegaba ya dentro de la ventana: un `removeEventListener` sin `addEventListener`, el de la cancelación del fotograma, sin nada abierto. Con la espera recortada a 0,9 s fallaba igual 6f00c28, de antes de las celdas con la red usada. El 28/09/2026 creció 0 en todo salvo `setTimeout`, que subió 332 con 330 lecturas. Con el GPS de antes de 480e670 salieron 3825 `watchPosition` en 7 s; con la vista de interferencia de antes de este arreglo, 140 `postMessage` y 52 fotogramas en 10 s.

Para correrla, desde la raíz de Celda:

```sh
nix develop .#resistencia     # trae Chromium en CELDA_CHROMIUM
pnpm run build
pnpm run resistencia          # --segundos 10 para una pasada corta
```

Fuera de ese entorno usa `/usr/bin/chromium`. En la CI va en su propio trabajo, `resistencia`, de `.github/workflows/celda.yml`.

## Auditoría

Septiembre de 2026, sobre `celda/v1` después de 480e670 y 119001f. Todos los `createEffect`, `onSettled` y memos que abren algo, y todo lo que abre un recurso en `apps/web/src` y `packages/ui/src`. «Antes» dice qué hacía el sitio en `celda/v1`; la columna «Ahora», con qué se abre en esta rama.

Veredictos: **seguro**, no podía reabrirse solo ni por cambios ajenos; **arreglado**, lo hacía y ya no; **riesgo**, no lo hacía, pero volvía a correr por cambios que no le tocan y dependía de que otra pieza lo frenara.

### Lo que se abre desde Solid

| Sitio | Abre | Clave (depende de) | Antes | Veredicto | Ahora |
|---|---|---|---|---|---|
| `ubicacion/controlador.ts`, GPS | `watchPosition` por el servicio | `gpsEncendido(estado)` | Reabría con cada lectura hasta 480e670; después, un memo lo frenaba | arreglado (480e670) | `recurso("gps")` |
| `ubicacion/controlador.ts`, permiso | `permissions.query` y su `change` | fija | `onSettled`, una vez | seguro | `recursoFijo` |
| `ubicacion/controlador.ts`, punto guardado | lectura de IndexedDB | fija | `onSettled`, una vez | seguro | `recursoFijo` |
| `mejorar/MejorarSenal.tsx`, brújula | `deviceorientationabsolute` y una espera de 3 s | `escuchando(estado)` | Reabría con cada lectura hasta 119001f | arreglado (119001f) | `recurso("brujula")` |
| `mejorar/MejorarSenal.tsx`, disponibilidad | lectura del servicio | fija | `onSettled`, sin cancelar al desmontar | seguro | `recursoFijo`, descarta la respuesta tras desmontar |
| `ajustes/ajustes.ts` | lectura de IndexedDB | fija | `onSettled` | seguro | `recursoFijo` |
| `datos.tsx`, runtime | los servicios (Worker, GPS…) hasta desmontar | fija | `onSettled` que solo cierra | seguro | `recursoFijo` |
| `mapa/PantallaMapa.tsx`, mapa | MapLibre, WebGL, sus workers y escuchadores | fija | `onSettled` | seguro | `recursoFijo("mapa")` |
| `mapa/PantallaMapa.tsx`, capa | `fetch` de `vigente.json` y del resumen; con él, las capas de las provincias de la vista inicial y de la ficha de la dirección | fija | `onSettled` | seguro | `recursoFijo("capa")`, que al cerrar cancela también las provincias que se estén pidiendo |
| `mapa/PantallaMapa.tsx`, provincias | `fetch` de la capa de una provincia y su índice en el Worker de capas | la vista que decide `Marcadores` (`alCambiarVista`) o el botón de reintentar | — | seguro | se abre desde esos manejadores, una vez por provincia y visita; una que falla no se vuelve a pedir sola al mover el mapa |
| `mapa/PantallaMapa.tsx`, provincias vecinas | las mismas lecturas de provincia, desde `pedirProvincias` | las provincias que necesitan las celdas y la vista de interferencia (#45), por `mismasListas` | — | seguro | `recurso("capa:vecinas")`; cerrarlo no cancela nada, las lecturas son de la visita y las cierra `recursoFijo("capa")` |
| `mapa/PantallaMapa.tsx`, enlace sin provincia | lectura de una parte del índice de claves | la clave del enlace, mientras no dice su provincia y hay resumen | — | seguro | `recurso("capa:clave")`, que cancela la lectura si cambia el enlace |
| `mapa/PantallaMapa.tsx`, ancho de pantalla | `matchMedia` y su `change` | fija | `onSettled` | seguro | `recursoFijo` |
| `mapa/PantallaMapa.tsx`, clic en el mapa | `map.on("click")` | el mapa listo | `createEffect(mapaListo)`, cambia al crear el mapa | seguro | `recurso("mapa:clic")` |
| `mapa/PantallaMapa.tsx`, modelo del móvil | `getHighEntropyValues` | fija | `onSettled` | seguro | `recursoFijo` |
| `celdas/enMapa.ts`, celdas | cálculo en el Worker | lienzo, emplazamientos de las provincias del cálculo, provincias de fuera, caja, capa pedida, reintento | `createEffect`; con la capa sin llegar, `[]` nuevo en cada cambio de estado, sin abrir nada | seguro | `recurso`, `mismosCampos` |
| `interferencia/enMapa.ts`, vista | cálculo en el Worker tras 120 ms | lienzo, capa, elección, encuadre, referencia, provincias vecinas (por `mismasVecinas`), reintento | **Fallo.** Cada lectura del GPS traía una posición nueva: cancelaba el cálculo, lo que termina el Worker, y pedía otro. Con una lectura por segundo y un cálculo más largo, no acababa nunca | arreglado (esta rama) | `recurso`, referencia por `mismaCoordenada` |
| `servicio/enMapa.ts`, sector que da servicio | cálculo en el Worker | el pedido (emplazamiento, punto, celda) | **Fallo.** Cada lectura del GPS encolaba otro cálculo igual | arreglado (esta rama) | `recurso`, punto por `mismaCoordenada`, el cierre no interrumpe si sigue el mismo emplazamiento |
| `mapa/Marcadores.tsx`, vista del mapa | `map.on("move"/"moveend")` y un fotograma por movimiento | el mapa | `onSettled` con `untrack` | seguro | `recurso("marcadores:vista")` |
| `mapa/Marcadores.tsx`, rótulos de ciudad | `map.on("idle")`, que lee los rótulos colocados con `queryRenderedFeatures` | el mapa, con el lector del código del mapa | nuevo (#66) | seguro | `recurso("marcadores:rotulos")`; la lectura se compara por claves y zoom, así que un `idle` sin cambios no decide nada |
| `mapa/Marcadores.tsx`, movimiento reducido | `matchMedia` | fija | `onSettled` | seguro | `recursoFijo` |
| `mapa/Marcadores.tsx`, precarga de fichas | `fetch` de lotes por `alVer` | las claves sueltas que se ven | Volvía a pedir con cada escena, también al seleccionar un marcador; la caché del servicio evitaba la red salvo tras un fallo | riesgo → seguro | `recurso`, `mismasListas`; desde el #69 solo pide si ha cambiado la vista o han llegado provincias: cambiar el filtro de compañías no descarga nada |
| `filtro/enMapa.ts`, aplicar el filtro de compañías | un `setTimeout` de `ESPERA_DEL_FILTRO_MS` (150 ms) | el filtro guardado, por `mismoFiltro` | nuevo (#69) | seguro | `recurso("filtro:aplicar")`; cada toque cierra la espera anterior, así que varios seguidos aplican el último una vez. Lo guardado al abrir vale al momento, sin temporizador |
| `filtro/enMapa.ts`, agrupaciones del filtro | `agrupacion` del servicio de capa: un mensaje al Worker de capas por provincia y filtro nuevo | el filtro aplicado y las provincias que han llegado, en texto, por `mismosCampos` | nuevo (#69) | seguro | `recurso("capa:filtro")`; solo pide las provincias sin la agrupación del filtro. Cerrarlo no corta lo ya mandado, que el servicio termina y guarda (`Effect.uninterruptible` tras su turno), así que llegar otra provincia no lo repite |
| `ui/filtro/FiltroDeCompanias.tsx` | `pointerdown` del documento | fija | nuevo (#69) | seguro | `recursoFijo("menu-de-companias:fuera")` |
| `mapa/CapaAgrupada.tsx`, latido | `requestAnimationFrame` hasta que acaba la transición | si queda algo yéndose | Se pedía desde la segunda función del efecto; el bucle se paraba solo | seguro | `recurso("marcadores:latido")` |
| `ubicacion/ReferenciaEnMapa.tsx` | `map.on("move")` y un fotograma por movimiento | el mapa | `onSettled` | seguro | `recurso` |
| `ejercicio/PanelEjercicio.tsx`, zonas | lectura del índice de zonas y de los habitantes por barrio | fija | `onSettled` | seguro | `recursoFijo("ejercicio:zonas")` |
| `ejercicio/PanelEjercicio.tsx`, provincias | pide la capa de la provincia de la zona y la de las vecinas del borde a la pantalla del mapa, que no repite las ya pedidas | la provincia, un texto; las que faltan, unidas en un texto | nuevo | seguro | `recurso("ejercicio:provincia")`, `recurso("ejercicio:vecinas")` |
| `ejercicio/PanelEjercicio.tsx`, contornos | lectura del contorno de la provincia | la provincia de un municipio con capa | nuevo | seguro | `recurso("ejercicio:contornos")`; cada provincia se lee una vez |
| `ubicacion/Ubicacion.tsx`, atribución del buscador | lectura del servicio | fija | `onSettled` | seguro | `recursoFijo` |
| `ubicacion/Ubicacion.tsx`, búsqueda de direcciones | petición al buscador | cada envío del formulario | desde el manejador; una respuesta vieja se descartaba con un contador y la petición seguía al cerrar la elección | seguro | `recurso("buscador:busqueda")`, la cierra la búsqueda siguiente o cerrar la elección |
| `ui/controles/MenuDeControles.tsx` | `pointerdown` del documento | fija | `onSettled` | seguro | `recursoFijo` |
| `ui/ubicacion/MenuUbicacion.tsx` | `pointerdown` del documento | fija | `onSettled` | seguro | `recursoFijo` |
| `ui/termino/Termino.tsx` | `pointerdown`, `keydown`, `resize`, `scroll` y fotogramas | fija | `onSettled` | seguro | `recursoFijo` |
| `ui/panel/PanelEmplazamiento.tsx` | `resize` de la ventana | fija | `onSettled` | seguro | `recursoFijo` |
| `ui/DisposicionMapa.tsx` | `setTimeout` que pliega los créditos | fija | `onSettled` | seguro | `recursoFijo` |
| `foto/enMapa.ts`, foto aérea | el estado `fotoAerea` del estilo, la visibilidad de la capa de la foto y, con ella, las teselas del PNOA | el lienzo y si se ve: encendida, con la cámara sin volar y sin un «Ver el edificio» por despegar, por `mismosCampos` | nuevo (#64); desde el #67 se quita durante los vuelos | seguro | `recurso("mapa:foto")`; no cierra nada: apagar es otra clave. Encenderla y apagarla a mitad de vuelo no toca el mapa hasta que llega |
| `foto/enMapa.ts`, vuelos de la cámara | `map.on("movestart"/"moveend")` | el lienzo | nuevo (#67) | seguro | `recurso("mapa:vuelos")`; el aviso escribe el lienzo que vuela, que no cambia mientras dura el vuelo. Un vuelo cambia la clave de la foto dos veces, al despegar y al llegar; un gesto, un salto o un vuelo que interrumpe otro en la misma tarea, ninguna |
| `foto/enMapa.ts`, «Ver el edificio» | `flyTo`, `moveend` y un `idle`, y el edificio resaltado | el lienzo y el pedido de la pulsación, un objeto nuevo por pulsación; otro emplazamiento lo borra | nuevo (#64) | seguro | `recurso("mapa:edificio")`; el cierre quita los escuchadores y, si no hay otro pedido, el resaltado |
| `ui/Dialogo.tsx` | `showModal` y el foco | fija | `onSettled` | seguro | `recursoFijo` |

### Efectos y memos que no abren nada

| Sitio | Hace | Depende de | Veredicto |
|---|---|---|---|
| `App.tsx` | `document.title` | la ruta | seguro |
| `ficha/PanelFicha.tsx` | vuelve al resumen | la clave (`defer`) | seguro |
| `ficha/PanelFicha.tsx`, memo `ficha` | lee el lote (red) con `leerEnSolid` | solo la clave, un texto | seguro |
| `ficha/ComoEmite.tsx`, memo `diagrama` | cálculo en el Worker con `leerEnSolid` | solo la clave | seguro |
| `ejercicio/PanelEjercicio.tsx` | olvida las bandas leídas | la zona (`defer`) | seguro |
| `ejercicio/PanelEjercicio.tsx` | manda la zona al mapa | la zona resuelta y el dibujo, calculado en la primera función | seguro |
| `mapa/PantallaMapa.tsx` | lleva el mapa a la primera lectura (`easeTo`) | todo el estado de la ubicación; solo actúa al pasar de «pidiendo» a GPS | seguro |
| `mapa/PantallaMapa.tsx` | `setData` de la zona y `fitBounds` | mapa y zona; el encuadre solo al cambiar de zona | seguro |
| `mapa/PantallaMapa.tsx` | salta al emplazamiento de la dirección | una vez | seguro |
| `celdas/enMapa.ts` | pide las celdas; remarca la seleccionada | cerca y capa; lienzo y selección | seguro |
| `mapa/PantallaMapa.tsx` | apunta las provincias que piden las celdas dudosas que se ven (#45) | celdas calculadas, zona y provincias cercanas; solo escribe si hay alguna nueva | seguro |
| `interferencia/enMapa.ts` | enseña u oculta la trama | lienzo y si está activa | seguro |
| `servicio/enMapa.ts` | `setData` del degradado y de la línea; borra sin pedido | lo calculado; el punto, ya por coordenadas | seguro |
| `mapa/CapaAgrupada.tsx` | calcula lo pintado y enciende el latido | la escena | seguro |
| `mapa/Marcadores.tsx` | `setData` de los huecos de los marcadores (#66) | los huecos de la escena y cada `idle`; con el mapa moviéndose no hace nada, y si son los mismos no toca el mapa | seguro |
| `mapa/Marcadores.tsx` | `setFilter` de los rótulos de municipio del mapa base | los nombres de los municipios de la escena, con `mismasListas` | seguro |
| `ui/Eleccion.tsx`, `ui/Termino.tsx`, `ui/Dialogo.tsx` | escriben el campo, colocan, enfocan | un valor o un título | seguro |

### Lo que se abre fuera de los efectos

Se abre una vez por lo que lo crea, no por una reejecución:

- Al cargar el módulo: `lib/rutas.ts` (`popstate`) y `mapa/precarga.ts` (MapLibre, `prefetch` y `preload`).
- Una vez por mapa: `mapa/mapaBase.ts` (`sourcedata`, `error`, el plazo de 4 s del callejero principal y, si vence o falla, un `setStyle` al de reserva, una sola vez; el plazo se cancela al llegar la primera tesela o con `remove`) y `PantallaMapa.crear` (`zoom`, `moveend`, `load`).
- Una vez por Worker: `capa/navegador.ts`, el Worker que lee e indexa las capas de provincia; se crea con la primera provincia y dura la visita, y una lectura interrumpida no lo termina: su respuesta se descarta.
- Una vez por Worker: `simulacion/navegador.ts` (`new Worker` y sus escuchadores). El simulador arranca uno con la primera simulación y lo termina si se interrumpe un cálculo a medias. Por eso los cálculos que se cancelan de más cuestan tanto.
- Los servicios de Effect (`geolocalizacion.ts`, `brujula.ts`, `almacen.ts`, las lecturas de red de `capa/`, `ficha/` y `buscador.ts`) abren con `acquireRelease` y cierran al interrumpirse. Los abre el sitio de Solid de la primera tabla.
- Escuchadores en el propio nodo desde un `ref` (`Dialogo`, `MenuDeControles`, `MenuUbicacion`, `PanelEmplazamiento`, `MarcadorReferencia`): uno por nodo, y mueren con él.
- Manejadores de eventos (usar la ubicación, elegir, quitar, pedir permiso a la brújula): los abre la persona. Buscar una dirección solo escribe la búsqueda pedida, y la abre `recurso("buscador:busqueda")`.

Resumen: 38 sitios abren algo desde Solid (29 en la auditoría, los dos del #45, los dos de la foto aérea del #64, la lectura de los rótulos de ciudad del #66, los vuelos de la cámara del #67 y los tres del filtro de compañías del #69); el resto de efectos y memos, en la segunda tabla, no abren nada. Cuatro tenían el fallo: el GPS y la brújula (ya arreglados en 480e670 y 119001f) y la vista de interferencia y el sector que da servicio, que recalculaban con cada lectura del GPS en el mismo sitio. La precarga de fichas era un riesgo sin fallo visible. Todos abren ahora con `recurso()` o `recursoFijo()`.
