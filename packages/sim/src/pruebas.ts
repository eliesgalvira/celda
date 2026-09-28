import * as Layer from "effect/Layer";

import { atender, type Respuesta, type Solicitud } from "./protocolo.ts";
import { SIMULACIONES, type SimulacionRegistrada } from "./registro.ts";
import { type PuertoWorker, type Simulador, simuladorEnWorker } from "./simulador.ts";

/**
 * Un Worker de prueba que se porta como uno del navegador: recibe una copia de cada solicitud
 * (`postMessage` la clona), y la respuesta y los fallos llegan en otra tarea, como un evento
 * `message` o `error`. Por defecto no contesta hasta que la prueba se lo pide.
 */
export interface WorkerDePrueba {
  /** Para `simuladorEnWorker`. */
  readonly crear: () => PuertoWorker;
  /** Cuántos Workers se han creado y cuántos se han terminado. */
  readonly creados: () => number;
  readonly terminados: () => number;
  /** Cuántas solicitudes ha recibido, en todos los Workers. */
  readonly recibidas: () => number;
  /** Las solicitudes que esperan respuesta en el Worker vivo. */
  readonly pendientes: () => ReadonlyArray<Solicitud>;
  /**
   * Calcula la solicitud más antigua con el registro y la contesta en otra tarea. Si antes se
   * termina el Worker, la respuesta no llega.
   */
  readonly contestar: () => void;
  /** El Worker vivo falla en otra tarea, como si su código hubiera lanzado un error. */
  readonly fallar: (motivo: string) => void;
}

export interface OpcionesDeWorker {
  readonly registro?: ReadonlyArray<SimulacionRegistrada>;
  /** Contesta cada solicitud por su cuenta, en otra tarea, como el Worker de verdad. */
  readonly automatico?: boolean;
}

/** La siguiente tarea, como un evento que manda el Worker. */
const enOtraTarea = (tarea: () => void): void => {
  // @effect-diagnostics-next-line globalTimers:off
  setTimeout(tarea, 0);
};

interface WorkerVivo {
  readonly cola: Array<Solicitud>;
  terminado: boolean;
  alResponder: (respuesta: Respuesta) => void;
  alFallar: (motivo: string) => void;
}

export const workerDePrueba = (opciones: OpcionesDeWorker = {}): WorkerDePrueba => {
  const registro = opciones.registro ?? SIMULACIONES;
  let creados = 0;
  let terminados = 0;
  let recibidas = 0;
  let vivo: WorkerVivo | undefined;

  const contestarEn = (worker: WorkerVivo | undefined) => {
    const solicitud = worker?.cola.shift();
    if (worker === undefined || solicitud === undefined) return;
    const respuesta = structuredClone(atender(registro, solicitud));
    enOtraTarea(() => {
      if (!worker.terminado) worker.alResponder(respuesta);
    });
  };

  return {
    crear: () => {
      creados += 1;
      const worker: WorkerVivo = {
        cola: [],
        terminado: false,
        alResponder: () => undefined,
        alFallar: () => undefined,
      };
      vivo = worker;
      return {
        enviar: (solicitud) => {
          recibidas += 1;
          worker.cola.push(structuredClone(solicitud));
          if (opciones.automatico === true) enOtraTarea(() => contestarEn(worker));
        },
        escuchar: (alResponder, alFallar) => {
          worker.alResponder = alResponder;
          worker.alFallar = alFallar;
        },
        terminar: () => {
          terminados += 1;
          worker.terminado = true;
          if (vivo === worker) {
            vivo = undefined;
          }
        },
      };
    },
    creados: () => creados,
    terminados: () => terminados,
    recibidas: () => recibidas,
    pendientes: () => vivo?.cola ?? [],
    contestar: () => contestarEn(vivo),
    fallar: (motivo) => {
      const worker = vivo;
      if (worker === undefined) return;
      enOtraTarea(() => {
        if (!worker.terminado) worker.alFallar(motivo);
      });
    },
  };
};

/**
 * El simulador de las pruebas de pantalla: el de la web, sobre un Worker de prueba que contesta
 * cada solicitud por su cuenta y en otra tarea. `simuladorEnHilo` contestaría en el acto, y el
 * Worker de verdad nunca lo hace. Cada vez que se construye usa un Worker de prueba nuevo.
 */
export const simuladorDePrueba: Layer.Layer<Simulador> = Layer.suspend(() =>
  simuladorEnWorker(workerDePrueba({ automatico: true }).crear),
);
