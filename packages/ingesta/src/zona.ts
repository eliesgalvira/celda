import type { Caja } from "@celda/dominio/barrido";

export type { Caja };

/** Si el punto cae dentro de la caja, bordes incluidos. */
export const enCaja = ([oeste, sur, este, norte]: Caja, longitud: number, latitud: number) =>
  longitud >= oeste && longitud <= este && latitud >= sur && latitud <= norte;
