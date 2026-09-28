import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { CapaIlegible, ficheroDeLote, VersionDistinta, versionDeCabecera } from "./capa.ts";
import { Ficha } from "./ficha.ts";

/**
 * Un lote de fichas publicado: las de unos cuantos emplazamientos vecinos, de la misma versión
 * que la capa. La versión va la primera, como en la capa, para comprobarla antes de leer nada.
 */
export const LoteDeFichas = Schema.Struct({
  version: Schema.String,
  lote: Schema.Int,
  fichas: Schema.Array(Ficha),
});
export type LoteDeFichas = typeof LoteDeFichas.Type;

const LoteEnJson = Schema.fromJsonString(LoteDeFichas);
const codificarLote = Schema.encodeSync(LoteEnJson);
const decodificarLote = Schema.decodeUnknownResult(LoteEnJson);

export interface LoteGenerado {
  readonly fichero: string;
  readonly contenido: string;
}

/**
 * El fichero del lote `lote` de la versión `version`, con sus fichas ordenadas por clave. Es una
 * función pura: las mismas fichas dan siempre los mismos bytes.
 */
export const generarLote = (
  version: string,
  lote: number,
  fichas: ReadonlyArray<Ficha>,
): LoteGenerado => ({
  fichero: ficheroDeLote(version, lote),
  contenido: codificarLote({
    version,
    lote,
    fichas: fichas.slice().sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0)),
  }),
});

/**
 * Lee un lote de fichas y comprueba, antes de analizar el resto, que es de la versión `esperada`.
 * Un fichero de otra versión no se da por bueno: sus fichas no casarían con el mapa.
 */
export const leerLote = (
  contenido: string,
  esperada: string,
  lote: number,
): Result.Result<LoteDeFichas, CapaIlegible | VersionDistinta> => {
  const cabecera = versionDeCabecera(contenido.slice(0, 64));
  if (Option.isNone(cabecera)) {
    return Result.fail(new CapaIlegible({ motivo: "el lote no empieza por la versión" }));
  }
  if (cabecera.value !== esperada) {
    return Result.fail(new VersionDistinta({ esperada, encontrada: cabecera.value }));
  }
  return decodificarLote(contenido).pipe(
    Result.mapError((error) => new CapaIlegible({ motivo: error.message })),
    Result.flatMap((leido) =>
      leido.lote === lote
        ? Result.succeed(leido)
        : Result.fail(
            new CapaIlegible({ motivo: `se esperaba el lote ${lote} y es el ${leido.lote}` }),
          ),
    ),
  );
};
