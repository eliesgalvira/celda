import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { CapaIlegible, ficheroDeLote, VersionDistinta, versionDeCabecera } from "./capa.ts";
import { Ficha } from "./ficha.ts";
import { FuenteDeMunicipios, type IndiceDeMunicipios, lugarDelPunto } from "./municipio.ts";

/**
 * Un lote de fichas publicado: las de unos cuantos emplazamientos vecinos, de la misma versión
 * que la capa. La versión va la primera, como en la capa, para comprobarla antes de leer nada.
 */
export const LoteDeFichas = Schema.Struct({
  version: Schema.String,
  lote: Schema.Int,
  /**
   * De dónde salen el municipio y la provincia de las fichas (`Ficha.lugar`). Va una vez por
   * lote y no en cada ficha, porque es la misma para todas.
   */
  fuenteDeLugares: Schema.optionalKey(FuenteDeMunicipios),
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
 * El fichero del lote `lote` de la versión `version`, con sus fichas ordenadas por clave. Con
 * `municipios`, cada ficha lleva el municipio y la provincia en que cae su emplazamiento, y el
 * lote, la fuente de los límites. Es una función pura: las mismas fichas con los mismos límites
 * dan siempre los mismos bytes.
 */
export const generarLote = (
  version: string,
  lote: number,
  fichas: ReadonlyArray<Ficha>,
  municipios?: IndiceDeMunicipios,
): LoteGenerado => {
  const ordenadas = fichas
    .slice()
    .sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));
  return {
    fichero: ficheroDeLote(version, lote),
    contenido: codificarLote(
      municipios === undefined
        ? { version, lote, fichas: ordenadas }
        : {
            version,
            lote,
            fuenteDeLugares: municipios.fuente,
            fichas: ordenadas.map((ficha) => ({
              ...ficha,
              lugar: lugarDelPunto(ficha.posicion, municipios),
            })),
          },
    ),
  };
};

/** Copia en el lugar de cada ficha la fuente que el lote lleva una sola vez. */
const conFuenteDeLugares = (leido: LoteDeFichas): LoteDeFichas => {
  const fuente = leido.fuenteDeLugares;
  if (fuente === undefined) return leido;
  return {
    ...leido,
    fichas: leido.fichas.map((ficha) =>
      ficha.lugar === undefined ? ficha : { ...ficha, lugar: { ...ficha.lugar, fuente } },
    ),
  };
};

/**
 * Lee un lote de fichas y comprueba, antes de analizar el resto, que es de la versión `esperada`.
 * Un fichero de otra versión no se da por bueno: sus fichas no casarían con el mapa. La fuente
 * de los lugares queda copiada en cada ficha, para que el panel la cite sin mirar el lote.
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
        ? Result.succeed(conFuenteDeLugares(leido))
        : Result.fail(
            new CapaIlegible({ motivo: `se esperaba el lote ${lote} y es el ${leido.lote}` }),
          ),
    ),
  );
};
