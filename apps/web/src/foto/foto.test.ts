import { assert, describe, it } from "@effect/vitest";

import { aPieDeCalle, pideVerFoto, type SituacionDeLaFoto, ZOOM_VER_FOTO } from "./foto.ts";

const A_PIE_DE_CALLE: SituacionDeLaFoto = {
  encendida: false,
  seleccionado: true,
  aPieDeCalle: true,
};

describe("pista «Ver foto»", () => {
  it("sale a pie de calle, desde el zoom 16, con un emplazamiento seleccionado y la foto apagada", () => {
    assert.strictEqual(ZOOM_VER_FOTO, 16);
    assert.isTrue(aPieDeCalle(16));
    assert.isTrue(aPieDeCalle(18.5));
    assert.isFalse(aPieDeCalle(15.9));
    assert.isTrue(pideVerFoto(A_PIE_DE_CALLE));
  });

  it("no sale más lejos, sin emplazamiento ni con la foto ya encendida", () => {
    assert.isFalse(pideVerFoto({ ...A_PIE_DE_CALLE, aPieDeCalle: false }));
    assert.isFalse(pideVerFoto({ ...A_PIE_DE_CALLE, seleccionado: false }));
    assert.isFalse(pideVerFoto({ ...A_PIE_DE_CALLE, encendida: true }));
  });
});
