import type { Caja } from "@celda/dominio/barrido";

export type { Caja };

/** La caja de Barcelona de la investigación del registro oficial. */
export const ZONA_BARCELONA: Caja = [2.052, 41.317, 2.229, 41.468];

/** Si el punto cae dentro de la caja, bordes incluidos. */
export const enCaja = ([oeste, sur, este, norte]: Caja, longitud: number, latitud: number) =>
  longitud >= oeste && longitud <= este && latitud >= sur && latitud <= norte;
