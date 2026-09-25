import * as Schema from "effect/Schema";

import { Coordenada } from "./area.ts";
import { Banda } from "./banda.ts";
import { Compania } from "./compania.ts";

/** Origen externo de datos sobre emplazamientos. */
export const Fuente = Schema.Literals(["registro-oficial", "antenasmoviles", "opencellid"]);
export type Fuente = typeof Fuente.Type;

/**
 * Qué dice la observación de la estación base: que está, o que la comunidad la ha visto
 * desmontada. Una observación `desmontada` es una corrección.
 */
export const Afirmacion = Schema.Literals(["presente", "desmontada"]);
export type Afirmacion = typeof Afirmacion.Type;

/** Lo que una fuente dice de la estación base de una compañía, en una fecha y con su enlace. */
export const Observacion = Schema.Struct({
  fuente: Fuente,
  /** Identificador en la fuente. En el registro oficial es «RAZÓN SOCIAL - código». */
  clave: Schema.String,
  compania: Compania,
  /** Código de emplazamiento que usa la compañía, tal como lo publica la fuente. */
  codigo: Schema.String,
  posicion: Coordenada,
  direccion: Schema.String,
  municipio: Schema.String,
  bandas: Schema.Array(Banda),
  url: Schema.String,
  /** Desde cuándo dice la fuente esto, en milisegundos. Es la fecha de extracción, no la suya. */
  fecha: Schema.Finite,
  afirma: Afirmacion,
});
export type Observacion = typeof Observacion.Type;

/**
 * Código sin los ceros a la izquierda cuando es solo numérico. Vodafone publica el mismo
 * emplazamiento como `647`, `00647` y `000647`.
 */
export const normalizarCodigo = (codigo: string): string => {
  const limpio = codigo.trim().toUpperCase();
  return /^\d+$/u.test(limpio) ? limpio.replace(/^0+(?=\d)/u, "") : limpio;
};
