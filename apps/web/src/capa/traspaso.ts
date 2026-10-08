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

/** El paso entre los puntos y los marcadores, en la vista de puntos. */
export interface Traspaso {
  readonly tipo: "traspaso";
  readonly hacia: "logos" | "puntos";
  /** La escena con los marcadores: la que llega al acercar y la que se va al alejar. */
  readonly marcadores: Escena;
  /** La escena que llega con el paso. */
  readonly llega: Escena;
  /** El zoom del mapa en el paso: el tamaño de los puntos que se mueven. */
  readonly zoom: number;
}

/** Sin paso: los marcadores están, o no, desde el principio o desde un cambio de vista. */
export type SinTraspaso = { readonly tipo: "con" } | { readonly tipo: "sin" };
export const CON: SinTraspaso = { tipo: "con" };
export const SIN: SinTraspaso = { tipo: "sin" };

/** Lo que se sabe del paso entre los puntos y los marcadores tras cada escena. */
export interface EstadoDelTraspaso {
  readonly vista: "puntos" | "agrupada" | undefined;
  /** Si se dibujan marcadores. */
  readonly con: boolean;
  /** La última escena con marcadores: de ella salen los puntos al alejar o al volver a la vista de puntos. */
  readonly ultima: Escena | undefined;
  /** El último paso, que sigue mientras no cambie si hay marcadores. */
  readonly traspaso: Traspaso | undefined;
}

/**
 * El estado del paso tras una escena nueva. Hay paso cuando, con la vista de puntos antes y
 * ahora, los marcadores salen o se van. Si salen o se van al cambiar de vista no hay paso, y el
 * último deja de valer: los puntos del mapa se encienden o se apagan solo según haya marcadores.
 */
export const siguienteTraspaso = (
  antes: EstadoDelTraspaso | undefined,
  ahora: {
    readonly vista: "puntos" | "agrupada" | undefined;
    readonly con: boolean;
    readonly escena: Escena | undefined;
    readonly zoom: number;
  },
): EstadoDelTraspaso => {
  const { vista, con, escena, zoom } = ahora;
  const ultima = con ? escena : antes?.ultima;
  if (
    vista === "puntos" &&
    antes?.vista === "puntos" &&
    con !== antes.con &&
    escena !== undefined &&
    ultima !== undefined
  ) {
    return {
      vista,
      con,
      ultima,
      traspaso: {
        tipo: "traspaso",
        hacia: con ? "logos" : "puntos",
        marcadores: ultima,
        llega: escena,
        zoom,
      },
    };
  }
  return { vista, con, ultima, traspaso: con === antes?.con ? antes.traspaso : undefined };
};
