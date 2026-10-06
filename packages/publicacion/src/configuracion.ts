import { NodeFileSystem, NodePath } from "@effect/platform-node";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import type { AlmacenDeCopias, AlmacenDeFicheros, AlmacenDelArchivo } from "./almacen.ts";
import { almacenEnCarpeta } from "./almacenes/carpeta.ts";
import { almacenEnR2, archivoEnR2, copiasEnR2 } from "./almacenes/r2.ts";
import { type SitioEnVercel, sitioEnVercel } from "./vercel.ts";

/**
 * Dónde se publica, según la configuración:
 *
 * - `CELDA_ALMACEN_CARPETA`: una carpeta del disco, para probar en local.
 * - `CELDA_R2_CUENTA`, `CELDA_R2_CUBO`, `CELDA_R2_ID_CLAVE` y `CELDA_R2_SECRETO`: el cubo privado
 *   de R2 de producción (ADR 0018). La ingesta lo usa con una clave que escribe, y el build de
 *   Vercel, con una de solo lectura.
 *
 * `CELDA_ALMACEN_ORIGEN` es la URL desde la que la web lee esos ficheros: en producción, las capas
 * de Vercel, `https://celda.elies.site/capas`. Sin ninguna de las dos opciones no se publica nada.
 */
const configR2 = Config.option(
  Config.all({
    cuenta: Config.String("CELDA_R2_CUENTA"),
    cubo: Config.String("CELDA_R2_CUBO"),
    idClave: Config.String("CELDA_R2_ID_CLAVE"),
    secreto: Config.Redacted("CELDA_R2_SECRETO"),
  }),
);

const configAlmacen = Config.all({
  carpeta: Config.option(Config.String("CELDA_ALMACEN_CARPETA")),
  origen: Config.String("CELDA_ALMACEN_ORIGEN").pipe(Config.withDefault("http://127.0.0.1:8852")),
  r2: configR2,
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
 * Las copias de la base de la ingesta fuera de la máquina, en el cubo de R2 de la configuración
 * (ADR 0018), o `None` si no hay cubo. Una carpeta de `CELDA_ALMACEN_CARPETA` no cuenta: las
 * copias locales ya van a `CELDA_INGESTA_COPIAS`.
 */
export const copiasDesdeConfig = Effect.map(
  configR2,
  (r2): Option.Option<Layer.Layer<AlmacenDeCopias>> =>
    Option.map(r2, (credenciales) =>
      copiasEnR2(credenciales).pipe(Layer.provide(FetchHttpClient.layer)),
    ),
);

/**
 * El archivo de páginas del registro fuera de la máquina, en el cubo de R2 de la configuración
 * (ADR 0027), o `None` si no hay cubo. Como las copias, una carpeta de `CELDA_ALMACEN_CARPETA` no
 * cuenta: los paquetes del archivo ya se guardan en la carpeta de copias.
 */
export const archivoDesdeConfig = Effect.map(
  configR2,
  (r2): Option.Option<Layer.Layer<AlmacenDelArchivo>> =>
    Option.map(r2, (credenciales) =>
      archivoEnR2(credenciales).pipe(Layer.provide(FetchHttpClient.layer)),
    ),
);

/**
 * La web en Vercel, según la configuración (ADR 0018):
 *
 * - `CELDA_VERCEL_DEPLOY_HOOK`: el deploy hook del proyecto de Vercel. Sin él, la noche no lanza
 *   ningún build.
 * - `CELDA_ALMACEN_ORIGEN`: la URL pública de las capas, `https://celda.elies.site/capas`, la
 *   misma que se apunta con cada versión. Sin ella no se sabe qué sirve Vercel, y cada
 *   publicación lanza el build.
 */
export const vercelDesdeConfig = Effect.map(
  Config.all({
    hook: Config.option(Config.Redacted("CELDA_VERCEL_DEPLOY_HOOK")),
    origen: Config.option(Config.String("CELDA_ALMACEN_ORIGEN")),
  }),
  ({ hook, origen }): Option.Option<Layer.Layer<SitioEnVercel>> =>
    Option.map(hook, (valor) =>
      sitioEnVercel({ hook: valor, origen }).pipe(Layer.provide(FetchHttpClient.layer)),
    ),
);
