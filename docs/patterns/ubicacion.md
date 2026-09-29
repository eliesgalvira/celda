# Ubicación y punto de referencia

Cómo sabe Celda desde dónde mirar un emplazamiento. El punto de referencia es la ubicación GPS del dispositivo o un punto elegido a mano (glosario en [CONTEXT.md](../../CONTEXT.md)). Todo lo de la web está en `apps/web/src/ubicacion/` y lo que se ve, en `packages/ui/src/ubicacion/`.

## Estado de la ubicación

`estado.ts` es una función pura, `transicion(ubicacion, evento)`, sin E/S. La interfaz solo le manda eventos y enseña lo que devuelve.

- Estados asentados: `ninguna`, `denegada`, `gps` (con posición, precisión y fecha), `elegida` (con el `PuntoElegido`) y `fallo` (`sin-senal`, `sin-fuente`, `tiempo-agotado` o `no-disponible`).
- Estados de paso: `explicando` (el paso previo), `pidiendo` (esperando al navegador o a la primera lectura) y `eligiendo`. Guardan el asentado del que vienen. Cancelar vuelve a él, y mientras tanto su punto sigue siendo la referencia (`referenciaDe`). Desde `pidiendo` también se puede ir a elegir en el mapa, que deja de buscar la ubicación.
- `permiso` va aparte (`concedido`, `preguntar`, `denegado`, `desconocido`), porque un punto elegido no depende de él y el menú tiene que saber si la ubicación está bloqueada aunque haya un punto.
- `aviso` dice por qué acaba de fallar una petición, aunque el estado vuelva a un punto que ya había. Lo borra lo siguiente que haga la persona.

Reglas que comprueban las pruebas sobre todos los estados alcanzables y todos los eventos (`estado.test.ts`):

- El GPS solo se enciende tras el paso previo, o sin él si el permiso ya estaba concedido, porque entonces el navegador no pregunta nada.
- Una lectura del GPS solo cuenta si se estaba esperando. Si llega después de quitar o cancelar, se descarta.
- Con el permiso bloqueado no hay ubicación GPS, ni se pide ni se explica.
- Quitar deja siempre sin punto y con el GPS apagado.
- Si se deniega el permiso teniendo un punto elegido, el punto se queda y el aviso dice qué ha pasado.
- Quitar nunca impide volver a encender el GPS, salvo con el permiso bloqueado, y de `pidiendo` siempre se sale con cancelar, elegir en el mapa, quitar, una lectura o un fallo.

`gpsEncendido(estado)` dice cuándo tiene que estar abierto el GPS: mientras se pide y mientras la ubicación GPS sea la referencia. `controlador.ts` abre la lectura con `recurso("gps")` y esa señal como clave, y la cierra al cambiar, así que quitar la ubicación o elegir un punto apaga el GPS. Cada lectura cambia el estado, pero la clave sigue siendo `true` y el GPS no se reabre (ver [efectos.md](efectos.md)).

## Servicios

Tres servicios Effect, en `ServiciosDeDatos` (`datos.tsx`), con su capa real en `entrada.tsx` y la de prueba en `pruebas.ts`:

- `Geolocalizacion` (`geolocalizacion.ts`). `permiso` es un flujo con el estado del permiso ahora y cada vez que cambia (API Permissions); leerlo no hace preguntar nada. `seguir` pide la ubicación con `watchPosition` y da cada lectura. Falla si se bloquea el permiso o si la primera lectura no llega en 20 s desde que hay permiso (60 s como mucho desde que se pide, por si el navegador no avisa del permiso); los fallos pasajeros posteriores no cortan el flujo. La espera es propia, con el reloj de Effect: la opción `timeout` de `watchPosition` no basta, porque hay navegadores que no llaman a nada si no encuentran la posición, y entonces «Buscando tu ubicación» no acababa nunca. Sin API de geolocalización o sin https falla con `no-disponible`.
  - En un ordenador, los códigos 2 (sin posición) y 3 (tiempo agotado) y la espera propia dan `sin-fuente`: el navegador no tiene de dónde sacar la posición. Un ordenador no tiene GPS y depende de un servicio que la calcula con las redes wifi cercanas. El Chromium de Arch Linux, con el permiso concedido, no contesta y a los 20 s da el código 3; el Firefox de la misma máquina da la posición con ±13 m. En el móvil, 2 es `sin-senal` y 3, `tiempo-agotado`. El tipo de dispositivo sale de `detectarDispositivo`, como en la brújula. La posición no sale de este servicio: no se guarda ni se envía.
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

La consulta busca en toda España, con `countrycodes=es`, `accept-language=und` (el nombre oficial de cada lugar, Girona y A Coruña, no Gerona ni La Coruña; ver ADR 0013) y 10 resultados, y sin `viewbox`: con él, Nominatim descarta lo que queda fuera de la caja en cuanto encuentra algo dentro (ADR 0013). `buscar(consulta, encuadre)` recibe lo que se ve del mapa y pone primero lo que cae dentro (`ordenarPorEncuadre`); la caché guarda la respuesta por consulta y el orden se decide en cada búsqueda. Las direcciones que se leen igual se descartan.

Cada `Direccion` tiene `nombre`, `detalle` (calle, barrio, distrito o núcleo dentro del municipio) y `lugar`, «Municipio (Provincia)». El municipio sale de `municipality`, `city`, `town` o `village`, en ese orden. `municipality` llega cuando el límite municipal no está unido a un núcleo, como los concellos de Galicia (Rúa Real: «A Insua» en el detalle, «Fisterra (A Coruña)» en el lugar). en Bajamar, `village` es el núcleo y `town`, San Cristóbal de La Laguna. La provincia, de `state_district`. En Madrid, Asturias y el resto de comunidades de una sola provincia no llega y se pone la comunidad.

Las pruebas usan respuestas grabadas en `referencia/`: Barcelona, Girona y A Coruña (grabadas con `accept-language=und`), Soria (ocho plazas mayores de ocho municipios), Tenerife y «Calle Mayor 1» (Madrid y Zaragoza). Si pruebas contra el servidor real, haz pocas búsquedas, a mano y con un segundo como mínimo entre ellas.

## Interfaz

- En el panel (`ReferenciaEnFicha`): sin punto, «¿Desde dónde lo miramos?» con lo que se gana y dos botones. Con el permiso bloqueado explica cómo reactivarlo y solo ofrece elegir en el mapa. Si la ubicación no ha llegado, dice por qué y ofrece «Volver a intentarlo» y «Elegir en el mapa»; el aviso de la cabecera, lo mismo. Mientras se busca, «Elegir en el mapa» y «Cancelar». Con punto, «Desde: tu ubicación (±25 m)» o «Desde: el punto elegido», «Cambiar» y «Quitar», y la distancia y el rumbo al emplazamiento. Con un punto elegido los textos hablan de «el punto», nunca de «ti» (`textos.ts`, con pruebas).
- El paso previo es un `Dialogo` que se abre con «Usar mi ubicación». Solo «Continuar» pide el permiso; «Mejor elijo en el mapa», «Cerrar» o Escape no piden nada.
- El botón «Ubicación» de los controles abre el menú: usar mi ubicación, elegir un punto, centrar y quitar. Lo que no se puede hacer queda a la vista, desactivado y con el motivo.
- Elegir un punto: en escritorio, un clic en el mapa o buscar; el punto se arrastra con el ratón y se mueve con las flechas. En el móvil, un pin fijo en el centro, mover el mapa y «Usar este punto», o buscar. La hoja de la ficha se aparta mientras tanto.
- En el mapa, la ubicación GPS es el hexágono «TÚ» con su círculo de precisión, y el punto elegido, el hexágono naranja con «PUNTO».
- Los avisos bajo la cabecera (fallo, esperando, no guardado) no repiten lo que ya dice la ficha abierta.
- Si el punto de referencia queda a más de 3 km de lo barrido, un aviso bajo la cabecera (`Aviso tono="limite"`) dice «Celda aún no tiene datos de ese punto» (o «de donde estás», con el GPS) y a cuántos kilómetros quedan los datos más cercanos. Lo barrido son las cajas de las zonas de barrido con algún barrido completo, que trae el resumen nacional (`distanciaALoBarrido` en `packages/dominio/src/cobertura.ts`, `fueraDeLosDatos` en `textos.ts`): la cobertura real, no la caja de los emplazamientos (ADR 0016). No nombra la zona cubierta, así que sigue siendo verdad al ampliarla. Se cierra con «Cerrar» hasta que cambie el punto.

La distancia es la de `distanciaMetros` y el rumbo, `rumboGrados` (`packages/dominio/src/area.ts`), mientras el emplazamiento no esté en la capa. Si está, el bloque enseña el sector que da servicio (abajo).

## Sector que da servicio

Con un punto de referencia y el emplazamiento en la capa, el bloque de la ficha cambia la frase de la distancia por `LecturaServicio`: tres casillas (qué sector, cuánto se pierde respecto a su eje y la distancia con el rumbo hasta el emplazamiento), la frase que lo explica, la etiqueta «Modelo sector-servicio v1» y la nota de la orientación. Los textos salen de `textosServicio` (`apps/web/src/servicio/textos.ts`), una función pura con pruebas:

- Menos de 20° del eje: «Estás casi de frente al sector 3 (240°)…». Hasta 45°: los grados y los dB, «poca cosa». Desde 45°: «entre dos sectores», con los dB redondeados. A menos de 15 m: al pie, sin sector. Fuera de la celda, añade que hay otro emplazamiento más cerca.
- Con un punto elegido dicen «El punto está» y «se pierden», nunca «tú», «te» ni «pierdes». Las pruebas lo comprueban en todos los casos.
- El rumbo del sector va en la frase, «sector 2 (120°)», y con una orientación estimada lleva «±15°». La nota dice que la orientación es supuesta, por qué y que el sector que da servicio puede ser otro.

En el mapa, el diagrama de radiación del panel rellena el sector que da servicio y marca hacia dónde queda el punto con «TÚ» o «PUNTO». Junto al punto, `EtiquetaReferencia` dice «340 m · sector 2». Va al lado contrario del emplazamiento y, si ahí no cabe, arriba o abajo, también lejos de él.

## Mejorar la señal y brújula

Con un punto de referencia, la sección «Mejorar la señal» de la ficha dice hacia qué ventana poner un router 4G/5G y a qué rumbo apuntar una antena exterior, y la brújula ayuda a alinearla. Todo está en `apps/web/src/mejorar/`.

- `consejos.ts` es una función pura, `consejos(punto)`, con pruebas. Sin punto da los consejos generales y la llamada a dar uno. Con punto, el rumbo y la distancia salen de `rumboGrados` y `distanciaMetros` al momento, sin esperar al Worker; lo que depende del sector que da servicio (de frente, entre dos, fuera de la celda, al pie) se añade cuando llega. A menos de 300 m dice que suele bastar con el router junto a la ventana, y desde 1 km, que es donde más se nota una antena exterior. La nota dice que la orientación de los sectores es supuesta y que el rumbo sale de la posición publicada. Con un punto elegido habla del punto, como el resto de la ficha.
- `estado.ts` es la brújula como función pura, `transicionBrujula(situacion, evento)`, con los estados apagada, explicando, pidiendo permiso, denegada, esperando, activa, dudosa (el iPhone da un margen de más de 20°, o negativo) y sin sensor (ordenador, navegador sin la API o sin lecturas). Las pruebas recorren todos los estados alcanzables: el permiso solo se pide tras la explicación, donde no hace falta permiso no se explica nada, y solo está activa tras una lectura. `lecturaDeOrientacion` saca el rumbo de `webkitCompassHeading` (Safari) o de `alpha` si es absoluto, y corrige el giro de la pantalla. Un `alpha` relativo no cuenta: se mide desde donde apuntaba el móvil al empezar.
- `brujula.ts` es el servicio `Brujula`, en `ServiciosDeDatos`. `disponibilidad` no pregunta nada: `ordenador` si `detectarDispositivo` dice que lo es, `sin-api` sin `DeviceOrientationEvent` o sin https, `con-permiso` si existe `DeviceOrientationEvent.requestPermission` y `sin-permiso` si no. `pedirPermiso` llama a `requestPermission` dentro del propio efecto; como el runtime ya está montado, `runPromise` lo evalúa en el acto, dentro del gesto, que es lo que exige Safari. `seguir` escucha `deviceorientationabsolute` donde existe y `deviceorientation` donde no, y falla si en 3 s no llega ninguna lectura válida. La capa de prueba, `brujulaDePrueba` en `mejorar/pruebas.ts`, entra en `ubicacionDePrueba` con la opción `brujula` y por defecto es un ordenador. Como el navegador, da lo último leído al empezar a escuchar.
- El Chromium de las capturas también tiene `requestPermission`, así que en Android con Chrome se ve la explicación aunque puede que el navegador no pregunte nada. Por eso dice «puede que tu navegador te pregunte».
- Sin lecturas de verdad la flecha sigue a la barra, que dice que simula el giro. La brújula solo escucha mientras espera o lee y deja de hacerlo al cerrar la ficha.
- No se ha probado en un iPhone ni en un Android de verdad. Las capturas emulan el móvil en Chromium y lanzan eventos `deviceorientationabsolute` a mano. Falta comprobar si `webkitCompassHeading` ya tiene en cuenta el giro de la pantalla.

## Pruebas de componente

`Ubicacion.test.tsx` monta la app con `ubicacionDePrueba()`: un GPS que contesta cuando la prueba llama a `responder` o `fallar`, un almacén en memoria y un buscador con respuestas fijas, que ordena por encuadre como el de verdad. Como el navegador, el GPS entrega al abrirse la última posición que tenga (`enCache` la primera vez), el permiso llega un momento después de montar y el almacén y el buscador contestan en otra tarea (ver [efectos.md](efectos.md)). Cuenta cuántas veces se pidió la ubicación, así que se puede comprobar que el paso previo va antes de pedirla y que una lectura nueva no vuelve a pedirla. `responderTarde` entrega una lectura a vigilancias ya quitadas, como un navegador que llama tarde.

`geolocalizacion.test.ts` prueba la capa real con un `Geolocation` y un permiso de prueba (objetos, no mocks de módulos) y `TestClock`: la espera propia de 20 s, que no corre mientras el aviso del navegador está abierto, los códigos de error en el móvil y en el ordenador, y apagar y volver a encender.

Para probar en Chromium, el contexto de Playwright concede el permiso con `permissions: ["geolocation"]` y `geolocation`; sin concederlo, Chromium sin interfaz lo deniega.
