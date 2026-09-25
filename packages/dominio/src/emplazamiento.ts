import * as Schema from "effect/Schema";

import { Coordenada } from "./area.ts";
import { Banda } from "./banda.ts";
import { Compania } from "./compania.ts";
import { Fuente } from "./observacion.ts";

/** Cuánto fiarse de un emplazamiento. */
export const Estado = Schema.Literals(["verificado", "corregido", "nuevo"]);
export type Estado = typeof Estado.Type;

/**
 * Grado de acuerdo entre las observaciones de un emplazamiento: `baja` si hay conflictos,
 * `alta` si lo confirman dos fuentes o más y `media` si solo lo conoce una.
 */
export const Confianza = Schema.Literals(["alta", "media", "baja"]);
export type Confianza = typeof Confianza.Type;

/** Referencia a una observación desde lo que la fusión ha construido con ella. */
export const Procedencia = Schema.Struct({
  fuente: Fuente,
  clave: Schema.String,
});
export type Procedencia = typeof Procedencia.Type;

/**
 * Desacuerdo entre observaciones que la fusión no resuelve. El discriminante es `tipo` y no
 * `_tag` porque Convex reserva los campos que empiezan por `_`.
 */
export const Conflicto = Schema.Union([
  /** Una fuente de la comunidad da por desmontada una estación base que el registro mantiene. */
  Schema.Struct({
    tipo: Schema.tag("desmontada"),
    compania: Compania,
    procedencia: Procedencia,
    fecha: Schema.Finite,
  }),
  /** Fuentes distintas dan códigos distintos a la estación base: puede ser un duplicado. */
  Schema.Struct({
    tipo: Schema.tag("codigos-distintos"),
    compania: Compania,
    codigos: Schema.Array(Schema.String),
  }),
  /** El mismo código de una compañía aparece en dos sitios alejados. */
  Schema.Struct({
    tipo: Schema.tag("posicion-distinta"),
    compania: Compania,
    codigo: Schema.String,
    metros: Schema.Finite,
  }),
]);
export type Conflicto = typeof Conflicto.Type;

/** Equipos de una compañía en un emplazamiento, con las bandas de todas sus observaciones. */
export const EstacionBase = Schema.Struct({
  compania: Compania,
  codigos: Schema.Array(Schema.String),
  bandas: Schema.Array(Banda),
  observaciones: Schema.Array(Procedencia),
});
export type EstacionBase = typeof EstacionBase.Type;

/** Sitio físico con antenas, tal como sale de la fusión. */
export const Emplazamiento = Schema.Struct({
  /** Identificador estable: compañía y código de su estación base de menor clave. */
  clave: Schema.String,
  posicion: Coordenada,
  direccion: Schema.String,
  municipio: Schema.String,
  estado: Estado,
  confianza: Confianza,
  conflictos: Schema.Array(Conflicto),
  estaciones: Schema.Array(EstacionBase),
  fuentes: Schema.Array(Fuente),
  /** Fecha más reciente de sus observaciones, en milisegundos. */
  datosDel: Schema.Finite,
});
export type Emplazamiento = typeof Emplazamiento.Type;

const { estaciones: _estaciones, ...camposSinEstaciones } = Emplazamiento.fields;

/** El emplazamiento sin sus estaciones base, como se guarda aparte de ellas. */
export const EmplazamientoSinEstaciones = Schema.Struct(camposSinEstaciones);
export type EmplazamientoSinEstaciones = typeof EmplazamientoSinEstaciones.Type;
