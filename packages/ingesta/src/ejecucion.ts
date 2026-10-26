import type { Fuente } from "@celda/dominio/observacion";
import * as Schema from "effect/Schema";

/** Cómo está el interruptor de un extractor. */
export interface Interruptor {
  readonly activo: boolean;
  readonly motivo: string;
}

/**
 * Los interruptores de las fuentes con extractor. La comunidad no tiene: llega del buzón de Convex
 * (ADR 0020), y sin la conexión con él la ingesta nocturna no la recoge.
 */
export type Interruptores = Readonly<Partial<Record<Fuente, Interruptor>>>;

/** Los interruptores mientras nadie los cambie. */
export const INTERRUPTOR_POR_DEFECTO = {
  "registro-oficial": { activo: true, motivo: "" },
} satisfies Interruptores;

/** Lo que apunta una ejecución omitida por su interruptor. */
export const erroresDeOmitida = (interruptor: Interruptor): ReadonlyArray<string> => [
  `Interruptor apagado: ${interruptor.motivo}`,
];

/**
 * Cómo queda una ejecución de ingesta: omitida con el interruptor apagado, fallida si no se pudo
 * leer el listado, o interrumpida si se cortó y otra la sustituyó.
 */
export const EstadoEjecucion = Schema.Literals([
  "en curso",
  "completada",
  "fallida",
  "omitida",
  "interrumpida",
]);
export type EstadoEjecucion = typeof EstadoEjecucion.Type;

export const Cuentas = Schema.Struct({
  creados: Schema.Int,
  cambiados: Schema.Int,
  retirados: Schema.Int,
});
export type Cuentas = typeof Cuentas.Type;

/** Lo que ha escrito una ejecución. Todo a cero si no ha cambiado nada. */
export const Cambios = Schema.Struct({
  observaciones: Cuentas,
  fichas: Schema.Struct({ leidas: Schema.Int, cambiadas: Schema.Int }),
  emplazamientos: Cuentas,
});
export type Cambios = typeof Cambios.Type;

export const SIN_CAMBIOS: Cambios = {
  observaciones: { creados: 0, cambiados: 0, retirados: 0 },
  fichas: { leidas: 0, cambiadas: 0 },
  emplazamientos: { creados: 0, cambiados: 0, retirados: 0 },
};
