import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { diagramaSector } from "./diagramaSector.ts";
import { perdidasUrbanas } from "./perdidasUrbanas.ts";
import type { Malla, Resultado, Simulacion } from "./simulacion.ts";

/**
 * Una simulación tal como la ve el Worker: sin sus tipos, con los parámetros en su formato de
 * intercambio. `ejecutar` los decodifica con el esquema de la simulación antes de calcular.
 */
export interface SimulacionRegistrada {
  readonly id: string;
  readonly version: string;
  readonly ejecutar: (params: Schema.Json, malla: Malla) => Result.Result<Resultado, string>;
}

/** Prepara una simulación para el registro. */
export const registrar = <P, R extends Resultado>(
  simulacion: Simulacion<P, R>,
): SimulacionRegistrada => {
  const decodificar = Schema.decodeUnknownResult(simulacion.params);
  return {
    id: simulacion.id,
    version: simulacion.version,
    ejecutar: (params, malla) =>
      Result.match(decodificar(params), {
        onFailure: (fallo) => Result.fail(`Parámetros no válidos: ${fallo.message}`),
        onSuccess: (p): Result.Result<Resultado, string> =>
          Result.succeed(simulacion.ejecutar(p, malla)),
      }),
  };
};

/**
 * Las simulaciones que sabe ejecutar el Worker. Una simulación nueva se añade aquí y en ningún
 * otro sitio de la aplicación (docs/patterns/simulaciones.md).
 */
export const SIMULACIONES: ReadonlyArray<SimulacionRegistrada> = [
  registrar(diagramaSector),
  registrar(perdidasUrbanas),
];
