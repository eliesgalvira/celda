import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { BARCELONA, Coordenada, contiene, rumboGrados } from "./area.ts";

const decodificar = Schema.decodeUnknownEffect(Coordenada);

describe("Coordenada", () => {
  it.effect("acepta un punto de Barcelona", () =>
    Effect.gen(function* () {
      const plazaCatalunya = yield* decodificar({ longitud: 2.17, latitud: 41.387 });
      assert.isTrue(contiene(BARCELONA.encuadre, plazaCatalunya));
    }),
  );

  it.effect("rechaza una latitud imposible", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decodificar({ longitud: 2.17, latitud: 141.387 }));
      assert.match(error.message, /latitud/u);
    }),
  );
});

describe("BARCELONA", () => {
  it("abre el mapa dentro de los límites por los que se puede mover", () => {
    assert.isTrue(contiene(BARCELONA.limites, BARCELONA.encuadre.suroeste));
    assert.isTrue(contiene(BARCELONA.limites, BARCELONA.encuadre.noreste));
    assert.isBelow(BARCELONA.zoomMinimo, BARCELONA.zoomMaximo);
  });
});

describe("rumboGrados", () => {
  const CENTRO = { longitud: 2.17, latitud: 41.387 };

  it("da 0° hacia el norte, 90° al este, 180° al sur y 270° al oeste", () => {
    const cerca = 0.001;
    const casos = [
      [{ ...CENTRO, latitud: CENTRO.latitud + cerca }, 0],
      [{ ...CENTRO, longitud: CENTRO.longitud + cerca }, 90],
      [{ ...CENTRO, latitud: CENTRO.latitud - cerca }, 180],
      [{ ...CENTRO, longitud: CENTRO.longitud - cerca }, 270],
    ] as const;
    for (const [hasta, esperado] of casos) {
      assert.closeTo(rumboGrados(CENTRO, hasta), esperado, 0.01);
    }
  });

  it("a estas distancias, el de vuelta es el opuesto del de ida", () => {
    const campusNord = { longitud: 2.113628, latitud: 41.388344 };
    const ida = rumboGrados(CENTRO, campusNord);
    assert.closeTo((ida + 180) % 360, rumboGrados(campusNord, CENTRO), 0.1);
    // Campus Nord queda al oeste de la plaza de Catalunya, un poco al norte.
    assert.closeTo(ida, 272, 2);
  });
});
