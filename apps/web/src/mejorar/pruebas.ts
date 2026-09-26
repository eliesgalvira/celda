import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { Brujula, BrujulaSinLecturas } from "./brujula.ts";
import type { Disponibilidad, LecturaBrujula } from "./estado.ts";

export interface OpcionesDeBrujula {
  readonly disponibilidad?: Disponibilidad;
  /** Qué contesta el aviso del navegador. */
  readonly permiso?: "concedido" | "denegado";
}

export interface BrujulaDePrueba {
  readonly capa: Layer.Layer<Brujula>;
  /** Cuántas veces se ha pedido permiso: cada una sería un aviso del navegador. */
  readonly permisosPedidos: () => number;
  /** Cuántas escuchas siguen abiertas. */
  readonly abiertas: () => number;
  /** Entrega una lectura a las escuchas abiertas. */
  readonly responder: (lectura: LecturaBrujula) => void;
  /** Hace fallar las escuchas abiertas, como si no llegara ninguna lectura a tiempo. */
  readonly sinLecturas: () => void;
}

/**
 * Una brújula de prueba. Por defecto es la de un ordenador, sin brújula, como la de happy-dom. No
 * da lecturas hasta que la prueba se lo pide.
 */
export const brujulaDePrueba = (opciones: OpcionesDeBrujula = {}): BrujulaDePrueba => {
  let permisosPedidos = 0;
  const colas: Array<Queue.Queue<LecturaBrujula, BrujulaSinLecturas | Cause.Done>> = [];
  const seguir = Stream.callback<LecturaBrujula, BrujulaSinLecturas>((cola) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        colas.push(cola);
      }),
      () =>
        Effect.sync(() => {
          colas.splice(colas.indexOf(cola), 1);
        }),
    ),
  );
  return {
    capa: Layer.succeed(
      Brujula,
      Brujula.of({
        disponibilidad: opciones.disponibilidad ?? "ordenador",
        pedirPermiso: Effect.sync(() => {
          permisosPedidos += 1;
          return opciones.permiso ?? "concedido";
        }),
        seguir,
      }),
    ),
    permisosPedidos: () => permisosPedidos,
    abiertas: () => colas.length,
    responder: (lectura) => {
      for (const cola of colas) Queue.offerUnsafe(cola, lectura);
    },
    sinLecturas: () => {
      for (const cola of colas) {
        Queue.failCauseUnsafe(cola, Cause.fail(new BrujulaSinLecturas()));
      }
    },
  };
};
