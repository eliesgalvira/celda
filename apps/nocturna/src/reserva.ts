import { AlmacenNoDisponible } from "@celda/publicacion/almacen";
import { copiarVigente, type LeerPublicado, leerPorHttp } from "@celda/publicacion/reserva";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/** La carpeta de la copia ya tiene algo: la copia solo lleva la versión vigente. */
export class CarpetaOcupada extends Schema.TaggedError<CarpetaOcupada>()("CarpetaOcupada", {
  carpeta: Schema.String,
}) {
  override get message() {
    return `${this.carpeta} no está vacía`;
  }
}

/** Lo publicado en una carpeta del disco, como `tools/capas/salida`. */
const leerDeCarpeta = (carpeta: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const leer: LeerPublicado = (fichero) =>
      Effect.gen(function* () {
        const ruta = path.join(carpeta, fichero);
        if (!(yield* fs.exists(ruta))) return Option.none<string>();
        return Option.some(yield* fs.readFileString(ruta));
      }).pipe(
        Effect.catchTag("PlatformError", (error) =>
          Effect.fail(new AlmacenNoDisponible({ motivo: error.message })),
        ),
      );
    return leer;
  });

/**
 * La orden `reserva <origen> <carpeta>`: copia al almacén del contexto, que es la carpeta
 * `carpeta`, la versión vigente de lo publicado en `origen`, la URL pública de R2 o una carpeta
 * del disco. Es lo que hace el build de Vercel para montar la copia de reserva en `/capas`
 * (`apps/web/scripts/vercel.sh`). La carpeta tiene que estar vacía o no existir: la copia solo
 * lleva la versión vigente. Si falta algo, falla sin escribir `vigente.json`, y el build con ella.
 */
export const copiarReserva = Effect.fn("Nocturna.copiarReserva")(function* (
  origen: string,
  carpeta: string,
) {
  const fs = yield* FileSystem.FileSystem;
  if ((yield* fs.exists(carpeta)) && (yield* fs.readDirectory(carpeta)).length > 0) {
    return yield* new CarpetaOcupada({ carpeta });
  }
  const leer = /^https?:\/\//u.test(origen)
    ? yield* leerPorHttp(origen)
    : yield* leerDeCarpeta(origen);
  const hecha = yield* copiarVigente(leer);
  yield* Effect.logInfo(
    `Copia de reserva de ${hecha.version}: ${hecha.ficheros} ficheros, ` +
      `${(hecha.bytes / 1e6).toFixed(1)} MB en ${carpeta}`,
  );
  return hecha;
});
