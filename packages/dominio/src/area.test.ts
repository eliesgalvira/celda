import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { BARCELONA, Coordenada, contiene } from "./area.ts";

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
