import * as Schema from "effect/Schema";

import { Coordenada } from "./area.ts";
import { Banda, compararBandas, compararTexto } from "./banda.ts";
import { Compania } from "./compania.ts";
import {
  Confianza,
  Conflicto,
  type EmplazamientoSinEstaciones,
  Estado,
  type EstacionBase,
} from "./emplazamiento.ts";
import { Lugar } from "./municipio.ts";
import { Afirmacion, Fuente, type Observacion } from "./observacion.ts";

/** De dónde sale un dato de la ficha: la observación de una fuente, con su fecha y su enlace. */
export const OrigenDeFicha = Schema.Struct({
  fuente: Fuente,
  /** Identificador en la fuente, como «TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532». */
  clave: Schema.String,
  /** Enlace a lo que publica la fuente sobre esta estación base. */
  url: Schema.String,
  /** Desde cuándo lo dice la fuente, en milisegundos. */
  fecha: Schema.Finite,
  afirma: Afirmacion,
});
export type OrigenDeFicha = typeof OrigenDeFicha.Type;

/** Una estación base tal como la cuenta la ficha: sus bandas y las observaciones de las que sale. */
export const EstacionDeFicha = Schema.Struct({
  compania: Compania,
  codigos: Schema.Array(Schema.String),
  bandas: Schema.Array(Banda),
  origenes: Schema.Array(OrigenDeFicha),
});
export type EstacionDeFicha = typeof EstacionDeFicha.Type;

/**
 * Lo que el panel cuenta de un emplazamiento al seleccionarlo. Se publica con la capa, en un lote
 * de fichas de la misma versión. `version` es su marca de agua: nunca es posterior a la capa de
 * la que sale, pero la web puede acabar leyendo la de una capa más reciente que la del mapa.
 */
export const Ficha = Schema.Struct({
  clave: Schema.String,
  posicion: Coordenada,
  /** Dirección tal como la publica la fuente, con el municipio y la provincia al final. */
  direccion: Schema.String,
  /** El municipio tal como lo escribe la fuente en la dirección, en mayúsculas. */
  municipio: Schema.String,
  /**
   * El municipio y la provincia del IGN en que cae, que pone el publicador por punto en polígono
   * (ADR 0017). Las fichas publicadas antes no lo llevan.
   */
  lugar: Schema.optionalKey(Lugar),
  estado: Estado,
  confianza: Confianza,
  conflictos: Schema.Array(Conflicto),
  estaciones: Schema.Array(EstacionDeFicha),
  /** Fecha más reciente de sus observaciones. */
  datosDel: Schema.Finite,
  /** Fecha de la ejecución de ingesta que cambió el emplazamiento por última vez. */
  version: Schema.Finite,
});
export type Ficha = typeof Ficha.Type;

/** Una estación base del emplazamiento con las observaciones de las que sale, ya leídas. */
export interface EstacionConOrigenes {
  readonly estacion: EstacionBase;
  /** Las observaciones de `estacion.observaciones` que se han encontrado, en su orden. */
  readonly observaciones: ReadonlyArray<
    Pick<Observacion, "fuente" | "clave" | "url" | "fecha" | "afirma">
  >;
}

/**
 * La ficha de un emplazamiento con `version`, la fecha en que cambió por última vez. Las
 * estaciones van por compañía y sus bandas por frecuencia, así que las mismas estaciones dan
 * siempre la misma ficha, sea cual sea el orden en que lleguen.
 */
export const fichaDe = (
  emplazamiento: EmplazamientoSinEstaciones,
  version: number,
  estaciones: ReadonlyArray<EstacionConOrigenes>,
): Ficha => ({
  clave: emplazamiento.clave,
  posicion: emplazamiento.posicion,
  direccion: emplazamiento.direccion,
  municipio: emplazamiento.municipio,
  estado: emplazamiento.estado,
  confianza: emplazamiento.confianza,
  conflictos: emplazamiento.conflictos,
  estaciones: estaciones
    .toSorted((a, b) => compararTexto(a.estacion.compania, b.estacion.compania))
    .map(({ estacion, observaciones }) => ({
      compania: estacion.compania,
      codigos: estacion.codigos,
      bandas: estacion.bandas.toSorted(compararBandas),
      origenes: observaciones.map(({ fuente, clave, url, fecha, afirma }) => ({
        fuente,
        clave,
        url,
        fecha,
        afirma,
      })),
    })),
  datosDel: emplazamiento.datosDel,
  version,
});
