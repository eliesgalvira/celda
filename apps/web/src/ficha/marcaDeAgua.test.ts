import { assert, describe, it } from "@effect/vitest";

import { compararConCapa } from "./marcaDeAgua.ts";

/** La versión de la capa va al segundo; la de los datos, al milisegundo. */
const NOCHE = Date.UTC(2026, 8, 26, 2, 15, 3);
const DIA = 86_400_000;

describe("marca de agua de la ficha frente a la del mapa", () => {
  it("la ficha de la misma ejecución que la capa está al día, aunque tenga milisegundos", () => {
    assert.deepStrictEqual(compararConCapa(NOCHE, NOCHE + 324), { tipo: "al-dia" });
    assert.deepStrictEqual(compararConCapa(NOCHE, NOCHE + 999), { tipo: "al-dia" });
  });

  it("una ficha que no ha cambiado desde antes de la capa está al día", () => {
    assert.deepStrictEqual(compararConCapa(NOCHE, NOCHE - 3 * DIA), { tipo: "al-dia" });
  });

  it("una ficha cambiada después de la capa es posterior, desde el segundo siguiente", () => {
    assert.deepStrictEqual(compararConCapa(NOCHE, NOCHE + DIA), {
      tipo: "posterior",
      ficha: NOCHE + DIA,
      capa: NOCHE,
    });
    assert.strictEqual(compararConCapa(NOCHE, NOCHE + 1000).tipo, "posterior");
  });

  it("sin capa cargada no se compara nada", () => {
    assert.deepStrictEqual(compararConCapa(undefined, NOCHE), { tipo: "sin-capa" });
  });
});
