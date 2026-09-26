// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { DISTANCIA_MINIMA_M, perdidasUrbanas } from "./perdidasUrbanas.ts";
import { compararConReferencia } from "./referencias.ts";
import { mallaEnRumbo } from "./simulacion.ts";

const perdida = (metros: number, frecuenciaMhz: number): number =>
  perdidasUrbanas.ejecutar({ frecuenciaMhz }, mallaEnRumbo(45, [metros])).perdidaDb[0] ??
  Number.NaN;

describe("pérdidas urbanas", () => {
  it("a 1 km y 2000 MHz son 128,1 dB", () => {
    assert.closeTo(perdida(1000, 2000), 128.1, 1e-9);
  });

  it("suben 37,6 dB cada vez que la distancia se multiplica por diez", () => {
    assert.closeTo(perdida(10_000, 2000) - perdida(1000, 2000), 37.6, 1e-9);
    assert.closeTo(perdida(1000, 1800) - perdida(100, 1800), 37.6, 1e-9);
  });

  it("a 900 MHz dan los 120,9 dB a 1 km del TR 36.942", () => {
    assert.closeTo(perdida(1000, 900), 120.9, 0.1);
  });

  it("las bandas bajas pierden menos que las altas a la misma distancia", () => {
    const bandas = [700, 800, 900, 1800, 2100, 2600, 3500].map((mhz) => perdida(500, mhz));
    assert.deepStrictEqual(
      bandas,
      [...bandas].sort((a, b) => a - b),
    );
  });

  it("no baja de lo que da a la distancia mínima", () => {
    assert.strictEqual(perdida(1, 2000), perdida(DISTANCIA_MINIMA_M, 2000));
    assert.isAbove(perdida(DISTANCIA_MINIMA_M + 1, 2000), perdida(DISTANCIA_MINIMA_M, 2000));
  });

  it.effect("coincide con su fichero de referencia en varias distancias y bandas", () =>
    Effect.gen(function* () {
      const distancias = [10, 35, 50, 100, 250, 500, 1000, 2000, 5000];
      const diferencias = yield* compararConReferencia(
        perdidasUrbanas,
        [700, 800, 900, 1800, 2100, 2600, 3500].map((frecuenciaMhz) => ({
          nombre: `${frecuenciaMhz} MHz`,
          params: { frecuenciaMhz },
          malla: mallaEnRumbo(30, distancias),
        })),
        1e-9,
      );
      assert.deepStrictEqual(diferencias, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
