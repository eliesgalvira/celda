import type { AlmacenDeFicheros } from "@celda/publicacion/almacen";
import { montarCapas } from "@celda/publicacion/vercel";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

/** La carpeta de las capas ya tiene algo: el build las monta en una carpeta vacía. */
export class CarpetaOcupada extends Schema.TaggedError<CarpetaOcupada>()("CarpetaOcupada", {
  carpeta: Schema.String,
}) {
  override get message() {
    return `${this.carpeta} no está vacía`;
  }
}

/**
 * La orden `capas <carpeta>`: monta en el almacén del contexto, que es la carpeta `carpeta`, la
 * versión vigente de lo publicado en `origen` y las dos anteriores (`montarCapas`). Es lo que hace
 * el build de Vercel para servir las capas en `/capas` (`apps/web/scripts/vercel.sh`, ADR 0018),
 * con `origen` el cubo privado de R2. La carpeta tiene que estar vacía o no existir. Si falta
 * algo, falla sin escribir `vigente.json`, y el build con ella.
 */
export const montarCapasEn = Effect.fn("Nocturna.montarCapas")(function* (
  origen: AlmacenDeFicheros["Service"],
  carpeta: string,
) {
  const fs = yield* FileSystem.FileSystem;
  if ((yield* fs.exists(carpeta)) && (yield* fs.readDirectory(carpeta)).length > 0) {
    return yield* new CarpetaOcupada({ carpeta });
  }
  const montadas = yield* montarCapas(origen);
  yield* Effect.logInfo(
    `Capas de ${montadas.version}` +
      (montadas.anteriores.length === 0 ? "" : ` y de ${montadas.anteriores.join(", ")}`) +
      `: ${montadas.ficheros} ficheros, ${(montadas.bytes / 1e6).toFixed(1)} MB en ${carpeta}`,
  );
  return montadas;
});
