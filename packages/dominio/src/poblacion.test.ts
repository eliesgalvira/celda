import { assert, describe, it } from "@effect/vitest";

import { areaKm2 } from "./poblacion.ts";

/** Un grado de latitud mide unos 111,2 km; uno de longitud, eso por el coseno de la latitud. */
const KM_POR_GRADO = (6_371.0088 * Math.PI) / 180;

const cuadrado = (x: number, y: number, lado: number) =>
  [
    [x, y],
    [x + lado, y],
    [x + lado, y + lado],
    [x, y + lado],
  ] as const;

describe("área de un barrio", () => {
  it("mide un cuadrado de 1 km de lado, en cualquier sentido de giro", () => {
    const lado = 1 / KM_POR_GRADO;
    const ancho = lado / Math.cos((41.39 * Math.PI) / 180);
    const anillo = [
      [2.16, 41.39],
      [2.16 + ancho, 41.39],
      [2.16 + ancho, 41.39 + lado],
      [2.16, 41.39 + lado],
    ] as const;
    assert.closeTo(areaKm2([[anillo]]), 1, 0.001);
    assert.closeTo(areaKm2([[anillo.toReversed()]]), 1, 0.001);
  });

  it("resta los agujeros y suma los polígonos sueltos", () => {
    const grande = areaKm2([[cuadrado(2.1, 41.3, 0.01)]]);
    const conAgujero = areaKm2([[cuadrado(2.1, 41.3, 0.01), cuadrado(2.102, 41.302, 0.005)]]);
    assert.closeTo(conAgujero, grande * 0.75, grande * 0.002);
    const dos = areaKm2([[cuadrado(2.1, 41.3, 0.01)], [cuadrado(2.2, 41.3, 0.01)]]);
    assert.closeTo(dos, grande * 2, grande * 0.002);
  });
});
