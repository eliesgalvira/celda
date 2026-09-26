# Ubicación y punto de referencia

Cómo sabe Celda desde dónde mirar un emplazamiento. El punto de referencia es la ubicación GPS del dispositivo o un punto elegido a mano (glosario en [CONTEXT.md](../../CONTEXT.md)). Todo lo de la web está en `apps/web/src/ubicacion/` y lo que se ve, en `packages/ui/src/ubicacion/`.

## Estado de la ubicación

`estado.ts` es una función pura, `transicion(ubicacion, evento)`, sin E/S. La interfaz solo le manda eventos y enseña lo que devuelve.

- Estados asentados: `ninguna`, `denegada`, `gps` (con posición, precisión y fecha), `elegida` (con el `PuntoElegido`) y `fallo` (`sin-senal`, `tiempo-agotado` o `no-disponible`).
- Estados de paso: `explicando` (el paso previo), `pidiendo` (esperando al navegador o a la primera lectura) y `eligiendo`. Guardan el asentado del que vienen. Cancelar vuelve a él, y mientras tanto su punto sigue siendo la referencia (`referenciaDe`).
- `permiso` va aparte (`concedido`, `preguntar`, `denegado`, `desconocido`), porque un punto elegido no depende de él y el menú tiene que saber si la ubicación está bloqueada aunque haya un punto.
- `aviso` dice por qué acaba de fallar una petición, aunque el estado vuelva a un punto que ya había. Lo borra lo siguiente que haga la persona.

Reglas que comprueban las pruebas sobre todos los estados alcanzables y todos los eventos (`estado.test.ts`):

- El GPS solo se enciende tras el paso previo, o sin él si el permiso ya estaba concedido, porque entonces el navegador no pregunta nada.
- Una lectura del GPS solo cuenta si se estaba esperando. Si llega después de quitar o cancelar, se descarta.
- Con el permiso bloqueado no hay ubicación GPS, ni se pide ni se explica.
- Quitar deja siempre sin punto y con el GPS apagado.
- Si se deniega el permiso teniendo un punto elegido, el punto se queda y el aviso dice qué ha pasado.

`gpsEncendido(estado)` dice cuándo tiene que estar abierto el GPS: mientras se pide y mientras la ubicación GPS sea la referencia. `controlador.ts` abre la lectura con esa señal y la cierra al cambiar, así que quitar la ubicación o elegir un punto apaga el GPS.

## Servicios

Tres servicios Effect, en `ServiciosDeDatos` (`datos.tsx`), con su capa real en `entrada.tsx` y la de prueba en `pruebas.ts`:

- `Geolocalizacion` (`geolocalizacion.ts`). `permiso` es un flujo con el estado del permiso ahora y cada vez que cambia (API Permissions); leerlo no hace preguntar nada. `seguir` pide la ubicación con `watchPosition` y da cada lectura. Falla si la primera no llega en 20 s o si se bloquea el permiso; los fallos pasajeros posteriores no cortan el flujo. Sin API de geolocalización o sin https falla con `no-disponible`. La posición no sale de este servicio: no se guarda ni se envía.
- `AlmacenLocal` (`almacen.ts`). Las aportaciones en IndexedDB, en la base `celda`, almacén `aportaciones`, con índice por `tipo`. `leer(tipo)`, `sustituir(aportacion)` (borra las de su tipo y guarda la nueva en una sola transacción) y `borrar(tipo)`. Las filas con un formato que no conoce (otra versión del esquema) se dejan estar y se avisa en el registro. La capa real recibe la `IDBFactory`: las pruebas le pasan la de `fake-indexeddb`, una IndexedDB en memoria, y así prueban el código real y no un sustituto.
- `BuscadorDeDirecciones` (`buscador.ts`), sobre Nominatim. Ver abajo.

`nuevaAportacion(contenido)` pone el identificador (UUID v4 con el servicio `Crypto` de Effect) y la fecha (`Clock`). En el navegador `Crypto` sale de Web Crypto (`lib/cripto.ts`); en las pruebas, `criptoDePrueba` da UUID previsibles.

## Formato del punto elegido

`packages/dominio/src/aportacion.ts`, con el formato definitivo del ADR 0007:

```ts
{
  id: "5b0d3c1e-8f4a-4c2b-9d6e-1a2b3c4d5e6f", // UUID v4 del dispositivo; al compartir, la clave idempotente
  tipo: "punto-elegido",
  esquema: 1,                                 // versión del esquema de este tipo
  creada: 1790413200000,                      // milisegundos
  origen: "mapa",                             // "mapa" (clic, arrastre o pin) o "busqueda"
  posicion: { longitud: 2.1128, latitud: 41.3903 },
}
```

Se guarda un punto elegido como mucho. Elegir otro, o soltar el punto tras arrastrarlo, crea una aportación nueva que sustituye a la anterior. Mientras se arrastra, el punto solo cambia en memoria. Quitarlo lo borra del dispositivo. La ubicación GPS no se guarda nunca.

Si IndexedDB falla (algunas ventanas privadas), el punto se usa igual y un aviso dice que no se ha guardado. Si falla al borrar, el aviso lo dice y ofrece quitarlo otra vez.

## Búsqueda de direcciones

La decisión y sus motivos están en el [ADR 0013](../adr/0013-busqueda-de-direcciones-con-nominatim.md). Condiciones de uso de Nominatim y cómo las cumple Celda:

| Condición | Cómo |
|---|---|
| Una petición por segundo como mucho | Un semáforo y la hora de la última petición en el servicio. Prueba con `TestClock`. |
| Nada de autocompletar | Solo se busca al enviar el formulario. Consultas de menos de tres letras no salen. |
| Caché | `Cache.makeWith` en memoria: 12 h las respuestas buenas, nada los fallos. Misma consulta sin distinguir mayúsculas ni espacios. |
| Identificarse | El `Referer` que pone el navegador con el origen de Celda. Sin cabeceras propias ni de trazas, para no provocar una petición previa de CORS. |
| Atribución | «Búsqueda: Nominatim · datos de OpenStreetMap (ODbL)», con enlace, bajo el buscador. |
| Poder cambiar de servicio | `VITE_BUSCADOR_URL`. `apagado` lo apaga y la interfaz lo dice. |

La consulta va limitada a los límites del mapa (`viewbox` y `bounded=1`), con `countrycodes=es` y `accept-language=es`. Las direcciones fuera de la zona o repetidas se descartan. Las pruebas usan respuestas grabadas en `referencia/`. Si pruebas contra el servidor real, haz pocas búsquedas y a mano.

## Interfaz

- En el panel (`ReferenciaEnFicha`): sin punto, «¿Desde dónde lo miramos?» con lo que se gana y dos botones. Con el permiso bloqueado explica cómo reactivarlo y solo ofrece elegir en el mapa. Con punto, «Desde: tu ubicación (±25 m)» o «Desde: el punto elegido», «Cambiar» y «Quitar», y la distancia y el rumbo al emplazamiento. Con un punto elegido los textos hablan de «el punto», nunca de «ti» (`textos.ts`, con pruebas).
- El paso previo es un `Dialogo` que se abre con «Usar mi ubicación». Solo «Continuar» pide el permiso; «Mejor elijo en el mapa», «Cerrar» o Escape no piden nada.
- El botón «Ubicación» de los controles abre el menú: usar mi ubicación, elegir un punto, centrar y quitar. Lo que no se puede hacer queda a la vista, desactivado y con el motivo.
- Elegir un punto: en escritorio, un clic en el mapa o buscar; el punto se arrastra con el ratón y se mueve con las flechas. En el móvil, un pin fijo en el centro, mover el mapa y «Usar este punto», o buscar. La hoja de la ficha se aparta mientras tanto.
- En el mapa, la ubicación GPS es el hexágono «TÚ» con su círculo de precisión, y el punto elegido, el hexágono naranja con «PUNTO».
- Los avisos bajo la cabecera (fallo, esperando, no guardado) no repiten lo que ya dice la ficha abierta.

La distancia es la de `distanciaMetros` y el rumbo, `rumboGrados` (`packages/dominio/src/area.ts`). El sector que da servicio y el degradado son del ticket siguiente.

## Pruebas de componente

`Ubicacion.test.tsx` monta la app con `ubicacionDePrueba()`: un GPS que no contesta hasta que la prueba llama a `responder` o `fallar`, un almacén en memoria y un buscador con respuestas fijas. Cuenta cuántas veces se pidió la ubicación, así que se puede comprobar que el paso previo va antes de pedirla. Para probar en Chromium, el contexto de Playwright concede el permiso con `permissions: ["geolocation"]` y `geolocation`; sin concederlo, Chromium sin interfaz lo deniega.
