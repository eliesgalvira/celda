import * as Schema from "effect/Schema";

/**
 * Una medida de exposición del ministerio: un punto alrededor de la estación base donde se midió
 * la exposición a campos electromagnéticos, tal como lo publica su ficha del registro oficial en
 * «Niveles medidos en el entorno». Las toman los técnicos de las Jefaturas de Inspección o las
 * certifican las compañías, y el ministerio no dice cuándo.
 *
 * Sirve para comparar con los niveles de referencia legales, el más restrictivo de 200 µW/cm².
 * Nada dice de cómo funciona un móvil en ese punto: 0,02 µW/cm² en 1800 MHz son unos −34 dBm,
 * millones de veces lo que necesita. Por eso es otro tipo que la `Medida` de Celda.
 */
export const MedidaDeExposicion = Schema.Struct({
  /** Distancia del punto de medida a la estación base, en metros. */
  distanciaMetros: Schema.Finite,
  /**
   * Dirección del punto de medida vista desde la estación base, en grados desde el norte
   * geográfico en el sentido de las agujas del reloj. Dice dónde estuvo el técnico, y nada de
   * hacia dónde miran los sectores.
   */
  acimutGrados: Schema.Finite,
  /** Densidad de potencia medida, en µW/cm². */
  microvatiosPorCm2: Schema.Finite,
});
export type MedidaDeExposicion = typeof MedidaDeExposicion.Type;

/**
 * El nivel de referencia más bajo del anexo II del Real Decreto 1066/2001, en µW/cm²: el de 10 a
 * 400 MHz, donde está la radio FM. La norma compara con él una medida que suma todas las
 * frecuencias (investigación 09, apartado 2.2).
 */
export const NIVEL_DE_REFERENCIA_MAS_BAJO = 200;

/**
 * Lo que identifica una medida: su distancia, su acimut y su valor. Dos estaciones base o dos
 * registros que publican la misma medida publican una sola.
 */
export const claveDeMedida = (medida: MedidaDeExposicion): string =>
  `${medida.distanciaMetros}|${medida.acimutGrados}|${medida.microvatiosPorCm2}`;

/** Orden estable de las medidas: por acimut, por distancia y por valor. */
export const compararMedidas = (a: MedidaDeExposicion, b: MedidaDeExposicion): number =>
  a.acimutGrados - b.acimutGrados ||
  a.distanciaMetros - b.distanciaMetros ||
  a.microvatiosPorCm2 - b.microvatiosPorCm2;

/**
 * Las medidas en el orden de `compararMedidas`, que mira todos sus campos. Como las bandas
 * (`bandasEnOrden`), el registro las da en otro orden de una petición a otra.
 */
export const medidasEnOrden = (
  medidas: ReadonlyArray<MedidaDeExposicion>,
): ReadonlyArray<MedidaDeExposicion> => medidas.toSorted(compararMedidas);
