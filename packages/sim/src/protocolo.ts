import * as Result from "effect/Result";
import type * as Schema from "effect/Schema";

import type { SimulacionRegistrada } from "./registro.ts";
import type { Malla, Resultado } from "./simulacion.ts";

/** Lo que el hilo principal pide al Worker: una simulación, con sus parámetros codificados. */
export interface Solicitud {
  /** Número de la solicitud, para casar la respuesta. */
  readonly numero: number;
  readonly simulacion: string;
  /** La versión que espera quien pide. Si el Worker tiene otra, no calcula. */
  readonly version: string;
  readonly params: Schema.Json;
  readonly malla: Malla;
}

/** Lo que contesta el Worker. */
export type Respuesta =
  | { readonly numero: number; readonly tipo: "resultado"; readonly resultado: Resultado }
  | { readonly numero: number; readonly tipo: "fallo"; readonly motivo: string };

/**
 * Calcula una solicitud con las simulaciones del registro. Es lo único que hace el Worker, y la
 * versión en el mismo hilo hace lo mismo, así que las dos contestan igual.
 */
export const atender = (
  registro: ReadonlyArray<SimulacionRegistrada>,
  solicitud: Solicitud,
): Respuesta => {
  const simulacion = registro.find((s) => s.id === solicitud.simulacion);
  if (simulacion === undefined) {
    return {
      numero: solicitud.numero,
      tipo: "fallo",
      motivo: `No hay ninguna simulación «${solicitud.simulacion}» en el registro`,
    };
  }
  if (simulacion.version !== solicitud.version) {
    return {
      numero: solicitud.numero,
      tipo: "fallo",
      motivo: `Se pidió la versión ${solicitud.version} de «${simulacion.id}» y el registro tiene la ${simulacion.version}`,
    };
  }
  return Result.match(simulacion.ejecutar(solicitud.params, solicitud.malla), {
    onFailure: (motivo): Respuesta => ({ numero: solicitud.numero, tipo: "fallo", motivo }),
    onSuccess: (resultado): Respuesta => ({
      numero: solicitud.numero,
      tipo: "resultado",
      resultado,
    }),
  });
};

/** Los búferes que se pueden pasar al otro hilo sin copiarlos. */
export const transferibles = (resultado: Resultado): ReadonlyArray<ArrayBufferLike> => [
  ...new Set(Object.values(resultado).map((array) => array.buffer)),
];
