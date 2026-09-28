import type { Fuente } from "@celda/dominio/observacion";
import * as Schema from "effect/Schema";

/** Cómo está el interruptor de un extractor. */
export interface Interruptor {
  readonly activo: boolean;
  readonly motivo: string;
}

/**
 * Interruptor de cada fuente mientras nadie lo cambie. antenasmoviles.es empieza apagado: antes
 * de publicar sus datos hay que escribir a su administrador (investigación de fuentes
 * comunitarias).
 */
export const INTERRUPTOR_POR_DEFECTO: Readonly<Record<Fuente, Interruptor>> = {
  "registro-oficial": { activo: true, motivo: "" },
  antenasmoviles: {
    activo: false,
    motivo: "apagado por defecto hasta escribir a su administrador antes de publicar sus datos",
  },
  opencellid: { activo: false, motivo: "apagado por defecto: aún no tiene extractor" },
};

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

const Cuentas = Schema.Struct({
  creados: Schema.Int,
  cambiados: Schema.Int,
  retirados: Schema.Int,
});
export type Cuentas = typeof Cuentas.Type;

/**
 * Lo que ha escrito una ejecución. Todo a cero si no ha cambiado nada. En las fuentes que listan
 * puntos, `fichas` cuenta los detalles leídos y `puntos`, los puntos del listado.
 */
export const Cambios = Schema.Struct({
  observaciones: Cuentas,
  fichas: Schema.Struct({ leidas: Schema.Int, cambiadas: Schema.Int }),
  emplazamientos: Cuentas,
  puntos: Schema.optionalKey(Cuentas),
});
export type Cambios = typeof Cambios.Type;

export const SIN_CAMBIOS: Cambios = {
  observaciones: { creados: 0, cambiados: 0, retirados: 0 },
  fichas: { leidas: 0, cambiadas: 0 },
  emplazamientos: { creados: 0, cambiados: 0, retirados: 0 },
};
