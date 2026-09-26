import { assert, describe, it } from "@effect/vitest";

import { desplazamientoParaVer } from "./enfoque.ts";

const ESCRITORIO = { ancho: 1400, alto: 900, escritorio: true };
const MOVIL = { ancho: 390, alto: 844, escritorio: false };

describe("mover el mapa para ver el marcador seleccionado", () => {
  it("si el marcador ya se ve junto al panel, el mapa no se mueve", () => {
    assert.isUndefined(desplazamientoParaVer({ x: 700, y: 100 }, ESCRITORIO));
    assert.isUndefined(desplazamientoParaVer({ x: 30, y: 400 }, MOVIL));
  });

  it("en escritorio, un marcador bajo el panel pasa a su derecha", () => {
    // panBy con x negativa lleva el contenido del mapa hacia la derecha.
    assert.deepStrictEqual(desplazamientoParaVer({ x: 200, y: 500 }, ESCRITORIO), [-288, 0]);
  });

  it("en el móvil, un marcador bajo el resumen de la hoja sube por encima", () => {
    assert.deepStrictEqual(desplazamientoParaVer({ x: 200, y: 800 }, MOVIL), [0, 200]);
  });
});
