import { AJUSTES_INICIALES, type Ajustes } from "@celda/dominio/ajustes";
import { recursoFijo } from "@celda/ui/recurso.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import { createContext, createSignal } from "solid-js";

import type { ServiciosDeDatos } from "../datos.tsx";
import { AlmacenLocal } from "../ubicacion/almacen.ts";

/** Los ajustes del dispositivo para toda la pantalla, y cómo cambiarlos. */
export interface ControlAjustes {
  readonly ajustes: () => Ajustes;
  /** Enciende o apaga el modo estudiante y lo guarda en el dispositivo. */
  readonly cambiarModoEstudiante: (encendido: boolean) => void;
  /** El último cambio no se ha podido guardar: vale hasta cerrar la página. */
  readonly sinGuardar: () => boolean;
}

export const AjustesContexto = createContext<ControlAjustes>();

/**
 * Los ajustes guardados en el dispositivo. Empiezan con los iniciales (el modo estudiante
 * apagado) y, en cuanto se leen, pasan a los guardados. Si no se pueden leer, se quedan los
 * iniciales: nadie ve el modo estudiante sin haberlo encendido.
 */
export const crearAjustes = (
  runtime: ManagedRuntime.ManagedRuntime<ServiciosDeDatos, never>,
): ControlAjustes => {
  const [ajustes, setAjustes] = createSignal<Ajustes>(AJUSTES_INICIALES);
  const [sinGuardar, setSinGuardar] = createSignal(false);
  // Un cambio hecho antes de que llegue la lectura manda sobre ella.
  let cambiados = false;

  recursoFijo("almacen:ajustes", () => {
    const parar = new AbortController();
    void runtime
      .runPromiseExit(
        Effect.flatMap(AlmacenLocal, (a) => a.leerAjustes),
        { signal: parar.signal },
      )
      .then((salida) => {
        if (Exit.isSuccess(salida) && !cambiados) setAjustes(salida.value);
      });
    return () => parar.abort();
  });

  return {
    ajustes,
    cambiarModoEstudiante: (encendido) => {
      cambiados = true;
      const nuevos = { ...ajustes(), modoEstudiante: encendido };
      setAjustes(nuevos);
      void runtime
        .runPromiseExit(Effect.flatMap(AlmacenLocal, (a) => a.guardarAjustes(nuevos)))
        .then((salida) => setSinGuardar(Exit.isFailure(salida)));
    },
    sinGuardar,
  };
};
