import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  calidadDeLaSenal,
  MEDIDA_DE_EJEMPLO,
  MedidaDeEjemplo,
  potenciaDeLaSenal,
} from "./medida.ts";

const leerEjemplo = Schema.decodeEffect(MedidaDeEjemplo);

describe("MEDIDA_DE_EJEMPLO", () => {
  it.effect("es válida y está en Barcelona", () =>
    Effect.gen(function* () {
      const ejemplo = yield* leerEjemplo(MEDIDA_DE_EJEMPLO);
      assert.isAbove(ejemplo.punto.latitud, 41.3);
      assert.isBelow(ejemplo.punto.latitud, 41.5);
    }),
  );
});

describe("potenciaDeLaSenal", () => {
  it("clasifica la potencia por decenas de dB", () => {
    assert.strictEqual(potenciaDeLaSenal(-75), "excelente");
    assert.strictEqual(potenciaDeLaSenal(-80), "excelente");
    assert.strictEqual(potenciaDeLaSenal(-85), "buena");
    assert.strictEqual(potenciaDeLaSenal(-90), "regular");
    assert.strictEqual(potenciaDeLaSenal(-99), "regular");
    assert.strictEqual(potenciaDeLaSenal(-100), "mala");
    assert.strictEqual(potenciaDeLaSenal(-120), "mala");
  });
});

describe("calidadDeLaSenal", () => {
  it("clasifica la calidad por tramos de 5 dB", () => {
    assert.strictEqual(calidadDeLaSenal(-8), "excelente");
    assert.strictEqual(calidadDeLaSenal(-10), "excelente");
    assert.strictEqual(calidadDeLaSenal(-12), "buena");
    assert.strictEqual(calidadDeLaSenal(-15), "regular");
    assert.strictEqual(calidadDeLaSenal(-19.5), "regular");
    assert.strictEqual(calidadDeLaSenal(-20), "mala");
  });
});
