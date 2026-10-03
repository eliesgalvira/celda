// La prueba es su propio punto de entrada y monta sus capas.
// @effect-diagnostics strictEffectProvide:off
import { DatabaseSchema } from "@confect/server";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import convexSchema from "../confect/_generated/convexSchema";
import confectSchema from "../confect/_generated/schema";
import * as TestConfect from "./TestConfect";

/** Los módulos del despliegue que no genera Convex: el esquema y las funciones. */
const modulos = Object.keys(
  import.meta.glob(["../convex/**/*.ts", "!../convex/_generated/**", "!../convex/**/*.d.ts"]),
);

/**
 * Desde el #51 la ingesta y la publicación corren fuera de Convex (ADR 0015), y el buzón de las
 * aportaciones aún no está (#56, ADR 0020). Hasta entonces el despliegue no tiene tablas, ni
 * funciones, ni crons, y el Convex en memoria de las pruebas arranca igual.
 */
describe("despliegue de Convex (en memoria)", () => {
  it.effect("arranca sin tablas, sin funciones y sin crons", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      yield* convex.run(Effect.void);

      assert.deepStrictEqual(Object.keys(DatabaseSchema.tables(confectSchema)), []);
      assert.deepStrictEqual(Object.keys(convexSchema.tables), []);
      assert.deepStrictEqual(modulos, ["../convex/schema.ts"]);
    }).pipe(Effect.provide(TestConfect.layer)),
  );
});
