import * as Schema from "effect/Schema";

import { distanciaDe, type Malla, puntosDe, type Simulacion } from "./simulacion.ts";

/** La banda en que emite la estación base. */
export const ParamsPerdidasUrbanas = Schema.Struct({
  frecuenciaMhz: Schema.Finite.check(Schema.isGreaterThan(0)),
});
export type ParamsPerdidasUrbanas = typeof ParamsPerdidasUrbanas.Type;

/**
 * Por debajo de esta distancia el modelo no vale: se calcula como si el punto estuviera a 35 m,
 * la distancia mínima entre estación base y móvil del TR 36.942.
 */
export const DISTANCIA_MINIMA_M = 35;

/** Lo que se pierde de más cada vez que la distancia se multiplica por diez, en dB. */
export const PENDIENTE_DB_POR_DECADA = 37.6;

export type ResultadoPerdidasUrbanas = {
  /** Pérdida de propagación desde el origen hasta cada punto, en dB. */
  readonly perdidaDb: Float64Array;
};

/**
 * L = 128,1 + 37,6 · log₁₀(d / 1 km) + 21 · log₁₀(f / 2000 MHz), en dB.
 *
 * Es el modelo de macrocelda urbana del 3GPP (TR 36.942, apartado 4.5.2), con la antena a 15 m
 * sobre los tejados: 40 · (1 − 0,004 · 15) · log₁₀ d − 18 · log₁₀ 15 + 21 · log₁₀ f + 80. A
 * 2000 MHz da los 128,1 dB de la fórmula corta, y a 900 MHz, unos 120,9.
 */
export const perdidaUrbana = (metros: number, frecuenciaMhz: number): number =>
  128.1 +
  PENDIENTE_DB_POR_DECADA * Math.log10(Math.max(metros, DISTANCIA_MINIMA_M) / 1000) +
  21 * Math.log10(frecuenciaMhz / 2000);

/**
 * Pérdidas de propagación en ciudad desde una estación base en el origen hasta cada punto de la
 * malla. Solo depende de la distancia, no del rumbo.
 */
export const perdidasUrbanas: Simulacion<ParamsPerdidasUrbanas, ResultadoPerdidasUrbanas> = {
  id: "perdidas-urbanas",
  version: "1",
  params: ParamsPerdidasUrbanas,
  ejecutar: (p: ParamsPerdidasUrbanas, malla: Malla): ResultadoPerdidasUrbanas => {
    const perdidaDb = new Float64Array(puntosDe(malla));
    for (let i = 0; i < perdidaDb.length; i++) {
      perdidaDb[i] = perdidaUrbana(distanciaDe(malla, i), p.frecuenciaMhz);
    }
    return { perdidaDb };
  },
};
