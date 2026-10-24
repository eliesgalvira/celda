import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { CapaIlegible } from "./capa.ts";
import { type MedidaDeExposicion, NIVEL_DE_REFERENCIA_MAS_BAJO } from "./exposicion.ts";
import type { Lugar } from "./municipio.ts";
import { selloDeVersion } from "./provincias.ts";

/**
 * El baremo de exposición de una provincia (ADR 0030): con qué se compara cada medida de
 * exposición del ministerio de sus emplazamientos, teniendo en cuenta la distancia a la antena.
 *
 * Cada medida es un punto con `x = log10(distancia en m)` e `y = 10 · log10(µW/cm²)`, en dB
 * respecto a 1 µW/cm² (`puntoDeMedida`). La recta `tipica` da la medida típica de la provincia a
 * cada distancia, y la recta `separacion`, cuánto se aparta de ella a esa distancia la mitad de
 * las medidas. La desviación de una medida (`desviacionDe`) es lo que se aparta de la típica en
 * esas unidades. Una zona, la provincia o uno de sus municipios, guarda las desviaciones de los
 * percentiles 1 a 99 de sus medidas, y con ellas se dice de cada 100 medidas de la zona cuántas
 * quedan por debajo de una (`compararMedida`). Lleva además la medida más alta de toda España y
 * cuántas no llegan al 1 % del nivel de referencia (`MedidasDeEspana`), para situar cualquier medida.
 *
 * Lo calcula el montaje de las capas, en el build de Vercel, con las fichas de cada versión que
 * monta (`packages/publicacion/src/baremo.ts`). No está en R2.
 */

/**
 * Sube cuando cambia lo que sale del cálculo. La web lee los baremos por un nombre que lo lleva
 * (`ficheroDeBaremo`), así que subirlo cambia la web y el flujo de despliegue vuelve a montar las
 * capas con el cálculo nuevo (ADR 0030).
 */
export const FORMATO_DEL_BAREMO = 2;

/** Una medida a menos de 1 m cuenta como tomada a 1 m: el registro da las distancias en metros. */
export const DISTANCIA_MINIMA_METROS = 1;

/**
 * Una medida de 0 µW/cm² cuenta para el logaritmo como de 0,00001, la última cifra que publica el
 * registro. Las rectas y los percentiles solo dependen del orden de las medidas, así que el
 * resultado no depende de este valor mientras quede por debajo del menor publicado, 0,00003.
 */
export const VALOR_MINIMO = 0.00001;

/**
 * De cuántos emplazamientos tiene que tener medidas una zona para compararse con ella. Las medidas
 * de un mismo emplazamiento se parecen mucho entre sí, así que cada emplazamiento cuenta como una
 * sola observación. Con 97, la proporción que da la web cae a menos de 10 puntos de la de verdad
 * en el 95 % de los casos, también en la mitad, donde más se aparta: 1,96 · √(0,25 / 97) < 0,1.
 */
export const EMPLAZAMIENTOS_MINIMOS = 97;

/** Una desviación por percentil, del 1 al 99: la web dice «de cada 100». */
export const CORTES = 99;

/** Una recta en función de la distancia: `nivel + pendiente · log10(distancia en m)`. */
export const RectaDelBaremo = Schema.Struct({ nivel: Schema.Finite, pendiente: Schema.Finite });
export type RectaDelBaremo = typeof RectaDelBaremo.Type;

/** Una zona con la que se comparan medidas: la provincia o un municipio, por su código del INE. */
export const ZonaDelBaremo = Schema.Struct({
  codigo: Schema.String,
  medidas: Schema.Int,
  emplazamientos: Schema.Int,
  /** La desviación de los percentiles 1 a 99 de sus medidas, de menor a mayor. */
  cortes: Schema.Array(Schema.Finite).pipe(
    Schema.check(Schema.isMinLength(CORTES), Schema.isMaxLength(CORTES)),
  ),
});
export type ZonaDelBaremo = typeof ZonaDelBaremo.Type;

/** El 1 % del nivel de referencia más bajo, en µW/cm². */
export const UNO_POR_CIENTO_DEL_NIVEL = NIVEL_DE_REFERENCIA_MAS_BAJO / 100;

/**
 * Las medidas de toda España en la versión, contando una vez la que publican varias estaciones
 * base de un emplazamiento, como en las zonas. Las de una ficha sin provincia también cuentan.
 */
export const MedidasDeEspana = Schema.Struct({
  medidas: Schema.Int,
  /** Cuántas no llegan al 1 % del nivel de referencia más bajo (`UNO_POR_CIENTO_DEL_NIVEL`). */
  bajoElUnoPorCiento: Schema.Int,
  /** La más alta, en µW/cm², tal como la publica el registro. */
  maxima: Schema.Finite,
});
export type MedidasDeEspana = typeof MedidasDeEspana.Type;

/** De cada 100 medidas de España, cuántas no llegan al 1 % del nivel de referencia. */
export const bajoElUnoDeCadaCien = (espana: MedidasDeEspana): number =>
  Math.floor((100 * espana.bajoElUnoPorCiento) / espana.medidas);

export const Baremo = Schema.Struct({
  formato: Schema.Literal(FORMATO_DEL_BAREMO),
  /** La versión de cuyas fichas sale. */
  version: Schema.String,
  provincia: Schema.String,
  /** La medida típica de la provincia a cada distancia, en dB respecto a 1 µW/cm². */
  tipica: RectaDelBaremo,
  /** El logaritmo de lo que se aparta de la típica la mitad de las medidas a cada distancia, en dB. */
  separacion: RectaDelBaremo,
  /** La provincia como zona, si tiene medidas de bastantes emplazamientos. */
  zonaProvincial: Schema.NullOr(ZonaDelBaremo),
  /** Los municipios con medidas de bastantes emplazamientos, por código. */
  municipios: Schema.Array(ZonaDelBaremo),
  espana: MedidasDeEspana,
});
export type Baremo = typeof Baremo.Type;

const BaremoEnJson = Schema.fromJsonString(Baremo);
const codificarBaremo = Schema.encodeSync(BaremoEnJson);
const decodificarBaremo = Schema.decodeUnknownResult(BaremoEnJson);

/** El contenido del fichero de un baremo. Los mismos datos dan siempre los mismos bytes. */
export const generarBaremo = (baremo: Baremo): string => codificarBaremo(baremo);

/** El baremo de una provincia en una versión: `baremos/2/2026-10-20T22:30:02Z/08.json`. */
export const ficheroDeBaremo = (version: string, provincia: string): string =>
  `baremos/${FORMATO_DEL_BAREMO}/${selloDeVersion(version)}/${provincia}.json`;

/** Lee el baremo de `provincia` en `version`, y falla si es de otra. */
export const leerBaremo = (
  contenido: string,
  version: string,
  provincia: string,
): Result.Result<Baremo, CapaIlegible> =>
  decodificarBaremo(contenido).pipe(
    Result.mapError((error) => new CapaIlegible({ motivo: error.message })),
    Result.flatMap((baremo) =>
      baremo.version === version && baremo.provincia === provincia
        ? Result.succeed(baremo)
        : Result.fail(
            new CapaIlegible({
              motivo: `se esperaba el baremo de ${provincia} en ${version} y es de ${baremo.provincia} en ${baremo.version}`,
            }),
          ),
    ),
  );

/** Una medida en el baremo: el logaritmo de su distancia en m y su valor en dB respecto a 1 µW/cm². */
export interface PuntoDeMedida {
  readonly x: number;
  readonly y: number;
}

/** El punto de una medida en el baremo. */
export const puntoDeMedida = (
  medida: Pick<MedidaDeExposicion, "distanciaMetros" | "microvatiosPorCm2">,
): PuntoDeMedida => ({
  x: Math.log10(Math.max(medida.distanciaMetros, DISTANCIA_MINIMA_METROS)),
  y: 10 * Math.log10(Math.max(medida.microvatiosPorCm2, VALOR_MINIMO)),
});

/** El valor de una recta del baremo en `x`, el logaritmo de una distancia (`puntoDeMedida`). */
export const enLaRecta = (recta: RectaDelBaremo, x: number): number =>
  recta.nivel + recta.pendiente * x;

/**
 * Lo que se aparta una medida de la típica de su provincia a su distancia, en unidades de lo que
 * se aparta allí la mitad de las medidas: con 1, tanto como la mitad de ellas.
 */
export const desviacionDe = (
  baremo: Pick<Baremo, "tipica" | "separacion">,
  medida: Pick<MedidaDeExposicion, "distanciaMetros" | "microvatiosPorCm2">,
): number => {
  const { x, y } = puntoDeMedida(medida);
  return (y - enLaRecta(baremo.tipica, x)) / 10 ** enLaRecta(baremo.separacion, x);
};

/** Con qué se comparan las medidas de un emplazamiento: su municipio o su provincia. */
export interface ZonaElegida {
  readonly tipo: "municipio" | "provincia";
  /** El municipio o la provincia del lugar del emplazamiento, con su código y su nombre. */
  readonly lugar: NonNullable<Lugar["provincia"]>;
  readonly zona: ZonaDelBaremo;
}

/**
 * La zona con que se comparan las medidas de un emplazamiento de `lugar`: su municipio si tiene
 * medidas de bastantes emplazamientos, y si no, su provincia. Sin ninguna de las dos, no se
 * comparan.
 */
export const zonaDeComparacion = (baremo: Baremo, lugar: Lugar): ZonaElegida | undefined => {
  const { municipio, provincia } = lugar;
  const deMunicipio = baremo.municipios.find((zona) => zona.codigo === municipio?.codigo);
  if (municipio !== null && deMunicipio !== undefined) {
    return { tipo: "municipio", lugar: municipio, zona: deMunicipio };
  }
  return provincia === null || baremo.zonaProvincial === null
    ? undefined
    : { tipo: "provincia", lugar: provincia, zona: baremo.zonaProvincial };
};

/** Cómo queda una medida frente a las de su zona, teniendo en cuenta la distancia. */
export interface MedidaComparada {
  /** De cada 100 medidas de la zona, cuántas quedan por debajo de esta: de 0 a 99. */
  readonly masAltaQue: number;
  /** La medida típica de la zona a su distancia, en µW/cm². */
  readonly tipica: number;
}

/** Compara una medida con las de `zona`, una zona de `baremo`. */
export const compararMedida = (
  baremo: Baremo,
  zona: ZonaDelBaremo,
  medida: Pick<MedidaDeExposicion, "distanciaMetros" | "microvatiosPorCm2">,
): MedidaComparada => {
  const desviacion = desviacionDe(baremo, medida);
  const { x } = puntoDeMedida(medida);
  const mediana = zona.cortes[(CORTES - 1) / 2] ?? 0;
  const tipicaDb = enLaRecta(baremo.tipica, x) + 10 ** enLaRecta(baremo.separacion, x) * mediana;
  return {
    masAltaQue: zona.cortes.filter((corte) => corte < desviacion).length,
    tipica: 10 ** (tipicaDb / 10),
  };
};
