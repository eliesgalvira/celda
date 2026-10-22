import {
  type Coordenada,
  contiene,
  distanciaMetros,
  type Rectangulo,
  rumboGrados,
} from "@celda/dominio/area";
import { companiasDeMascara, type EmplazamientoLeido } from "@celda/dominio/capa";
import type { Compania } from "@celda/dominio/compania";
import { type MascarasDeFiltro, papelDeMascara } from "@celda/dominio/filtro";
import type { PuntosLeidos } from "@celda/dominio/puntos";

/**
 * La vista de puntos (ADR 0028): qué hacer al tocarlos, cuáles se ven para la lista y cuál de la
 * capa de una provincia es el que se ha tocado. Funciones puras; el mapa las usa en `enMapa.ts`.
 */

/**
 * El zoom en que los puntos dan paso a los logos. Desde él, las dos vistas son iguales: logos y,
 * donde varios emplazamientos quedan muy juntos, sus agrupaciones con su número.
 */
export const ZOOM_DE_LOGOS = 15;

/**
 * Con la vista de puntos, las provincias de lo que se ve se piden desde este nivel, uno antes del
 * de los logos, para que estén leídas e indexadas al llegar a él. Más lejos ninguna provincia se
 * pide para dibujar: solo la que se toca para abrir su ficha.
 */
export const NIVEL_DE_PROVINCIAS_CON_PUNTOS = ZOOM_DE_LOGOS - 1;

/** Lo que se mira alrededor del dedo, en píxeles: la mitad de un objetivo de 44 px. */
export const RADIO_DEL_DEDO = 22;

/** Desde este zoom, un punto que queda solo bajo el dedo abre su ficha. */
export const ZOOM_PARA_ABRIR = 10;

/** Desde este zoom, tocar abre siempre la ficha del más cercano, aunque haya otros al lado. */
export const ZOOM_PARA_ABRIR_SIEMPRE = 13;

/** Cuántos puntos bajo el dedo dejan abrir el más cercano antes de `ZOOM_PARA_ABRIR_SIEMPRE`. */
export const CERCANOS_PARA_ABRIR = 3;

/** Lo que acerca un toque que no abre ninguna ficha, en niveles de zoom. */
const SALTO_AL_ACERCAR = 2.5;

/** Un punto bajo el dedo: su fila y a cuántos píxeles del dedo queda. */
export interface PuntoTocado {
  readonly indice: number;
  readonly distancia: number;
}

/** Lo que hace un toque sobre los puntos. */
export type AlTocar =
  | { readonly tipo: "nada" }
  | { readonly tipo: "acercar"; readonly zoom: number }
  | { readonly tipo: "abrir"; readonly indice: number };

/**
 * Qué hace un toque con los puntos que quedan bajo el dedo (`RADIO_DEL_DEDO`):
 *
 * - Sin ninguno, nada.
 * - De lejos, o con muchos juntos, acerca el mapa `SALTO_AL_ACERCAR` niveles hacia el dedo, sin
 *   pasar del nivel anterior a los logos: un toque desde España no salta a pie de calle.
 * - Desde `ZOOM_PARA_ABRIR`, si bajo el dedo hay pocos (`CERCANOS_PARA_ABRIR`), y desde
 *   `ZOOM_PARA_ABRIR_SIEMPRE` siempre, abre la ficha del más cercano sin mover el zoom. El anillo
 *   dice cuál es.
 */
export const queHacerAlTocar = (zoom: number, tocados: ReadonlyArray<PuntoTocado>): AlTocar => {
  const masCercano = tocados.reduce<PuntoTocado | undefined>(
    (mejor, punto) =>
      mejor === undefined ||
      punto.distancia < mejor.distancia ||
      (punto.distancia === mejor.distancia && punto.indice < mejor.indice)
        ? punto
        : mejor,
    undefined,
  );
  if (masCercano === undefined) return { tipo: "nada" };
  const abre =
    zoom >= ZOOM_PARA_ABRIR_SIEMPRE ||
    (zoom >= ZOOM_PARA_ABRIR && tocados.length <= CERCANOS_PARA_ABRIR);
  return abre
    ? { tipo: "abrir", indice: masCercano.indice }
    : { tipo: "acercar", zoom: Math.min(zoom + SALTO_AL_ACERCAR, NIVEL_DE_PROVINCIAS_CON_PUNTOS) };
};

/** La posición de un punto. */
export const posicionDePunto = (puntos: PuntosLeidos, indice: number): Coordenada => ({
  longitud: puntos.longitud[indice] ?? 0,
  latitud: puntos.latitud[indice] ?? 0,
});

/** La provincia en cuya capa va un punto, por su código. */
export const provinciaDePunto = (puntos: PuntosLeidos, indice: number): string =>
  puntos.provincias[puntos.provincia[indice] ?? -1] ?? "";

/**
 * El emplazamiento de la capa de una provincia que es un punto: el más cercano a su posición. Los
 * puntos van redondeados al metro y dos emplazamientos nunca están a menos de 15 m (ADR 0012), así
 * que no hay duda.
 */
export const emplazamientoDelPunto = (
  emplazamientos: ReadonlyArray<EmplazamientoLeido>,
  posicion: Coordenada,
): EmplazamientoLeido | undefined => {
  let mejor: EmplazamientoLeido | undefined;
  let menor = Infinity;
  for (const emplazamiento of emplazamientos) {
    const dx = emplazamiento.posicion.longitud - posicion.longitud;
    const dy = emplazamiento.posicion.latitud - posicion.latitud;
    const d = dx * dx + dy * dy;
    if (d < menor) {
      menor = d;
      mejor = emplazamiento;
    }
  }
  return mejor;
};

/** Cuántos emplazamientos enseña como mucho la lista de los que se ven. */
const MAXIMO_DE_LA_LISTA = 40;

/** Un emplazamiento de la lista de los que se ven. */
export interface PuntoDeLaLista {
  readonly indice: number;
  readonly posicion: Coordenada;
  readonly companias: ReadonlyArray<Compania>;
  /** Si sale por la red que usa una compañía del filtro (ADR 0026). */
  readonly redUsada: boolean;
  /** Desde el centro de lo que se ve, en metros y en grados desde el norte. */
  readonly distancia: number;
  readonly rumbo: number;
}

/** Los emplazamientos que se ven, para elegir uno sin tocar el mapa. */
export interface ListaDePuntos {
  /** Cuántos se ven, con el filtro. */
  readonly total: number;
  /** Los `MAXIMO_DE_LA_LISTA` más cercanos al centro, del más cercano al más lejano. */
  readonly primeros: ReadonlyArray<PuntoDeLaLista>;
}

/**
 * Los emplazamientos que caen en `caja` y salen con el filtro, también los de la red usada, del
 * más cercano al más lejano de `centro`.
 */
export const listaDePuntos = (
  puntos: PuntosLeidos,
  caja: Rectangulo,
  centro: Coordenada,
  filtro: MascarasDeFiltro,
  maximo: number = MAXIMO_DE_LA_LISTA,
): ListaDePuntos => {
  const dentro: Array<{ readonly indice: number; readonly papel: string; readonly d: number }> = [];
  for (let i = 0; i < puntos.cuantos; i++) {
    const posicion = posicionDePunto(puntos, i);
    if (!contiene(caja, posicion)) continue;
    const papel = papelDeMascara(puntos.companias[i] ?? 0, filtro);
    if (papel === undefined) continue;
    dentro.push({ indice: i, papel, d: distanciaMetros(centro, posicion) });
  }
  const primeros = dentro
    .toSorted((a, b) => a.d - b.d || a.indice - b.indice)
    .slice(0, maximo)
    .map(({ indice, papel, d }): PuntoDeLaLista => {
      const posicion = posicionDePunto(puntos, indice);
      return {
        indice,
        posicion,
        companias: companiasDeMascara(puntos.companias[indice] ?? 0),
        redUsada: papel === "red-usada",
        distancia: d,
        rumbo: rumboGrados(centro, posicion),
      };
    });
  return { total: dentro.length, primeros };
};
