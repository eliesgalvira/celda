import { recurso } from "@celda/ui/recurso.ts";
import { createEffect, createMemo, createSignal } from "solid-js";

import type { Esperar } from "../mapa/callejero.ts";
import type { EstadoDeLasVecinas } from "../capa/vecinas.ts";
import { type CalculoCeldas, type PistaCeldas, pistaDeCeldas } from "./celdas.ts";

/** Lo que dura la salvedad de las celdas a la vista, si nadie toca el mapa antes. */
export const SALVEDAD_MS = 5000;

/** A partir de cuánto el primer cálculo de las celdas se dice: antes no se ve nada. */
export const ESPERA_LENTA_MS = 1000;

export interface EntradaDeLaPista {
  /** Si el mapa está al zoom de las celdas o más cerca. */
  readonly cerca: () => boolean;
  readonly calculo: () => CalculoCeldas;
  readonly vecinas: () => EstadoDeLasVecinas;
  /**
   * Si este dispositivo ya ha visto la salvedad, o `undefined` mientras se leen los ajustes: hasta
   * saberlo no sale.
   */
  readonly salvedadVista: () => boolean | undefined;
  /** Lo apunta en el dispositivo. Se llama una vez, cuando la salvedad sale. */
  readonly marcarSalvedadVista: () => void;
  readonly esperar: Esperar;
}

export interface PistaDeLasCeldas {
  readonly pista: () => PistaCeldas | undefined;
  /** Si la salvedad está a la vista: entonces un gesto sobre el mapa la quita. */
  readonly conSalvedad: () => boolean;
  /** La persona ha tocado el mapa: la salvedad, si está, se va. */
  readonly interactuar: () => void;
}

/**
 * La pista de las celdas con su memoria. La salvedad sale una sola vez por dispositivo, la primera
 * vez que hay celdas, durante `SALVEDAD_MS` o hasta el primer gesto sobre el mapa. «Calculando las
 * celdas…» y la espera de una provincia vecina solo salen si el primer cálculo pasa de
 * `ESPERA_LENTA_MS`. Recalcular al mover el mapa, con las celdas ya dibujadas, no dice nada. Los
 * fallos sí, siempre.
 */
export const crearPistaDeCeldas = (entrada: EntradaDeLaPista): PistaDeLasCeldas => {
  /** La salvedad: aún no ha salido, está a la vista o ya se ha ido en esta visita. */
  const [fase, setFase] = createSignal<"pendiente" | "visible" | "hecha">("pendiente");
  /** Si ya se han dibujado celdas alguna vez: desde entonces, recalcular no se dice. */
  const [conCeldas, setConCeldas] = createSignal(false);
  const [lento, setLento] = createSignal(false);

  const listas = createMemo(() => entrada.cerca() && entrada.calculo() === "listas");
  createEffect(listas, (hay) => {
    if (hay) setConCeldas(true);
  });

  const tocaSalvedad = createMemo(
    () => fase() === "pendiente" && listas() && entrada.salvedadVista() === false,
  );
  createEffect(tocaSalvedad, (toca) => {
    if (!toca) return;
    setFase("visible");
    entrada.marcarSalvedadVista();
  });
  // Se va sola a los `SALVEDAD_MS`.
  recurso(
    "celdas:salvedad",
    () => fase() === "visible",
    () => entrada.esperar(SALVEDAD_MS, () => setFase("hecha")),
  );

  /** El primer cálculo, o una provincia vecina que hace falta para él, todavía no ha llegado. */
  const esperando = createMemo(() => {
    if (!entrada.cerca() || conCeldas()) return false;
    const calculo = entrada.calculo();
    return (
      calculo === "calculando" || calculo === "sin-pedir" || entrada.vecinas().tipo === "cargando"
    );
  });
  recurso("celdas:espera-lenta", esperando, () => {
    setLento(false);
    return entrada.esperar(ESPERA_LENTA_MS, () => setLento(true));
  });

  const conSalvedad = createMemo(() => fase() === "visible");
  return {
    pista: createMemo(() =>
      pistaDeCeldas(entrada.cerca(), entrada.calculo(), entrada.vecinas(), {
        salvedad: conSalvedad(),
        lento: esperando() && lento(),
      }),
    ),
    conSalvedad,
    interactuar: () => {
      if (fase() === "visible") setFase("hecha");
    },
  };
};
