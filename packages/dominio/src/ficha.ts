import * as Schema from "effect/Schema";

import { Coordenada } from "./area.ts";
import { Banda } from "./banda.ts";
import { Compania } from "./compania.ts";
import { Confianza, Conflicto, Estado } from "./emplazamiento.ts";
import { Afirmacion, Fuente } from "./observacion.ts";

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
  municipio: Schema.String,
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
