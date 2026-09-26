import * as Schema from "effect/Schema";

import { SECTOR_TIPICO } from "./diagramaSector.ts";
import { DISTANCIA_MINIMA_M, perdidaUrbana } from "./perdidasUrbanas.ts";
import { type Malla, puntosDe, type Simulacion } from "./simulacion.ts";

/** Una estación base en el plano de la malla, con sus sectores. */
export const EstacionSinr = Schema.Struct({
  /** Metros al este y al norte del origen de la malla. */
  este: Schema.Finite,
  norte: Schema.Finite,
  /** Hacia dónde apunta cada sector, en grados desde el norte hacia el este. */
  azimuts: Schema.Array(Schema.Finite).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
  /** Potencia radiada por sector en el eje del haz (PIRE), en dBm. */
  potenciaDbm: Schema.Finite,
});
export type EstacionSinr = typeof EstacionSinr.Type;

/**
 * Las estaciones base de una compañía en una banda, con reutilización 1: todos sus sectores
 * emiten en la misma frecuencia y se estorban. La ocupación va de 0 a 1 y escala la potencia que
 * llega de los sectores que no dan servicio: con 0 solo queda el ruido.
 */
export const ParamsSinr = Schema.Struct({
  estaciones: Schema.Array(EstacionSinr),
  frecuenciaMhz: Schema.Finite.check(Schema.isGreaterThan(0)),
  ocupacion: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  /** Ruido del receptor en todo el ancho de banda, en dBm. */
  ruidoDbm: Schema.Finite,
});
export type ParamsSinr = typeof ParamsSinr.Type;

export type ResultadoSinr = {
  /**
   * Relación entre la señal útil y la interferencia más el ruido en cada punto, en dB. `NaN` si
   * no hay ninguna estación.
   */
  readonly sinrDb: Float64Array;
  /** Índice en `estaciones` de la que da servicio a cada punto; −1 si no hay ninguna. */
  readonly estacion: Int32Array;
  /** Sector de esa estación que le da servicio. */
  readonly sector: Uint8Array;
};

/**
 * Valores habituales de una macrocelda urbana en los estudios del 3GPP (TR 36.942): 43 dBm por
 * sector con 15 dBi de antena, y un móvil con 9 dB de figura de ruido en 10 MHz, que da
 * −174 + 70 + 9 = −95 dBm de ruido. Ninguna fuente publica la potencia de las estaciones de
 * Barcelona. Entre emplazamientos tan juntos manda la interferencia y la potencia apenas cambia
 * la SINR: solo pesa donde la señal se acerca al ruido.
 */
export const RED_TIPICA = { potenciaDbm: 58, ruidoDbm: -95 } as const;

const aLineal = (db: number): number => 10 ** (db / 10);

/** −12 · ln(10) / 10: el diagrama de sector en unidades naturales, para usar `Math.exp`. */
const CURVA_SECTOR = (-1.2 * Math.LN10) / SECTOR_TIPICO.anchoHazGrados ** 2;
/** Por encima de este desvío el diagrama ya da la atenuación máxima. */
const DESVIO_SATURADO =
  SECTOR_TIPICO.anchoHazGrados * Math.sqrt(SECTOR_TIPICO.atenuacionMaximaDb / 12);
const GANANCIA_SATURADA = aLineal(-SECTOR_TIPICO.atenuacionMaximaDb);

/**
 * La SINR de una compañía en una banda (vista de interferencia). En cada punto de la malla, cada
 * sector de cada estación llega con su potencia, más la ganancia del diagrama de sector del 3GPP
 * hacia ese punto (`gananciaSector`, 65° y 30 dB) y menos las pérdidas urbanas del TR 36.942
 * (`perdidaUrbana`). Da servicio el sector que llega con más potencia. Los demás, también los de
 * la misma estación, son interferencia, multiplicada por la ocupación: con la red medio vacía
 * solo se usa la mitad de los recursos. SINR = S / (ocupación · ΣI + N).
 *
 * Calcula en potencias lineales y sin llamar a esas dos funciones, que es lo que la deja ir a
 * tiempo en el móvil. La prueba la compara con ellas.
 */
export const sinr: Simulacion<ParamsSinr, ResultadoSinr> = {
  id: "sinr",
  version: "1",
  params: ParamsSinr,
  ejecutar: (p: ParamsSinr, malla: Malla): ResultadoSinr => {
    const n = puntosDe(malla);
    const sinrDb = new Float64Array(n).fill(Number.NaN);
    const estacion = new Int32Array(n).fill(-1);
    const sector = new Uint8Array(n);
    const ruido = aLineal(p.ruidoDbm);
    const m = p.estaciones.length;
    const x = Float64Array.from(p.estaciones, (e) => e.este);
    const y = Float64Array.from(p.estaciones, (e) => e.norte);
    // Lo que llegaría de cada estación a 1 km en el eje: su potencia menos 128,1 dB y la
    // corrección por frecuencia de `perdidaUrbana`.
    const aUnKm = Float64Array.from(p.estaciones, (e) =>
      aLineal(e.potenciaDbm - perdidaUrbana(1000, p.frecuenciaMhz)),
    );
    const minima = (DISTANCIA_MINIMA_M / 1000) ** 2;
    for (let i = 0; i < n; i++) {
      const este = malla.este[i] ?? 0;
      const norte = malla.norte[i] ?? 0;
      let total = 0;
      let mejor = 0;
      for (let s = 0; s < m; s++) {
        const de = este - (x[s] ?? 0);
        const dn = norte - (y[s] ?? 0);
        // (d / 1 km)^−3,76, con d al menos la distancia mínima del modelo.
        const atenuacion = Math.max((de * de + dn * dn) / 1e6, minima) ** -1.88;
        const base = (aUnKm[s] ?? 0) * atenuacion;
        const rumbo = (Math.atan2(de, dn) * 180) / Math.PI;
        const azimuts = p.estaciones[s]?.azimuts ?? [];
        for (let k = 0; k < azimuts.length; k++) {
          const giro = rumbo - (azimuts[k] ?? 0);
          const desvio = Math.abs(giro - 360 * Math.round(giro / 360));
          const recibida =
            base *
            (desvio >= DESVIO_SATURADO ? GANANCIA_SATURADA : Math.exp(CURVA_SECTOR * desvio ** 2));
          total += recibida;
          if (recibida > mejor) {
            mejor = recibida;
            estacion[i] = s;
            sector[i] = k;
          }
        }
      }
      if (mejor > 0) {
        sinrDb[i] = 10 * Math.log10(mejor / (p.ocupacion * (total - mejor) + ruido));
      }
    }
    return { sinrDb, estacion, sector };
  },
};
