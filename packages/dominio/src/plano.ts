import { type Coordenada, RADIO_TIERRA_METROS } from "./area.ts";

/**
 * Un punto en un plano local, en metros al este y al norte de un origen. Es el plano en que
 * calculan las simulaciones (la `Malla` de `@celda/sim`).
 */
export interface PuntoLocal {
  readonly este: number;
  readonly norte: number;
}

const METROS_POR_GRADO = (RADIO_TIERRA_METROS * Math.PI) / 180;

const metrosPorGradoDeLongitud = (origen: Coordenada): number =>
  METROS_POR_GRADO * Math.cos((origen.latitud * Math.PI) / 180);

/**
 * Proyección equirectangular alrededor de `origen`, la misma aproximación que `distanciaMetros`.
 * A 10 km del origen, en Barcelona, las distancias se desvían menos de un 0,2 % de las del mapa.
 */
export const aPlano = (origen: Coordenada, punto: Coordenada): PuntoLocal => ({
  este: (punto.longitud - origen.longitud) * metrosPorGradoDeLongitud(origen),
  norte: (punto.latitud - origen.latitud) * METROS_POR_GRADO,
});

/** El punto del mapa que está en `punto` del plano de `origen`: lo contrario de `aPlano`. */
export const desdePlano = (origen: Coordenada, punto: PuntoLocal): Coordenada => ({
  longitud: origen.longitud + punto.este / metrosPorGradoDeLongitud(origen),
  latitud: origen.latitud + punto.norte / METROS_POR_GRADO,
});
