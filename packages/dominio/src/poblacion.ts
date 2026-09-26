import * as Schema from "effect/Schema";

import type { Coordenada } from "./area.ts";
import { FuenteDeBarrios, Poligono } from "./barrio.ts";
import { aPlano } from "./plano.ts";

/**
 * Los habitantes de cada barrio de Barcelona, para el ejercicio de emplazamientos del modo
 * estudiante. Salen del padrón municipal que publica el Ayuntamiento en Open Data BCN, y el área
 * de cada barrio, de sus límites. El fichero lo escribe el generador de capas con la orden
 * `poblacion`; la web lo lee tal cual.
 */

/** De dónde salen los habitantes: lo que hay que citar al usarlos. */
export const FuenteDePoblacion = Schema.Struct({
  atribucion: Schema.String,
  licencia: Schema.String,
  /** Página del conjunto de datos. */
  enlace: Schema.String,
  /** Día al que se refiere el padrón, `AAAA-MM-DD`: siempre un 1 de enero. */
  referencia: Schema.String,
  /** Día en que el Ayuntamiento publicó el fichero, `AAAA-MM-DD`. */
  publicada: Schema.String,
});
export type FuenteDePoblacion = typeof FuenteDePoblacion.Type;

/** Un barrio con sus habitantes, su área y su límite simplificado para dibujarlo. */
export const PoblacionDeBarrio = Schema.Struct({
  /** Código del Ayuntamiento, de «01» a «73», como en los límites y en la capa. */
  codigo: Schema.String,
  nombre: Schema.String,
  habitantes: Schema.Int,
  /** Área del barrio en km², calculada con sus límites completos. */
  areaKm2: Schema.Finite,
  /** El límite simplificado a unos metros: solo sirve para dibujarlo y elegir el barrio. */
  poligonos: Schema.Array(Poligono),
});
export type PoblacionDeBarrio = typeof PoblacionDeBarrio.Type;

/** Los habitantes de todos los barrios, con la fuente del padrón y la de los límites. */
export const PoblacionDeBarrios = Schema.Struct({
  fuente: FuenteDePoblacion,
  /** De dónde salen las áreas: los límites de barrio de la capa. */
  fuenteDeLimites: FuenteDeBarrios,
  barrios: Schema.Array(PoblacionDeBarrio),
});
export type PoblacionDeBarrios = typeof PoblacionDeBarrios.Type;

/** Área con signo de un anillo en m², en el plano de `origen`. */
const areaDelAnillo = (origen: Coordenada, anillo: Poligono[number]): number => {
  let doble = 0;
  for (let k = 0; k < anillo.length; k++) {
    const [x1 = 0, y1 = 0] = anillo[k] ?? [];
    const [x2 = 0, y2 = 0] = anillo[(k + 1) % anillo.length] ?? [];
    const a = aPlano(origen, { longitud: x1, latitud: y1 });
    const b = aPlano(origen, { longitud: x2, latitud: y2 });
    doble += a.este * b.norte - b.este * a.norte;
  }
  return doble / 2;
};

/**
 * Área en km² de unos polígonos en grados WGS84: el anillo exterior de cada uno menos sus
 * agujeros. Proyecta cada polígono en el plano local de su primer vértice; en un barrio el error
 * frente al área geodésica es menor que una milésima.
 */
export const areaKm2 = (poligonos: ReadonlyArray<Poligono>): number => {
  let metros = 0;
  for (const [exterior, ...agujeros] of poligonos) {
    const [x = 0, y = 0] = exterior?.[0] ?? [];
    const origen = { longitud: x, latitud: y };
    metros += Math.abs(areaDelAnillo(origen, exterior ?? []));
    for (const agujero of agujeros) metros -= Math.abs(areaDelAnillo(origen, agujero));
  }
  return metros / 1e6;
};
