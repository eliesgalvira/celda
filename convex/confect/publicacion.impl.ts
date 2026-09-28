import { LimitesDeBarrios } from "@celda/dominio/barrio";
import { ConvexConfigProvider, FunctionImpl, GroupImpl } from "@confect/server";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import barrios from "../datos/barrios.json";
import { almacenEnCarpeta } from "../src/almacenes/carpeta";
import { almacenEnR2 } from "../src/almacenes/r2";
import { AlmacenDeFicheros, publicarYContar } from "../src/publicacion";
import databaseSchema from "./_generated/schema";
import publicacion, { type ResultadoPublicacion } from "./publicacion.spec";

/**
 * Dónde publica el despliegue, según sus variables de entorno:
 *
 * - `CELDA_ALMACEN_CARPETA`: una carpeta del disco, para el backend local. Solo tiene sentido con
 *   el backend en tu máquina.
 * - `CELDA_R2_CUENTA`, `CELDA_R2_CUBO`, `CELDA_R2_ID_CLAVE` y `CELDA_R2_SECRETO`: el cubo de R2
 *   de producción (ADR 0010).
 *
 * `CELDA_ALMACEN_ORIGEN` es la URL desde la que la web lee esos ficheros. Sin ninguna de las dos
 * opciones no se publica nada.
 */
const configAlmacen = Config.all({
  carpeta: Config.option(Config.String("CELDA_ALMACEN_CARPETA")),
  origen: Config.String("CELDA_ALMACEN_ORIGEN").pipe(Config.withDefault("http://127.0.0.1:8852")),
  r2: Config.option(
    Config.all({
      cuenta: Config.String("CELDA_R2_CUENTA"),
      cubo: Config.String("CELDA_R2_CUBO"),
      idClave: Config.String("CELDA_R2_ID_CLAVE"),
      secreto: Config.Redacted("CELDA_R2_SECRETO"),
    }),
  ),
});

const almacenDeLaConfig = Effect.map(
  configAlmacen,
  ({ carpeta, origen, r2 }): Option.Option<Layer.Layer<AlmacenDeFicheros>> => {
    const sinBarra = origen.replace(/\/$/u, "");
    if (Option.isSome(carpeta)) {
      return Option.some(
        almacenEnCarpeta({ carpeta: carpeta.value, origen: sinBarra }).pipe(
          Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
        ),
      );
    }
    return Option.map(r2, (credenciales) =>
      almacenEnR2({ ...credenciales, origen: sinBarra }).pipe(Layer.provide(FetchHttpClient.layer)),
    );
  },
);

/** Los límites de barrio de Open Data BCN, guardados en git junto a la publicación (ADR 0004). */
const limites = Schema.decodeUnknownEffect(LimitesDeBarrios)(barrios);

const publicar = FunctionImpl.make(databaseSchema, publicacion, "publicar", () =>
  Effect.gen(function* () {
    const almacen = yield* almacenDeLaConfig;
    if (Option.isNone(almacen)) {
      return { tipo: "sin-almacen" } satisfies ResultadoPublicacion;
    }
    return yield* publicarYContar(yield* limites).pipe(
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
