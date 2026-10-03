import { ESPANA } from "@celda/dominio/area";
import { assert, describe, it } from "@effect/vitest";

import { ZOOMS_SIN_PARTIR_DE_MAPLIBRE, zoomsSinPartir } from "./teselas.ts";

describe("zoomsSinPartir", () => {
  it("con el zoom máximo de Celda, 18,5, estira 3,5 zooms y parte las teselas hasta el 15", () => {
    assert.strictEqual(ESPANA.zoomMaximo, 18.5);
    assert.strictEqual(zoomsSinPartir(ESPANA.zoomMaximo), 3.5);
    assert.strictEqual(ESPANA.zoomMaximo - zoomsSinPartir(ESPANA.zoomMaximo), 15);
  });

  it("el corte cae siempre en un entero, como mucho uno por encima del de MapLibre", () => {
    for (const zoomMaximo of [16, 17.25, 18, 18.5, 19.9, 22]) {
      const corte = zoomMaximo - zoomsSinPartir(zoomMaximo);
      assert.isTrue(Number.isInteger(corte), `corte ${corte} con ${zoomMaximo}`);
      assert.isAtLeast(corte, zoomMaximo - ZOOMS_SIN_PARTIR_DE_MAPLIBRE);
      assert.isBelow(corte, zoomMaximo - ZOOMS_SIN_PARTIR_DE_MAPLIBRE + 1);
    }
  });
});
