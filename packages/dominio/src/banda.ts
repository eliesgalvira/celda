import * as Schema from "effect/Schema";

import { Compania } from "./compania.ts";

/** Tramo de frecuencias en MHz tal como lo publica la fuente. */
export const Rango = Schema.Struct({
  desdeMhz: Schema.Finite,
  hastaMhz: Schema.Finite,
});
export type Rango = typeof Rango.Type;

/** Bandas que se usan en España, por su frecuencia nominal en MHz. */
export const Mhz = Schema.Literals([700, 800, 900, 1800, 2100, 2600, 3500]);
export type Mhz = typeof Mhz.Type;

/**
 * Banda en la que emite una estación base, sacada de un expediente del Registro Nacional de
 * Frecuencias. `mhz` es una deducción a partir de los rangos y es nulo si no encaja en ninguna.
 */
export const Banda = Schema.Struct({
  referencia: Schema.String,
  compania: Compania,
  rangos: Schema.Array(Rango),
  mhz: Schema.NullOr(Mhz),
  /** Año del expediente, deducido de la referencia. Es una cota inferior, no una fecha de alta. */
  anio: Schema.NullOr(Schema.Int),
});
export type Banda = typeof Banda.Type;

/**
 * Rangos publicados de cada banda. El registro da la de 800 MHz con el rango de subida
 * (832-862), así que se aceptan la subida y la bajada.
 */
const TRAMOS: ReadonlyArray<readonly [Mhz, number, number]> = [
  [700, 758, 788],
  [800, 791, 821],
  [800, 832, 862],
  [900, 925, 960],
  [1800, 1805, 1880],
  [2100, 1900, 1920],
  [2100, 2110, 2170],
  [2600, 2570, 2690],
  [3500, 3400, 3800],
];

const tramoDe = (rango: Rango): Mhz | null =>
  TRAMOS.find(([, desde, hasta]) => rango.desdeMhz >= desde && rango.hastaMhz <= hasta)?.[0] ??
  null;

/** Banda nominal de un expediente. Con dos rangos (3G en 2100) vale el primero que encaje. */
export const mhzDeRangos = (rangos: ReadonlyArray<Rango>): Mhz | null =>
  rangos.map(tramoDe).find((mhz) => mhz !== null) ?? null;

/**
 * Año del expediente. Las referencias tienen la forma `B B -2403167`: provincia y un número
 * que empieza por los dos últimos dígitos del año.
 */
export const anioDeReferencia = (referencia: string): number | null => {
  const numero = /(\d{2})\d{5}\s*$/u.exec(referencia)?.[1];
  return numero === undefined ? null : 2000 + Number(numero);
};

/** Orden estable de las bandas: por frecuencia y, dentro de ella, por referencia. */
export const compararBandas = (a: Banda, b: Banda): number =>
  (a.mhz ?? 99_999) - (b.mhz ?? 99_999) || compararTexto(a.referencia, b.referencia);

/**
 * Orden de textos por código de carácter. No depende de `Intl`, que el runtime de Convex no
 * garantiza, así que da el mismo orden en el servidor y en las pruebas.
 */
export const compararTexto = (a: string, b: string): number => {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
};
