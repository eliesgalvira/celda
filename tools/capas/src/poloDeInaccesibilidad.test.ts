import { assert, describe, it } from "@effect/vitest";

import {
  distanciaConSigno,
  type PoligonoPlano,
  poloDeInaccesibilidad,
} from "./poloDeInaccesibilidad.ts";

const cuadrado = (lado: number, x = 0, y = 0): ReadonlyArray<readonly [number, number]> => [
  [x, y],
  [x + lado, y],
  [x + lado, y + lado],
  [x, y + lado],
  [x, y],
];

describe("polo de inaccesibilidad", () => {
  it("en un cuadrado es su centro, a medio lado de cada borde", () => {
    const polo = poloDeInaccesibilidad([cuadrado(100)], 1);
    assert.closeTo(polo.x, 50, 1);
    assert.closeTo(polo.y, 50, 1);
    assert.closeTo(polo.distancia, 50, 1);
  });

  it("en una L cae en el brazo ancho, dentro, y no en el centro de su caja", () => {
    // Un brazo de 100 × 40 abajo y otro de 40 × 100 a la izquierda: el centro de la caja,
    // (50, 50), queda fuera.
    const ele: PoligonoPlano = [
      [
        [0, 0],
        [100, 0],
        [100, 40],
        [40, 40],
        [40, 100],
        [0, 100],
        [0, 0],
      ],
    ];
    assert.isBelow(distanciaConSigno(50, 50, ele), 0);
    const polo = poloDeInaccesibilidad(ele, 0.5);
    assert.isAbove(distanciaConSigno(polo.x, polo.y, ele), 0);
    // En la esquina de dentro de la L: x = y = 40√2 / (1 + √2), a esa misma distancia de todo.
    const esquina = (40 * Math.SQRT2) / (1 + Math.SQRT2);
    assert.closeTo(polo.distancia, esquina, 0.6);
    assert.closeTo(polo.x, esquina, 1.5);
    assert.closeTo(polo.y, esquina, 1.5);
  });

  it("esquiva un agujero en medio", () => {
    const conAgujero: PoligonoPlano = [cuadrado(100), cuadrado(40, 30, 30)];
    const polo = poloDeInaccesibilidad(conAgujero, 0.5);
    assert.isAbove(distanciaConSigno(polo.x, polo.y, conAgujero), 0);
    assert.isFalse(polo.x > 30 && polo.x < 70 && polo.y > 30 && polo.y < 70, "en el agujero");
  });

  it("no se aparta del mejor más que la precisión", () => {
    const rectangulo: PoligonoPlano = [
      [
        [0, 0],
        [1000, 0],
        [1000, 200],
        [0, 200],
        [0, 0],
      ],
    ];
    const polo = poloDeInaccesibilidad(rectangulo, 10);
    assert.isAtLeast(polo.distancia, 100 - 10);
    assert.isAtMost(polo.distancia, 100);
  });

  it("la distancia con signo es negativa fuera y positiva dentro", () => {
    const uno = [cuadrado(10)];
    assert.closeTo(distanciaConSigno(5, 5, uno), 5, 1e-9);
    assert.closeTo(distanciaConSigno(15, 5, uno), -5, 1e-9);
  });
});
