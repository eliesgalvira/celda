import { AJUSTES_INICIALES, type Ajustes, filtroDeAjustes } from "@celda/dominio/ajustes";
import { type FiltroDeCompanias, mismoFiltro } from "@celda/dominio/filtro";
import { recursoFijo } from "@celda/ui/recurso.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import { createContext, createMemo, createSignal } from "solid-js";

import type { ServiciosDeDatos } from "../datos.tsx";
import { AlmacenLocal } from "../ubicacion/almacen.ts";

/** Los ajustes del dispositivo para toda la pantalla, y cómo cambiarlos. */
export interface ControlAjustes {
  readonly ajustes: () => Ajustes;
  /** Enciende o apaga el modo estudiante y lo guarda en el dispositivo. */
  readonly cambiarModoEstudiante: (encendido: boolean) => void;
  /** Las compañías que enseña el mapa: vacío, todas (ADR 0026). */
  readonly filtro: () => FiltroDeCompanias;
  /** Cambia las compañías que enseña el mapa y lo guarda en el dispositivo. */
  readonly cambiarFiltro: (filtro: FiltroDeCompanias) => void;
  /** El último cambio no se ha podido guardar: vale hasta cerrar la página. */
  readonly sinGuardar: () => boolean;
  /** Si ya se ha intentado leer lo guardado, haya llegado o no. */
  readonly leidos: () => boolean;
  /** Pasa a la vista agrupada, o vuelve a la de puntos, y lo guarda en el dispositivo (ADR 0028). */
  readonly cambiarVistaAgrupada: (agrupada: boolean) => void;
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
  const [leidos, setLeidos] = createSignal(false);
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
        setLeidos(true);
      });
    return () => parar.abort();
  });

  /** Pone unos ajustes nuevos y los guarda. Si no se guardan, valen hasta cerrar la página. */
  const cambiar = (nuevos: Ajustes) => {
    cambiados = true;
    setAjustes(nuevos);
    void runtime
      .runPromiseExit(Effect.flatMap(AlmacenLocal, (a) => a.guardarAjustes(nuevos)))
      .then((salida) => setSinGuardar(Exit.isFailure(salida)));
  };
  const filtro = createMemo(() => filtroDeAjustes(ajustes()), { equals: mismoFiltro });

  return {
    ajustes,
    cambiarModoEstudiante: (encendido) => cambiar({ ...ajustes(), modoEstudiante: encendido }),
    filtro,
    cambiarFiltro: (nuevo) => {
      if (mismoFiltro(nuevo, filtro())) return;
      cambiar({ ...ajustes(), companias: [...nuevo] });
    },
    sinGuardar,
    leidos,
    cambiarVistaAgrupada: (agrupada) => {
      if ((ajustes().vistaAgrupada === true) === agrupada) return;
      cambiar({ ...ajustes(), vistaAgrupada: agrupada });
    },
  };
};
