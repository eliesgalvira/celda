import { assert, describe, it } from "@effect/vitest";

import type { Punto } from "./geometria.ts";
import { rasterizar } from "./raster.ts";

const NEGRO = { r: 0, g: 0, b: 0 };

const cuadrado = (x: number, y: number, lado: number): Array<Punto> => [
  [x, y],
  [x + lado, y],
  [x + lado, y + lado],
  [x, y + lado],
];

/** El alfa del píxel (x, y) de una imagen RGBA de `ancho` px. */
const alfa = (pixeles: Uint8Array, ancho: number, x: number, y: number) =>
  pixeles[(y * ancho + x) * 4 + 3] ?? 0;

describe("rasterizador de la marca", () => {
  it("con par-impar dos contornos solapados dejan un hueco; con no-cero se unen", () => {
    const contornos = [cuadrado(0, 0, 6), cuadrado(3, 0, 6)];
    const parImpar = rasterizar(10, 4, [{ contornos, color: NEGRO }]);
    const noCero = rasterizar(10, 4, [{ contornos, color: NEGRO, regla: "no-cero" }]);
    assert.strictEqual(alfa(parImpar, 10, 1, 1), 255);
    assert.strictEqual(alfa(parImpar, 10, 4, 1), 0, "el solape, en par-impar");
    assert.strictEqual(alfa(noCero, 10, 4, 1), 255, "el solape, en no-cero");
    assert.strictEqual(alfa(noCero, 10, 9, 1), 0, "fuera de los dos");
  });

  it("el lienzo puede ser más ancho que alto", () => {
    const pixeles = rasterizar(8, 2, [{ contornos: [cuadrado(6, 0, 2)], color: NEGRO }]);
    assert.strictEqual(pixeles.length, 8 * 2 * 4);
    assert.strictEqual(alfa(pixeles, 8, 7, 1), 255);
    assert.strictEqual(alfa(pixeles, 8, 0, 1), 0);
  });

  it("los discos que coinciden se tapan unos a otros", () => {
    const uno = rasterizar(5, 5, [
      { centros: [2.5, 2.5], radio: 1.5, color: NEGRO, opacidad: 0.5 },
    ]);
    const dos = rasterizar(5, 5, [
      { centros: [2.5, 2.5, 2.5, 2.5], radio: 1.5, color: NEGRO, opacidad: 0.5 },
    ]);
    assert.strictEqual(alfa(uno, 5, 2, 2), 128);
    assert.strictEqual(alfa(dos, 5, 2, 2), 191);
    assert.strictEqual(alfa(dos, 5, 0, 0), 0);
  });
});
