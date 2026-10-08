import type { Coordenada } from "@celda/dominio/area";
import type { EmplazamientoLeido } from "@celda/dominio/capa";

import type { Elemento, Escena } from "./agrupacion.ts";

/**
 * El paso entre la vista de puntos y los logos al cruzar el zoom de los logos (ADR 0028): qué
 * puntos se mueven y hacia dónde. Al acercar, cada punto va a su logo, que crece desde él, o al
 * hexágono de la agrupación que lo recoge; al alejar, sale de ahí. Solo los que se ven.
 */

/** Un punto que se mueve en el paso: su emplazamiento y el marcador en que acaba o del que sale. */
export interface PuntoDelTraspaso {
  readonly clave: string;
  readonly posicion: Coordenada;
  /** Dónde está el marcador que lo lleva: su logo, en su sitio, o el hexágono que lo recoge. */
  readonly marcador: Coordenada;
}

/**
 * Cuántos puntos se mueven como mucho. En el escritorio, a zoom 15 en el centro de Madrid, se ven
 * unos 500 emplazamientos; más nodos solo costarían fotogramas en el paso.
 */
export const MAXIMO_DEL_TRASPASO = 1500;

/**
 * Los puntos que se mueven entre los marcadores de `escena` y sus emplazamientos: los de los
 * logos y los de las agrupaciones (`emplazamientosDe`), si su sitio o el de su marcador se ve.
 */
export const puntosDelTraspaso = (
  escena: Escena,
  emplazamientosDe: (elemento: Elemento) => ReadonlyArray<EmplazamientoLeido>,
  seVe: (posicion: Coordenada) => boolean,
  maximo: number = MAXIMO_DEL_TRASPASO,
): ReadonlyArray<PuntoDelTraspaso> => {
  const puntos: Array<PuntoDelTraspaso> = [];
  for (const elemento of escena.elementos.values()) {
    const suyos =
      elemento.tipo === "emplazamiento" ? [elemento.emplazamiento] : emplazamientosDe(elemento);
    const marcadorSeVe = seVe(elemento.posicion);
    for (const emplazamiento of suyos) {
      if (puntos.length >= maximo) return puntos;
      if (!marcadorSeVe && !seVe(emplazamiento.posicion)) continue;
      puntos.push({
        clave: emplazamiento.clave,
        posicion: emplazamiento.posicion,
        marcador: elemento.posicion,
      });
    }
  }
  return puntos;
};
