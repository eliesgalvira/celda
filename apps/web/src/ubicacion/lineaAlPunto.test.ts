import { assert, describe, it } from "@effect/vitest";

import { lineaAlPunto } from "./lineaAlPunto.ts";

const EMPLAZAMIENTO = { longitud: 2.1132, latitud: 41.3889 };
const PUNTO = { longitud: 2.1158, latitud: 41.3907 };

describe("línea hasta el punto de referencia", () => {
  it("va del emplazamiento al punto, y si falta uno de los dos no hay", () => {
    assert.deepStrictEqual(lineaAlPunto(EMPLAZAMIENTO, PUNTO).features[0]?.geometry.coordinates, [
      [EMPLAZAMIENTO.longitud, EMPLAZAMIENTO.latitud],
      [PUNTO.longitud, PUNTO.latitud],
    ]);
    assert.lengthOf(lineaAlPunto(EMPLAZAMIENTO, undefined).features, 0);
    assert.lengthOf(lineaAlPunto(undefined, PUNTO).features, 0);
  });
});
