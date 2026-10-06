import * as Schema from "effect/Schema";

import { Coordenada } from "./area.ts";
import { Banda } from "./banda.ts";
import { Compania } from "./compania.ts";
import { MedidaDeExposicion } from "./exposicion.ts";

/**
 * Origen de las observaciones sobre emplazamientos: el registro oficial, la comunidad de Celda con
 * sus correcciones aceptadas (ADR 0019 y 0020) y OpenCelliD, que aún no se ha decidido (#21).
 */
export const Fuente = Schema.Literals(["registro-oficial", "comunidad", "opencellid"]);
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
  /**
   * Si el registro oficial no tiene ficha de la estación base, aunque su listado la incluya, la
   * fecha en que se comprobó por última vez: su página de detalle dice «Código de emplazamiento
   * no válido». Una lectura buena de la ficha la quita.
   */
  sinFichaEnRegistro: Schema.optionalKey(Schema.Finite),
  /**
   * Las medidas de exposición del ministerio que publica la ficha del registro oficial, quizá
   * ninguna. Su fecha es `fecha`, como la de las bandas. Falta si la ficha no se ha leído desde que
   * Celda las guarda, y en las demás fuentes.
   */
  medidasDeExposicion: Schema.optionalKey(Schema.Array(MedidaDeExposicion)),
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
