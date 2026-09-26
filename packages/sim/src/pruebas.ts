import { atender, type Respuesta, type Solicitud } from "./protocolo.ts";
import { SIMULACIONES, type SimulacionRegistrada } from "./registro.ts";
import type { PuertoWorker } from "./simulador.ts";

/** Un Worker de prueba: guarda las solicitudes y no contesta hasta que la prueba se lo pide. */
export interface WorkerDePrueba {
  /** Para `simuladorEnWorker`. */
  readonly crear: () => PuertoWorker;
  /** Cuántos Workers se han creado y cuántos se han terminado. */
  readonly creados: () => number;
  readonly terminados: () => number;
  /** Las solicitudes que esperan respuesta en el Worker vivo. */
  readonly pendientes: () => ReadonlyArray<Solicitud>;
  /** Calcula la solicitud más antigua con el registro y contesta con su respuesta. */
  readonly contestar: () => void;
  /** El Worker vivo falla, como si su código hubiera lanzado un error. */
  readonly fallar: (motivo: string) => void;
}

export const workerDePrueba = (
  registro: ReadonlyArray<SimulacionRegistrada> = SIMULACIONES,
): WorkerDePrueba => {
  let creados = 0;
  let terminados = 0;
  let vivo:
    | {
        readonly cola: Array<Solicitud>;
        alResponder: (respuesta: Respuesta) => void;
        alFallar: (motivo: string) => void;
      }
    | undefined;

  return {
    crear: () => {
      creados += 1;
      const worker = {
        cola: new Array<Solicitud>(),
        alResponder: (_respuesta: Respuesta): void => undefined,
        alFallar: (_motivo: string): void => undefined,
      };
      vivo = worker;
      return {
        enviar: (solicitud) => {
          worker.cola.push(solicitud);
        },
        escuchar: (alResponder, alFallar) => {
          worker.alResponder = alResponder;
          worker.alFallar = alFallar;
        },
        terminar: () => {
          terminados += 1;
          if (vivo === worker) {
            vivo = undefined;
          }
        },
      };
    },
    creados: () => creados,
    terminados: () => terminados,
    pendientes: () => vivo?.cola ?? [],
    contestar: () => {
      const solicitud = vivo?.cola.shift();
      if (vivo !== undefined && solicitud !== undefined) {
        vivo.alResponder(atender(registro, solicitud));
      }
    },
    fallar: (motivo) => vivo?.alFallar(motivo),
  };
};
