import { NodeFileSystem, NodePath } from "@effect/platform-node";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import type { AlmacenDeFicheros } from "./almacen.ts";
import { almacenEnCarpeta } from "./almacenes/carpeta.ts";
import { almacenEnR2 } from "./almacenes/r2.ts";
import { type CopiaDeReserva, copiaEnVercel } from "./reserva.ts";

/**
 * Dónde se publica, según la configuración:
 *
 * - `CELDA_ALMACEN_CARPETA`: una carpeta del disco, para probar en local.
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

/** El almacén de la configuración, o `None` si no hay ninguno. La carpeta gana a R2. */
export const almacenDesdeConfig = Effect.map(
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

/**
 * La copia de reserva de Vercel, según la configuración (ADR 0010):
 *
 * - `CELDA_VERCEL_DEPLOY_HOOK`: el deploy hook del proyecto de Vercel. Sin él, la copia no se toca.
 * - `CELDA_RESERVA_ORIGEN`: la URL pública de la copia, `https://celda.elies.site/capas`. Sin
 *   ella no se sabe qué sirve la copia, y cada publicación pide un despliegue.
 */
export const reservaDesdeConfig = Effect.map(
  Config.all({
    hook: Config.option(Config.Redacted("CELDA_VERCEL_DEPLOY_HOOK")),
    origen: Config.option(Config.String("CELDA_RESERVA_ORIGEN")),
  }),
  ({ hook, origen }): Option.Option<Layer.Layer<CopiaDeReserva>> =>
    Option.map(hook, (valor) =>
      copiaEnVercel({ hook: valor, origen }).pipe(Layer.provide(FetchHttpClient.layer)),
    ),
);
