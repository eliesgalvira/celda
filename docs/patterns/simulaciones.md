# Simulaciones

Léelo antes de añadir o cambiar una simulación. La decisión de fondo está en la [ADR 0005](../adr/0005-simulaciones-puras-interfaz-fija.md): cada simulación es una función pura detrás de una interfaz fija, se calcula en un Web Worker y la versión en TypeScript es la referencia.

## Dónde está cada cosa

- `packages/sim/src/simulacion.ts`: la interfaz `Simulacion<Params, R>`, la `Malla` y sus ayudas (`rumboDe`, `distanciaDe`, `mallaDeRumbos`, `mallaEnRumbo`, `mallaHexagonal`).
- `packages/sim/src/diagramaSector.ts`, `perdidasUrbanas.ts`, `celdas.ts` y `sinr.ts`: las simulaciones de hoy.
- `packages/sim/src/poligono.ts`: polígonos del plano local (área, si contienen un punto, recorte por un semiplano).
- `packages/sim/src/registro.ts`: `SIMULACIONES`, la lista de lo que sabe calcular el Worker.
- `packages/sim/src/protocolo.ts`: `atender`, lo que hace el Worker con cada solicitud. La versión en el mismo hilo llama a la misma función.
- `packages/sim/src/simulador.ts`: el servicio `Simulador` de Effect, con dos capas. `simuladorEnWorker` es la de la web y `simuladorEnHilo`, la de las pruebas.
- `packages/sim/src/referencia/<id>@<version>.json`: los resultados de referencia.
- `apps/web/src/simulacion/`: el fichero del Worker y la capa del navegador.

## La interfaz

```ts
interface Simulacion<Params, R extends Resultado> {
  id: string;
  version: string;
  params: Schema.Codec<Params, Schema.Json>;
  ejecutar(p: Params, malla: Malla): R;
}
```

- `ejecutar` es pura. No lee la hora, el azar, la red ni nada que no le llegue en `p` o en la malla.
- `params` es un esquema de Effect cuyo formato codificado es JSON. Es lo que viaja al Worker y lo que se guarda en los ficheros de referencia. El Worker lo decodifica antes de calcular, así que unos parámetros no válidos acaban en `SimulacionFallida` y no en un resultado raro.
- El resultado es un objeto de arrays tipados (`Float64Array`, `Uint8Array`…). Vuelven del Worker sin copiarse. Un valor suelto es un array de uno.
- La malla son puntos en un plano local en metros, `este[i]` y `norte[i]`, alrededor de un origen que elige quien llama. El diagrama solo mira el rumbo de cada punto; las pérdidas, la distancia. Una simulación con varias estaciones base las recibe en `p` con sus coordenadas en el mismo plano.

## Añadir una simulación

No hace falta tocar el Worker, el servicio ni la web.

1. Crea `packages/sim/src/<nombre>.ts` con el esquema de sus parámetros, el tipo del resultado y un `Simulacion` con `id` nuevo y `version: "1"`. Cita la fuente del modelo en el comentario, como hacen las dos que hay.
2. Añádela a `SIMULACIONES` en `registro.ts`.
3. Escribe `packages/sim/src/<nombre>.test.ts`. Primero las propiedades que se pueden comprobar a mano (como los −3 dB a 32,5° del diagrama). Después, una prueba con `compararConReferencia(simulacion, casos, tolerancia)` y unos cuantos casos con nombre.
4. Genera el fichero de referencia con `pnpm --filter @celda/sim run referencias` y léelo antes de hacer commit. La prueba del registro falla mientras falte el fichero de alguna simulación registrada.

Para usarla desde la interfaz, pide al servicio `Simulador` que la ejecute (`simulador.ejecutar(simulacion, params, malla)`) dentro de un `Effect`. En un componente, conviértelo en lectura con `enVivo` como hace `apps/web/src/ficha/ComoEmite.tsx`. Enseña siempre la etiqueta de modelo con `id` y `version` (`DiagramaRadiacion` lo hace) y di de dónde sale cada dato de entrada que no sea una medida.

## Cambiar una simulación

Si cambia lo que calcula, aunque sea un redondeo, sube `version`. El fichero de la versión anterior no se toca ni se reescribe: `compararConReferencia` nunca pisa un fichero que ya existe, y los casos de la prueba tienen que coincidir con los del fichero. La interfaz enseña la versión nueva sin hacer nada más.

La tolerancia se declara al generar el fichero y va dentro de él. Las de TypeScript son de 1e-9. Una implementación en otro lenguaje (Bend o WASM, fuera de la v1) tiene que coincidir con el mismo fichero dentro de esa tolerancia, o traer un fichero con la suya y un motivo.

## El Worker

- `simuladorEnWorker` crea el Worker con la primera simulación, no al cargar la página.
- Atiende una solicitud cada vez. Si una se interrumpe a medias, termina el Worker y la siguiente arranca otro. Un cálculo síncrono no se puede parar de otra forma.
- En la web, cada lectura va ligada a la clave del emplazamiento. Al seleccionar otro, Solid cierra la lectura anterior, el flujo se interrumpe y el Worker se termina si aún calculaba.
- Si el Worker falla, `ejecutar` falla con `SimulacionFallida` y el panel lo dice con un reintento. El resto de la ficha sigue.

## Pruebas

- Los núcleos se prueban como funciones puras, sin Worker.
- El servicio se prueba con `workerDePrueba()` (`packages/sim/src/pruebas.ts`). Guarda las solicitudes y no contesta hasta que la prueba llama a `contestar()` o `fallar()`, así se comprueban la cancelación y los fallos sin esperas.
- Las pruebas de componentes montan `simuladorEnHilo()` en `App`. Para ver el estado de cálculo o la cancelación, montan `simuladorEnWorker(workerDePrueba().crear)`.

## Celdas

`celdas` recibe los emplazamientos en el plano local y una caja, y devuelve la celda de cada uno recortada a la caja. `vertices` lleva todos los vértices seguidos e `inicio`, dónde empieza cada celda. De cada punto de la malla dice en qué celda cae (el emplazamiento más cercano, o −1 fuera de la caja). Con una malla vacía solo calcula las celdas.

- Cada celda es la caja recortada por la mediatriz con cada vecino. Los vecinos se buscan por anillos en una rejilla y se para cuando ninguno de los que faltan puede recortar más. Con los 1318 emplazamientos de la capa tarda unos 20 ms.
- Las pruebas comprueban la propiedad y no solo casos: las celdas suman el área de la caja, dos celdas no tienen área en común y cada punto al azar cae en la celda de su emplazamiento más cercano, calculado comparando con todos. Hay configuraciones con repetidos, en fila, en rejilla (empates en las esquinas) y fuera de la caja.
- Si dos emplazamientos están en el mismo punto, la celda es del primero y el otro se queda sin ella.
- La web la calcula entre todos los emplazamientos, sea cual sea su compañía (`CONTEXT.md`), en un plano centrado en la capa (`aPlano` de `@celda/dominio/plano`) y con una caja 100 m más ancha que los emplazamientos. Fuera de la zona de la ingesta puede haber emplazamientos que Celda no conoce, así que las celdas no se alargan por ahí.

`repartirEnSectores(celda, emplazamiento, azimuts)` divide una celda entre los sectores de su estación base, para el ticket 23. A cada punto le toca el sector cuyo eje queda más cerca de su rumbo, que con sectores iguales es el que da más ganancia en el diagrama de sector. Devuelve un polígono por azimut; un sector de más de 180° no es convexo, pero juntos cubren la celda sin solaparse. No está en el registro porque es geometría sobre el resultado de `celdas` y el Worker no la necesita.

## Señal frente a interferencia (`sinr@1`)

`sinr` recibe las estaciones base de una compañía en una banda, en el plano de la malla, con sus azimuts y su potencia por sector, la frecuencia, la ocupación (0 a 1) y el ruido. En cada punto, cada sector llega con su potencia, la ganancia del diagrama de sector hacia el punto y las pérdidas urbanas. Da servicio el sector que llega con más potencia, y el resto, también los otros sectores de la misma estación, es interferencia: reutilización 1. SINR = S / (ocupación · ΣI + N), en dB. Devuelve además la estación y el sector que dan servicio. Sin estaciones, `NaN` y −1.

- `RED_TIPICA` da la potencia (58 dBm: 43 dBm y 15 dBi) y el ruido (−95 dBm en 10 MHz con 9 dB de figura de ruido). Ninguna fuente publica la potencia; entre emplazamientos tan juntos manda la interferencia y apenas cambia nada.
- Calcula en potencias lineales, sin llamar a `gananciaSector` ni a `perdidaUrbana`: una trama de 6000 puntos con 300 estaciones tarda unos 100 ms en un portátil. La prueba la compara punto a punto con esas dos funciones.
- Las pruebas de propiedades: empeora en cada punto al subir la ocupación (configuraciones al azar), los bordes con menos de 0 dB crecen con ella, mejora al acercarse por el eje al emplazamiento que da servicio y da servicio el sector que más llega. Que otra compañía u otra banda no cambian nada se comprueba en la web, que es quien elige las estaciones (`apps/web/src/interferencia/interferencia.test.ts`).
- `mallaHexagonal(rectangulo, radio)` da los centros de una trama de hexágonos anclada al origen del plano: dos rectángulos que se solapan comparten los puntos, así que al mover el mapa la trama no baila.

La web (`apps/web/src/interferencia/`) usa un plano con origen fijo en el centro de Barcelona. Entran las estaciones base de la compañía que el registro da en la banda y las que aún no tienen bandas leídas, que se suponen en ella; las que el registro da solo en otras bandas no estorban. El panel lo dice con el recuento. Todas llevan tres sectores supuestos a 0°, 120° y 240°. Solo cuentan las que quedan a 1,5 km o menos de lo que se ve o del punto de referencia. La trama tiene hexágonos de 13 px al medio nivel de zoom y cubre lo que se ve más un 15 % por cada lado, así que un arrastre corto no vuelve a calcular (`mismaTrama`). Por debajo del zoom 14 solo se calcula el valor en el punto de referencia, que va como último punto de la malla.

## Diagrama de sector y orientación

El registro oficial no publica el azimut de los sectores, y antenasmoviles.es tampoco (`docs/investigacion/registro-oficial.md`). Los ángulos de las medidas de exposición del ministerio son rumbos de puntos de medida y no sirven. Por eso el panel dibuja siempre una orientación que no es un dato:

- si hay azimuts estimados, con su margen de ±15°, en la leyenda y en el dibujo;
- si no hay ninguno, que hoy es siempre, tres sectores supuestos a 0°, 120° y 240°, con trazo discontinuo y una nota que dice que la orientación es supuesta y por qué.

`orientacionDe` (`apps/web/src/ficha/diagrama.ts`) decide cuál de las dos. Cuando alguna fuente dé estimaciones, solo cambia lo que recibe.
