import * as Schema from "effect/Schema";

/**
 * Firmas de la vista de interferencia (ticket 25), todavía sin simulación. Cuando exista cumplirá
 * `Simulacion<ParamsSinr, ResultadoSinr>` con estos tipos y se registrará en `registro.ts`.
 */

/** Una estación base en el plano de la malla, con sus sectores. */
export const EstacionSinr = Schema.Struct({
  /** Metros al este y al norte del origen de la malla. */
  este: Schema.Finite,
  norte: Schema.Finite,
  azimuts: Schema.Array(Schema.Finite),
  /** Potencia radiada por sector, en dBm. */
  potenciaDbm: Schema.Finite,
});
export type EstacionSinr = typeof EstacionSinr.Type;

/**
 * Las estaciones base de una compañía en una banda, con reutilización 1: todas se estorban. La
 * ocupación va de 0 a 1 y escala la potencia que llega de las que no dan servicio.
 */
export const ParamsSinr = Schema.Struct({
  estaciones: Schema.Array(EstacionSinr),
  frecuenciaMhz: Schema.Finite.check(Schema.isGreaterThan(0)),
  ocupacion: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  /** Ruido del receptor en todo el ancho de banda, en dBm. */
  ruidoDbm: Schema.Finite,
});
export type ParamsSinr = typeof ParamsSinr.Type;

export type ResultadoSinr = {
  /** Relación entre la señal útil y la interferencia más el ruido en cada punto, en dB. */
  readonly sinrDb: Float64Array;
  /** Índice en `estaciones` de la que da servicio a cada punto. */
  readonly estacion: Int32Array;
  /** Sector de esa estación que le da servicio. */
  readonly sector: Uint8Array;
};
