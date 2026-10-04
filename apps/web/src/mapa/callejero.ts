import { FUENTE_MAPA_BASE } from "@celda/ui/mapa/estilo.ts";
import { FUENTE_RESERVA } from "@celda/ui/mapa/reserva/estilo.ts";

import type { MotivoFallo } from "./estado.ts";

/**
 * De dónde sale el callejero: el principal, de OpenFreeMap, o el de reserva, del IGN, cuando el
 * principal no llega al abrir.
 */
export type Callejero = "principal" | "reserva";

/**
 * Lo que espera el mapa a la primera tesela del principal antes de pasar al de reserva. Durante un
 * bloqueo de LaLiga la conexión con Cloudflare suele quedarse colgada en lugar de fallar, y sin
 * plazo el mapa se quedaría en blanco.
 */
export const PLAZO_DEL_PRINCIPAL_MS = 4000;

export interface Avisos {
  /** Ha llegado la primera tesela del callejero. */
  readonly listo: () => void;
  readonly fallo: (motivo: MotivoFallo) => void;
  /** El principal no ha llegado y el mapa pasa al de reserva. */
  readonly aReserva: () => void;
}

/** Lo que trae un evento `sourcedata` o `error` de MapLibre. */
export interface EventoDeFuente {
  /** La fuente del estilo de la que habla, si es de una. */
  readonly sourceId?: string | undefined;
  /** La tesela que ha llegado, en `sourcedata`. */
  readonly tile?: unknown;
  /** Lo que ha fallado, en `error`: con `status` si es una respuesta HTTP. */
  readonly error?: { readonly status?: number | undefined } | undefined;
}

/** Lo que hace falta del mapa de MapLibre para saber si el callejero ha llegado. */
export interface MapaConCallejero {
  readonly on: (
    evento: "sourcedata" | "error",
    escuchador: (evento: EventoDeFuente) => void,
  ) => void;
  readonly once: (evento: "remove", escuchador: () => void) => void;
}

/** Espera `ms` y llama a `alVencer`; devuelve con qué cancelarlo. */
export type Esperar = (ms: number, alVencer: () => void) => () => void;

/** `setTimeout`, el de verdad. */
export const esperarDeVerdad: Esperar = (ms, alVencer) => {
  const temporizador = setTimeout(alVencer, ms);
  return () => clearTimeout(temporizador);
};

export interface OpcionesDelCallejero {
  /** Con qué callejero nace el mapa. */
  readonly desde: Callejero;
  /** Pone el estilo de reserva en el mapa, sin perder lo de Celda. */
  readonly ponerReserva: () => void;
  readonly esperar: Esperar;
}

const FUENTE: Record<Callejero, string> = {
  principal: FUENTE_MAPA_BASE,
  reserva: FUENTE_RESERVA,
};

/**
 * Avisa cuando llega la primera tesela del callejero (`listo`). El evento `load` de MapLibre llega
 * aunque el callejero no haya cargado, y eso dejaría un lienzo vacío pasando por mapa.
 *
 * Si antes llega un error del principal, o pasan `PLAZO_DEL_PRINCIPAL_MS` sin ninguna tesela, pasa
 * al de reserva (`aReserva`), una sola vez: un mapa no vuelve al principal. Con la reserva, un
 * error de sus teselas antes de la primera es un fallo, salvo un 403: el IGN contesta así a lo que
 * no tiene, el mar y el extranjero de cerca, y es una tesela vacía.
 *
 * Solo cuentan los errores del callejero. Uno de otra fuente no lo da por perdido: una tesela de
 * la foto aérea que no está (fuera de España, un 404) o que no llega por la red, o una de las
 * fuentes de Celda. Un error sin fuente (los glifos) cuenta con el principal, que los pide del
 * mismo servidor, y no con la reserva.
 */
export const vigilarCallejero = (
  mapa: MapaConCallejero,
  avisos: Avisos,
  opciones: OpcionesDelCallejero,
): void => {
  let callejero = opciones.desde;
  let conCallejero = false;
  let fallado = false;
  let cancelarPlazo: (() => void) | undefined;

  const pasarAReserva = () => {
    if (callejero === "reserva" || conCallejero) return;
    cancelarPlazo?.();
    cancelarPlazo = undefined;
    callejero = "reserva";
    avisos.aReserva();
    opciones.ponerReserva();
  };

  if (callejero === "principal") {
    cancelarPlazo = opciones.esperar(PLAZO_DEL_PRINCIPAL_MS, pasarAReserva);
  }
  mapa.once("remove", () => cancelarPlazo?.());

  mapa.on("sourcedata", (evento) => {
    if (conCallejero || evento.sourceId !== FUENTE[callejero] || evento.tile === undefined) return;
    conCallejero = true;
    cancelarPlazo?.();
    cancelarPlazo = undefined;
    avisos.listo();
  });
  mapa.on("error", (evento) => {
    if (conCallejero) return;
    if (callejero === "principal") {
      if (evento.sourceId === undefined || evento.sourceId === FUENTE_MAPA_BASE) pasarAReserva();
      return;
    }
    if (fallado || evento.sourceId !== FUENTE_RESERVA || evento.error?.status === 403) return;
    fallado = true;
    avisos.fallo("sin-respuesta");
  });
};
