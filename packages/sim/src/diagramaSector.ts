import * as Schema from "effect/Schema";

import { diferenciaDeRumbo, type Malla, puntosDe, rumboDe, type Simulacion } from "./simulacion.ts";

/**
 * Los sectores de una estación base: hacia dónde apunta cada uno y la forma de su haz. Los
 * azimuts van en grados desde el norte hacia el este.
 */
export const ParamsDiagramaSector = Schema.Struct({
  azimuts: Schema.Array(Schema.Finite).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
  /** Ancho del haz a −3 dB. */
  anchoHazGrados: Schema.Finite.check(Schema.isGreaterThan(0)),
  /** Lo más que pierde fuera del haz: la relación delante-detrás. */
  atenuacionMaximaDb: Schema.Finite.check(Schema.isGreaterThan(0)),
});
export type ParamsDiagramaSector = typeof ParamsDiagramaSector.Type;

/** La antena de sector típica del 3GPP (TR 38.901): 65° de haz y 30 dB delante-detrás. */
export const SECTOR_TIPICO = { anchoHazGrados: 65, atenuacionMaximaDb: 30 } as const;

export type ResultadoDiagramaSector = {
  /**
   * Ganancia de cada sector hacia cada punto, en dB respecto a su eje (0 en el eje, negativa
   * fuera). El sector `k` ocupa `[k · puntos, (k + 1) · puntos)`.
   */
  readonly ganancia: Float64Array;
  /** Para cada punto, el sector que más ganancia le da; en un empate, el primero. */
  readonly sector: Uint8Array;
  /** Para cada punto, la ganancia de ese sector. */
  readonly gananciaMaxima: Float64Array;
};

/** A(φ) = −mín(12 · (φ / θ₃dB)², Aₘ), con φ la desviación respecto al eje en grados. */
export const gananciaSector = (desviacion: number, anchoHaz: number, maxima: number): number =>
  -Math.min(12 * (desviacion / anchoHaz) ** 2, maxima);

/**
 * Diagrama de radiación horizontal de una antena de sector, el modelo del 3GPP (TR 38.901,
 * tabla 7.3-1): cuánto pierde cada sector según la dirección. Solo depende del rumbo de cada
 * punto, no de su distancia.
 */
export const diagramaSector: Simulacion<ParamsDiagramaSector, ResultadoDiagramaSector> = {
  id: "diagrama-sector",
  version: "1",
  params: ParamsDiagramaSector,
  ejecutar: (p: ParamsDiagramaSector, malla: Malla): ResultadoDiagramaSector => {
    const n = puntosDe(malla);
    const ganancia = new Float64Array(p.azimuts.length * n);
    const sector = new Uint8Array(n);
    const gananciaMaxima = new Float64Array(n).fill(-Infinity);
    for (let i = 0; i < n; i++) {
      const rumbo = rumboDe(malla, i);
      for (const [k, azimut] of p.azimuts.entries()) {
        const g = gananciaSector(
          diferenciaDeRumbo(rumbo, azimut),
          p.anchoHazGrados,
          p.atenuacionMaximaDb,
        );
        ganancia[k * n + i] = g;
        if (g > (gananciaMaxima[i] ?? -Infinity)) {
          gananciaMaxima[i] = g;
          sector[i] = k;
        }
      }
    }
    return { ganancia, sector, gananciaMaxima };
  },
};
