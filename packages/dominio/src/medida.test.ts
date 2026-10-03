import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  calidadDeLaSenal,
  Medida,
  MEDIDA_DE_EJEMPLO,
  MedidaDeEjemplo,
  MedidaPropia,
  medidasPropias,
  potenciaDeLaSenal,
} from "./medida.ts";

const leerPropia = Schema.decodeUnknownEffect(MedidaPropia);
const leerEjemplo = Schema.decodeUnknownEffect(MedidaDeEjemplo);
const leerMedidas = Schema.decodeUnknownEffect(Schema.Array(Medida));

const PROPIA: MedidaPropia = {
  tipo: "propia",
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  esquema: 1,
  creada: Date.UTC(2026, 8, 26, 10, 30),
  origen: "captura",
  punto: { longitud: 2.1134, latitud: 41.3893 },
  senal: { compania: "vodafone", red: "5g", mhz: 3500, rsrpDbm: -88, rsrqDb: -11, pci: 401 },
  unidaA: {
    emplazamiento: "vodafone-086040",
    posicion: { longitud: 2.113628, latitud: 41.388344 },
    azimut: 120,
  },
};

describe("Medida", () => {
  it.effect("la medida de ejemplo no pasa por una medida propia", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(leerPropia(MEDIDA_DE_EJEMPLO));
      assert.match(error.message, /propia/u);
    }),
  );

  it.effect("una medida propia tampoco pasa por una de ejemplo", () =>
    Effect.flip(leerEjemplo(PROPIA)),
  );

  it.effect("una medida es propia o de ejemplo, y al leerla conserva cuál es", () =>
    Effect.gen(function* () {
      const leidas = yield* leerMedidas([MEDIDA_DE_EJEMPLO, PROPIA]);
      assert.deepStrictEqual(
        leidas.map((medida) => medida.tipo),
        ["ejemplo", "propia"],
      );
    }),
  );

  it("las medidas propias de una lista nunca incluyen la de ejemplo", () => {
    const medidas: ReadonlyArray<Medida> = [MEDIDA_DE_EJEMPLO, PROPIA, MEDIDA_DE_EJEMPLO];
    assert.deepStrictEqual(medidasPropias(medidas), [PROPIA]);
    assert.deepStrictEqual(medidasPropias([MEDIDA_DE_EJEMPLO]), []);
  });

  it("una medida de ejemplo no se puede usar donde se espera una propia", () => {
    // @ts-expect-error: una medida de ejemplo no es una medida propia (historia 49).
    const comoPropia: MedidaPropia = MEDIDA_DE_EJEMPLO;
    assert.strictEqual(comoPropia.tipo, "ejemplo");
  });

  it.effect("la medida de ejemplo que trae Celda es válida y está en Barcelona", () =>
    Effect.gen(function* () {
      const ejemplo = yield* leerEjemplo(MEDIDA_DE_EJEMPLO);
      assert.isAbove(ejemplo.punto.latitud, 41.3);
      assert.isBelow(ejemplo.punto.latitud, 41.5);
    }),
  );

  it.effect("rechaza una potencia fuera de lo que puede dar un móvil", () =>
    Effect.flip(leerPropia({ ...PROPIA, senal: { ...PROPIA.senal, rsrpDbm: 12 } })),
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
