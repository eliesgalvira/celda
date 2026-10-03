import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stdio from "effect/Stdio";
import * as Terminal from "effect/Terminal";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { lanzarModerar, Salida } from "../ordenes.ts";

/** Lo que ha hecho una orden: lo que ha escrito en cada salida y cómo ha acabado. */
export interface OrdenLanzada<E> {
  readonly salida: string;
  readonly errores: string;
  readonly fin: Exit.Exit<void, E>;
}

/** Lo que pide la línea de órdenes de Effect, sin nada de verdad detrás: las órdenes no lo usan. */
const ENTORNO = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(100),
      rows: Effect.succeed(40),
      readInput: Effect.die("la herramienta no lee de la terminal"),
      readLine: Effect.die("la herramienta no lee de la terminal"),
      display: () => Effect.void,
    }),
  ),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("la herramienta no lanza procesos")),
  ),
);

/**
 * Lanza `moderar` con estos argumentos, como desde la terminal, y recoge lo que escribe. El buzón
 * y lo publicado los pone quien llama.
 */
export const lanzar = (argumentos: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const salida = yield* Ref.make<ReadonlyArray<string>>([]);
    const errores = yield* Ref.make<ReadonlyArray<string>>([]);
    const capturada = Layer.succeed(
      Salida,
      Salida.of({
        escribir: (texto) => Ref.update(salida, (s) => [...s, texto]),
        avisar: (texto) => Ref.update(errores, (s) => [...s, texto]),
      }),
    );
    const fin = yield* Effect.exit(
      // Es el punto de entrada de la orden en la prueba, como `moderar` desde la terminal: aquí se
      // montan sus capas, una vez.
      // @effect-diagnostics-next-line strictEffectProvide:off
      lanzarModerar(argumentos, false).pipe(Effect.provide(Layer.merge(capturada, ENTORNO))),
    );
    return {
      salida: (yield* Ref.get(salida)).join("\n"),
      errores: (yield* Ref.get(errores)).join("\n"),
      fin,
    };
  });
