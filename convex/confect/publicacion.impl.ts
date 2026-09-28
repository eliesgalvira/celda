import { limitesDeBarcelona } from "@celda/publicacion/barrios";
import { almacenDesdeConfig } from "@celda/publicacion/configuracion";
import type { ResultadoPublicacion } from "@celda/publicacion/publicar";
import { ConvexConfigProvider, FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { publicarYContar } from "../src/publicacion";
import databaseSchema from "./_generated/schema";
import publicacion from "./publicacion.spec";

/**
 * Publica donde digan las variables de entorno del despliegue (`almacenDesdeConfig`):
 * `CELDA_ALMACEN_CARPETA` para el backend local, o las de R2 para producción. Sin ninguna no se
 * publica nada.
 */
const publicar = FunctionImpl.make(databaseSchema, publicacion, "publicar", () =>
  Effect.gen(function* () {
    const almacen = yield* almacenDesdeConfig;
    if (Option.isNone(almacen)) {
      return { tipo: "sin-almacen" } satisfies ResultadoPublicacion;
    }
    return yield* publicarYContar(yield* limitesDeBarcelona).pipe(
      // La acción es el punto de entrada de la publicación: aquí se monta su almacén, una vez.
      // @effect-diagnostics-next-line strictEffectProvide:off
      Effect.provide(almacen.value),
    );
  }).pipe(
    // @effect-diagnostics-next-line strictEffectProvide:off
    Effect.provide(ConvexConfigProvider.layer),
    Effect.orDie,
  ),
);

export default GroupImpl.make(databaseSchema, publicacion).pipe(
  Layer.provide(publicar),
  GroupImpl.finalize,
);
