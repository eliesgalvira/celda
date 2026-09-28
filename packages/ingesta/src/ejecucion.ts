import * as Schema from "effect/Schema";

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
