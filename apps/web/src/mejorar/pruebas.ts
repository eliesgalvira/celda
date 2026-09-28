import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { enOtraTarea } from "../lib/pruebas.ts";
import { Brujula, BrujulaSinLecturas } from "./brujula.ts";
import type { Disponibilidad, LecturaBrujula } from "./estado.ts";

export interface OpcionesDeBrujula {
  readonly disponibilidad?: Disponibilidad;
  /** Qué contesta el aviso del navegador. */
  readonly permiso?: "concedido" | "denegado";
  /**
   * Hacia dónde apunta ya el móvil: la primera escucha la recibe nada más empezar, como el evento
   * que lanza el navegador al añadir el escuchador. Sin ella, el sensor aún no ha dado nada.
   */
  readonly rumbo?: LecturaBrujula;
}

export interface BrujulaDePrueba {
  readonly capa: Layer.Layer<Brujula>;
  /** Cuántas veces se ha pedido permiso: cada una sería un aviso del navegador. */
  readonly permisosPedidos: () => number;
  /** Cuántas veces se ha empezado a escuchar. */
  readonly escuchas: () => number;
  /** Cuántas escuchas siguen abiertas. */
  readonly abiertas: () => number;
  /** Entrega una lectura a las escuchas abiertas. Las que se abran después la reciben al empezar. */
  readonly responder: (lectura: LecturaBrujula) => void;
  /** Hace fallar las escuchas abiertas, como si no llegara ninguna lectura a tiempo. */
  readonly sinLecturas: () => void;
}

/**
 * Una brújula de prueba. Por defecto es la de un ordenador, sin brújula, como la de happy-dom.
 * Como la del navegador, cada escucha nueva recibe al empezar lo último que ha leído el sensor
 * (`deviceorientation` se lanza al añadir el escuchador); el resto llega cuando la prueba lo pide.
 * `pedirPermiso` contesta más tarde, como la promesa de `requestPermission`.
 */
export const brujulaDePrueba = (opciones: OpcionesDeBrujula = {}): BrujulaDePrueba => {
  let permisosPedidos = 0;
  let escuchas = 0;
  let ultima = opciones.rumbo;
  const colas: Array<Queue.Queue<LecturaBrujula, BrujulaSinLecturas | Cause.Done>> = [];
  const seguir = Stream.callback<LecturaBrujula, BrujulaSinLecturas>((cola) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        escuchas += 1;
        colas.push(cola);
        if (ultima !== undefined) Queue.offerUnsafe(cola, ultima);
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
        }).pipe(Effect.andThen(enOtraTarea), Effect.as(opciones.permiso ?? "concedido")),
        seguir,
      }),
    ),
    permisosPedidos: () => permisosPedidos,
    escuchas: () => escuchas,
    abiertas: () => colas.length,
    responder: (lectura) => {
      ultima = lectura;
      for (const cola of colas) Queue.offerUnsafe(cola, lectura);
    },
    sinLecturas: () => {
      for (const cola of colas) {
        Queue.failCauseUnsafe(cola, Cause.fail(new BrujulaSinLecturas()));
      }
    },
  };
};
