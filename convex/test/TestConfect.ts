// El doble de `@confect/test`: repite su interfaz, con `finishInProgressScheduledFunctions` como
// la escribe la librería, y cada `run` es un punto de entrada que monta sus capas y no tipa sus
// errores, como el original.
// @effect-diagnostics lazyEffect:off
// @effect-diagnostics strictEffectProvide:off
// @effect-diagnostics anyUnknownInErrorContext:off
import { Ref } from "@confect/core";
import { RegisteredConvexFunction } from "@confect/server";
import { TestConfect as TestConfect_ } from "@confect/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest, type TestConvexForDataModel } from "convex-test";
import type {
  DataModelFromSchemaDefinition,
  DefaultFunctionArgs,
  FunctionReference,
  FunctionType,
} from "convex/server";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import convexSchema from "../confect/_generated/convexSchema";
import confectSchema from "../confect/_generated/schema";

type Esquema = typeof confectSchema;

/** Los módulos del despliegue. El glob de la documentación de Confect no encuentra `convex/_generated` con Vite 8; este sí (exploración 02). */
const MODULOS = import.meta.glob([
  "../convex/**/*.ts",
  "../convex/**/*.js",
  "!../convex/**/*.d.ts",
]);

/**
 * Convex en memoria (convex-test) con las funciones generadas y el componente de límites. Es la
 * interfaz de `@confect/test` sin identidad de usuario (Celda no tiene cuentas), más `desde`, que
 * fija la IP de la petición como haría `ctx.meta.getRequestMetadata()`, y `crudo`, el convex-test
 * de debajo, para llamar a una función con argumentos que Confect no dejaría codificar.
 *
 * `@confect/test` no deja registrar componentes ni fijar la IP, así que este doble repite su
 * envoltorio (`Ref.runWithCodec` y `mutationLayer`) sobre un convex-test que sí lo hace.
 */
export interface ConvexDePrueba extends TestConfect_.TestConfectWithoutIdentity<Esquema> {
  readonly desde: (ip: string) => ConvexDePrueba;
  readonly crudo: Crudo;
}

export class TestConfect extends Context.Service<TestConfect, ConvexDePrueba>()(
  "@celda/convex/test/TestConfect",
) {}

/** El convex-test de debajo, con el modelo de datos del despliegue. */
type Crudo = TestConvexForDataModel<DataModelFromSchemaDefinition<typeof convexSchema>>;

/** Las funciones de Convex, públicas o internas, de un tipo. */
type Funcion<Tipo extends FunctionType> = FunctionReference<Tipo, "public" | "internal">;

const envolver = (crudo: Crudo): ConvexDePrueba => {
  const run: ConvexDePrueba["run"] = (
    handler: Effect.Effect<unknown, unknown, RegisteredConvexFunction.MutationServices<Esquema>>,
  ) =>
    Effect.promise(() =>
      crudo.run((ctx) =>
        Effect.runPromise(
          handler.pipe(
            Effect.provide(RegisteredConvexFunction.mutationLayer(confectSchema, ctx)),
            Effect.asVoid,
          ),
        ),
      ),
    );

  return {
    query: (ref, ...args) =>
      Ref.runWithCodec(
        ref,
        // SAFETY: sin argumentos, una función de Confect recibe un objeto vacío.
        (args[0] ?? {}) as Ref.Args<typeof ref>,
        (funcion: Funcion<"query">, codificados) =>
          // SAFETY: `Ref.runWithCodec` ha codificado los argumentos con el esquema de la función:
          // son un objeto de valores de Convex.
          crudo.query(funcion, codificados as DefaultFunctionArgs),
      ),
    mutation: (ref, ...args) =>
      Ref.runWithCodec(
        ref,
        // SAFETY: sin argumentos, una función de Confect recibe un objeto vacío.
        (args[0] ?? {}) as Ref.Args<typeof ref>,
        (funcion: Funcion<"mutation">, codificados) =>
          // SAFETY: `Ref.runWithCodec` ha codificado los argumentos con el esquema de la función:
          // son un objeto de valores de Convex.
          crudo.mutation(funcion, codificados as DefaultFunctionArgs),
      ),
    action: (ref, ...args) =>
      Ref.runWithCodec(
        ref,
        // SAFETY: sin argumentos, una función de Confect recibe un objeto vacío.
        (args[0] ?? {}) as Ref.Args<typeof ref>,
        (funcion: Funcion<"action">, codificados) =>
          // SAFETY: `Ref.runWithCodec` ha codificado los argumentos con el esquema de la función:
          // son un objeto de valores de Convex.
          crudo.action(funcion, codificados as DefaultFunctionArgs),
      ),
    run,
    fetch: (camino, init) => Effect.promise(() => crudo.fetch(camino, init)),
    finishInProgressScheduledFunctions: () =>
      Effect.promise(() => crudo.finishInProgressScheduledFunctions()),
    finishAllScheduledFunctions: (avanzar) =>
      Effect.promise(() => crudo.finishAllScheduledFunctions(avanzar)),
    desde: (ip) => envolver(crudo.withRequestMetadata({ ip })),
    crudo,
  };
};

/** Un Convex en memoria nuevo para cada prueba. */
export const layer = Layer.sync(TestConfect, () => {
  const crudo = convexTest(convexSchema, MODULOS);
  rateLimiterTest.register(crudo);
  return envolver(crudo);
});
