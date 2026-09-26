import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { Aportacion } from "./aportacion.ts";

const decodificar = Schema.decodeUnknownEffect(Aportacion);

const PUNTO = {
  id: "5b0d3c1e-8f4a-4c2b-9d6e-1a2b3c4d5e6f",
  tipo: "punto-elegido",
  esquema: 1,
  creada: Date.UTC(2026, 8, 26, 10, 30),
  origen: "busqueda",
  posicion: { longitud: 2.113628, latitud: 41.388344 },
};

describe("Aportacion", () => {
  it.effect("lee un punto elegido con su identificador, fecha, versión y origen", () =>
    Effect.gen(function* () {
      const leida = yield* decodificar(PUNTO);
      assert.deepStrictEqual(leida, PUNTO);
    }),
  );

  it.effect("no da por buena una versión del esquema que no conoce", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decodificar({ ...PUNTO, esquema: 2 }));
      assert.match(error.message, /esquema/u);
    }),
  );

  it.effect("exige un UUID como identificador y un origen conocido", () =>
    Effect.gen(function* () {
      yield* Effect.flip(decodificar({ ...PUNTO, id: "punto-1" }));
      yield* Effect.flip(decodificar({ ...PUNTO, origen: "gps" }));
    }),
  );
});
