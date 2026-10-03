import { FUENTE_MAPA_BASE } from "@celda/ui/mapa/estilo.ts";

import type { MotivoFallo } from "./estado.ts";

export interface Avisos {
  readonly listo: () => void;
  readonly fallo: (motivo: MotivoFallo) => void;
}

/** Lo que trae un evento `sourcedata` o `error` de MapLibre. */
export interface EventoDeFuente {
  /** La fuente del estilo de la que habla, si es de una. */
  readonly sourceId?: string | undefined;
  /** La tesela que ha llegado, en `sourcedata`. */
  readonly tile?: unknown;
}

/** Lo que hace falta del mapa de MapLibre para saber si el callejero ha llegado. */
export interface MapaConCallejero {
  readonly on: (
    evento: "sourcedata" | "error",
    escuchador: (evento: EventoDeFuente) => void,
  ) => void;
}

/**
 * Avisa cuando llega la primera tesela del callejero (`listo`), o de un fallo si antes llega un
 * error. El evento `load` de MapLibre llega aunque el callejero no haya cargado, y eso dejaría un
 * lienzo vacío pasando por mapa.
 *
 * Solo cuentan los errores del mapa base. Uno de otra fuente no lo da por perdido: una tesela de
 * la foto aérea que no está (fuera de España, un 404) o que no llega por la red, o una de las
 * fuentes de Celda.
 */
export const vigilarCallejero = (mapa: MapaConCallejero, avisos: Avisos): void => {
  let conCallejero = false;
  mapa.on("sourcedata", (evento) => {
    if (conCallejero || evento.sourceId !== FUENTE_MAPA_BASE || evento.tile === undefined) return;
    conCallejero = true;
    avisos.listo();
  });
  mapa.on("error", (evento) => {
    const deOtraFuente = evento.sourceId !== undefined && evento.sourceId !== FUENTE_MAPA_BASE;
    if (!conCallejero && !deOtraFuente) avisos.fallo("sin-respuesta");
  });
};
