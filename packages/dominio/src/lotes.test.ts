import { assert, describe, it } from "@effect/vitest";

import { indiceDeHilbert, repartirEnLotes } from "./lotes.ts";

/** Tres emplazamientos a pocos metros unos de otros, alrededor de un punto. */
const racimo = (prefijo: string, longitud: number, latitud: number) =>
  [0, 1, 2].map((i) => ({
    clave: `${prefijo}-${i}`,
    posicion: { longitud: longitud + i * 0.0002, latitud: latitud + i * 0.0001 },
  }));

const CAMPUS_NORD = racimo("campus", 2.1134, 41.3892);
const SAGRERA = racimo("sagrera", 2.1905, 41.4225);
const MADRID = racimo("madrid", -3.7038, 40.4168);

describe("lotes de fichas", () => {
  it("junta en un lote los emplazamientos vecinos, lleguen en el orden que lleguen", () => {
    const todos = [...CAMPUS_NORD, ...MADRID, ...SAGRERA];
    const lotes = repartirEnLotes(todos, 3);
    assert.lengthOf(lotes, 3);
    for (const racimo of [CAMPUS_NORD, SAGRERA, MADRID]) {
      const claves = racimo.map((e) => e.clave);
      assert.isTrue(
        lotes.some((lote) => claves.every((clave) => lote.includes(clave))),
        claves.join(", "),
      );
    }
    assert.deepStrictEqual(repartirEnLotes(todos.toReversed(), 3), lotes);
  });

  it("cada emplazamiento va en un solo lote, y el último puede ir incompleto", () => {
    const todos = [...CAMPUS_NORD, ...SAGRERA, ...MADRID];
    const lotes = repartirEnLotes(todos, 4);
    assert.deepStrictEqual(
      lotes.map((lote) => lote.length),
      [4, 4, 1],
    );
    assert.sameMembers(
      lotes.flat(),
      todos.map((e) => e.clave),
    );
    assert.deepStrictEqual(repartirEnLotes([], 4), []);
  });

  it("dos emplazamientos en el mismo sitio se ordenan por clave", () => {
    const posicion = { longitud: 2.1134, latitud: 41.3892 };
    const lotes = repartirEnLotes(
      [
        { clave: "vodafone-1", posicion },
        { clave: "movistar-1", posicion },
      ],
      1,
    );
    assert.deepStrictEqual(lotes, [["movistar-1"], ["vodafone-1"]]);
  });

  it("la curva recorre el mundo entero, polos y antimeridiano incluidos", () => {
    const esquinas = [
      { longitud: -180, latitud: -90 },
      { longitud: 180, latitud: 90 },
      { longitud: 180, latitud: -90 },
      { longitud: -180, latitud: 90 },
    ].map(indiceDeHilbert);
    for (const indice of esquinas) {
      assert.isTrue(Number.isSafeInteger(indice) && indice >= 0 && indice < 2 ** 40, `${indice}`);
    }
    assert.strictEqual(new Set(esquinas).size, 4);
  });
});
