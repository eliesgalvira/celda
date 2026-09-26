// Cada prueba monta su propio simulador.
// @effect-diagnostics strictEffectProvide:off
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { diagramaSector, SECTOR_TIPICO } from "./diagramaSector.ts";
import { workerDePrueba } from "./pruebas.ts";
import { SimulacionFallida, simuladorEnHilo, simuladorEnWorker, Simulador } from "./simulador.ts";
import { mallaDeRumbos } from "./simulacion.ts";

const PARAMS = { azimuts: [0, 120, 240], ...SECTOR_TIPICO };
const MALLA = mallaDeRumbos(30);

/** Deja correr a las demás fibras hasta que la condición se cumple. */
const hasta = (condicion: () => boolean) =>
  Effect.gen(function* () {
    while (!condicion()) {
      yield* Effect.yieldNow;
    }
  });

describe("simulador", () => {
  it.effect("en el mismo hilo da lo mismo que la simulación", () =>
    Effect.gen(function* () {
      const simulador = yield* Simulador;
      const resultado = yield* simulador.ejecutar(diagramaSector, PARAMS, MALLA);
      assert.deepStrictEqual(resultado, diagramaSector.ejecutar(PARAMS, MALLA));
    }).pipe(Effect.provide(simuladorEnHilo())),
  );

  it.effect("rechaza parámetros que no cumplen su esquema", () =>
    Effect.gen(function* () {
      const simulador = yield* Simulador;
      const fallo = yield* Effect.flip(
        simulador.ejecutar(diagramaSector, { ...PARAMS, azimuts: [] }, MALLA),
      );
      assert.instanceOf(fallo, SimulacionFallida);
      assert.strictEqual(fallo.simulacion, "diagrama-sector@1");
    }).pipe(Effect.provide(simuladorEnHilo())),
  );

  it.effect("una simulación sin registrar no se calcula", () =>
    Effect.gen(function* () {
      const simulador = yield* Simulador;
      const fallo = yield* Effect.flip(simulador.ejecutar(diagramaSector, PARAMS, MALLA));
      assert.match(fallo.motivo, /No hay ninguna simulación/u);
    }).pipe(Effect.provide(simuladorEnHilo([]))),
  );

  it.effect("en el Worker contesta con lo que calcula el Worker", () => {
    const worker = workerDePrueba();
    return Effect.gen(function* () {
      const simulador = yield* Simulador;
      assert.strictEqual(worker.creados(), 0);
      const fibra = yield* Effect.forkChild(simulador.ejecutar(diagramaSector, PARAMS, MALLA));
      yield* hasta(() => worker.pendientes().length === 1);
      assert.strictEqual(worker.pendientes()[0]?.simulacion, "diagrama-sector");
      worker.contestar();
      const resultado = yield* Fiber.join(fibra);
      assert.deepStrictEqual(resultado, diagramaSector.ejecutar(PARAMS, MALLA));
      assert.strictEqual(worker.creados(), 1);
    }).pipe(Effect.provide(simuladorEnWorker(worker.crear)));
  });

  it.effect("interrumpir un cálculo termina el Worker y el siguiente arranca otro", () => {
    const worker = workerDePrueba();
    return Effect.gen(function* () {
      const simulador = yield* Simulador;
      const primera = yield* Effect.forkChild(simulador.ejecutar(diagramaSector, PARAMS, MALLA));
      yield* hasta(() => worker.pendientes().length === 1);
      yield* Fiber.interrupt(primera);
      assert.strictEqual(worker.terminados(), 1);
      assert.strictEqual(worker.pendientes().length, 0);

      const segunda = yield* Effect.forkChild(simulador.ejecutar(diagramaSector, PARAMS, MALLA));
      yield* hasta(() => worker.pendientes().length === 1);
      worker.contestar();
      yield* Fiber.join(segunda);
      assert.strictEqual(worker.creados(), 2);
    }).pipe(Effect.provide(simuladorEnWorker(worker.crear)));
  });

  it.effect("atiende una solicitud cada vez", () => {
    const worker = workerDePrueba();
    return Effect.gen(function* () {
      const simulador = yield* Simulador;
      const a = yield* Effect.forkChild(simulador.ejecutar(diagramaSector, PARAMS, MALLA));
      const b = yield* Effect.forkChild(simulador.ejecutar(diagramaSector, PARAMS, MALLA));
      yield* hasta(() => worker.pendientes().length === 1);
      yield* Effect.yieldNow;
      assert.strictEqual(worker.pendientes().length, 1);
      worker.contestar();
      yield* Fiber.join(a);
      yield* hasta(() => worker.pendientes().length === 1);
      worker.contestar();
      yield* Fiber.join(b);
      assert.strictEqual(worker.creados(), 1);
    }).pipe(Effect.provide(simuladorEnWorker(worker.crear)));
  });

  it.effect("si el Worker falla, lo dice y el siguiente cálculo arranca otro", () => {
    const worker = workerDePrueba();
    return Effect.gen(function* () {
      const simulador = yield* Simulador;
      const fibra = yield* Effect.forkChild(
        Effect.flip(simulador.ejecutar(diagramaSector, PARAMS, MALLA)),
      );
      yield* hasta(() => worker.pendientes().length === 1);
      worker.fallar("se ha quedado sin memoria");
      const fallo = yield* Fiber.join(fibra);
      assert.match(fallo.motivo, /se ha quedado sin memoria/u);

      const otra = yield* Effect.forkChild(simulador.ejecutar(diagramaSector, PARAMS, MALLA));
      yield* hasta(() => worker.pendientes().length === 1);
      worker.contestar();
      yield* Fiber.join(otra);
      assert.strictEqual(worker.creados(), 2);
    }).pipe(Effect.provide(simuladorEnWorker(worker.crear)));
  });

  it.effect("al cerrar el simulador termina su Worker", () => {
    const worker = workerDePrueba();
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const simulador = yield* Simulador;
        const fibra = yield* Effect.forkChild(simulador.ejecutar(diagramaSector, PARAMS, MALLA));
        yield* hasta(() => worker.pendientes().length === 1);
        worker.contestar();
        yield* Fiber.join(fibra);
      }).pipe(Effect.provide(simuladorEnWorker(worker.crear)));
      assert.strictEqual(worker.terminados(), 1);
    });
  });
});
