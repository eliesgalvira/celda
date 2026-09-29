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

/**
 * Cuánto se equivoca, como mucho, una distancia medida en el plano de `origen` entre puntos a la
 * latitud `latitud`, en tanto por uno. Es la del este al oeste: el plano la mide con la escala
 * del paralelo del origen, y la del norte al sur no se equivoca. Son unos 0,017 por cada grado de
 * diferencia a 41° de latitud: con el origen en Barcelona, un 17 % en Canarias.
 */
export const errorDelPlano = (origen: Coordenada, latitud: number): number =>
  Math.abs(Math.cos((latitud * Math.PI) / 180) / Math.cos((origen.latitud * Math.PI) / 180) - 1);

/**
 * Lo más lejos, en grados de latitud, que puede quedar del origen algo que se mide en su plano.
 * A 0,15° del origen, en la latitud de Estaca de Bares (43,8° N, lo más al norte de España), una
 * distancia sale como mucho un 0,26 % más larga o más corta (`errorDelPlano`).
 */
export const LATITUD_DEL_PLANO = 0.15;

/**
 * Lado, en grados, de la rejilla a la que se ajusta el origen de un plano que sigue a lo que se
 * ve (`origenCerca`). Con 0,1° (unos 11 km) mover el mapa dentro de una casilla no cambia el
 * origen, y lo que se ve cerca del centro de la vista queda a menos de `LATITUD_DEL_PLANO`.
 */
export const PASO_DEL_ORIGEN = 0.1;

/** El centro de la casilla de `PASO_DEL_ORIGEN` en que cae un valor, sin ruido de coma flotante. */
const centroDeCasilla = (valor: number): number =>
  Math.round((Math.floor(valor / PASO_DEL_ORIGEN) + 0.5) * PASO_DEL_ORIGEN * 1e6) / 1e6;

/**
 * El origen de un plano para calcular alrededor de `punto`: el centro de la casilla de la rejilla
 * de `PASO_DEL_ORIGEN` en que cae. Dos puntos de la misma casilla dan el mismo origen, así que lo
 * que se dibuja en ese plano no se mueve al mover el mapa dentro de ella.
 */
export const origenCerca = (punto: Coordenada): Coordenada => ({
  longitud: centroDeCasilla(punto.longitud),
  latitud: centroDeCasilla(punto.latitud),
});

/** Si `punto` queda lo bastante cerca del origen para medirlo en su plano (`LATITUD_DEL_PLANO`). */
export const cabeEnElPlano = (origen: Coordenada, punto: Coordenada): boolean =>
  Math.abs(punto.latitud - origen.latitud) <= LATITUD_DEL_PLANO;
