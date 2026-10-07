import * as Schema from "effect/Schema";

import { Cambio } from "./aportacion.ts";
import { Coordenada } from "./area.ts";
import { Banda, compararBandas, compararTexto } from "./banda.ts";
import { Compania } from "./compania.ts";
import {
  Confianza,
  Conflicto,
  type EmplazamientoSinEstaciones,
  Estado,
  type EstacionBase,
} from "./emplazamiento.ts";
import { MedidaDeExposicion } from "./exposicion.ts";
import { Lugar } from "./municipio.ts";
import { Afirmacion, Fuente, type Observacion } from "./observacion.ts";

/**
 * Un hecho del historial de un registro del ministerio, tal como lo cuenta la ficha (ADR 0027):
 *
 * - `en-el-registro-antes`: el punto de partida del historial. Lo que dice el registro ya estaba
 *   en él en `fecha`, y quizá mucho antes. No es una fecha de alta ni de puesta en servicio.
 * - `alta`: Celda vio el registro por primera vez en `fecha`, y no estaba en `antes`, la última
 *   vez que pidió su cuadro. Sin `antes`, era la primera vez que lo pedía.
 * - `cambio-de-listado`: cambió su dirección, su posición o su código.
 * - `cambio-de-ficha`: cambiaron sus bandas o sus medidas de exposición.
 * - `sin-ficha`: el registro dijo que no tiene su ficha («Código de emplazamiento no válido»).
 * - `retirada`: faltó en dos barridos seguidos.
 * - `vuelta`: volvió a salir en el listado tras retirarse.
 *
 * `fecha` es cuándo lo vio Celda. `antes`, si está, es la última vez que vio lo anterior: el
 * cambio llegó al registro entre las dos.
 */
export const HechoDeFicha = Schema.Struct({
  tipo: Schema.Literals([
    "en-el-registro-antes",
    "alta",
    "cambio-de-listado",
    "cambio-de-ficha",
    "sin-ficha",
    "retirada",
    "vuelta",
  ]),
  fecha: Schema.Finite,
  antes: Schema.optionalKey(Schema.Finite),
});
export type HechoDeFicha = typeof HechoDeFicha.Type;

/** De dónde sale un dato de la ficha: la observación de una fuente, con su fecha y su enlace. */
export const OrigenDeFicha = Schema.Struct({
  fuente: Fuente,
  /** Identificador en la fuente, como «TELEFONICA MOVILES ESPAÑA, S.A.U. - 0802532». */
  clave: Schema.String,
  /** Enlace a lo que publica la fuente sobre esta estación base. */
  url: Schema.String,
  /** Desde cuándo lo dice la fuente, en milisegundos. */
  fecha: Schema.Finite,
  afirma: Afirmacion,
  /**
   * El historial del registro en la fuente, del hecho más viejo al más nuevo (ADR 0027). Desde el
   * formato 6. Solo el registro oficial tiene hechos; de las demás fuentes va vacío. Cómo se dice
   * `fecha` con él: `desdeDelOrigen`.
   */
  historial: Schema.Array(HechoDeFicha),
});
export type OrigenDeFicha = typeof OrigenDeFicha.Type;

/** Los hechos que dicen desde cuándo dice el registro lo que dice. */
const ESTABLECEN: ReadonlySet<HechoDeFicha["tipo"]> = new Set([
  "en-el-registro-antes",
  "alta",
  "cambio-de-listado",
  "cambio-de-ficha",
]);

/**
 * Cómo decir desde cuándo dice la fuente lo que dice (ADR 0027):
 *
 * - `antes-del`: lo que dice ya estaba en el registro en `fecha`, y Celda no sabe desde cuándo:
 *   estaba cuando empezó el historial, o salió en la primera vez que Celda pidió su cuadro, y no
 *   ha cambiado. La web dice «en el registro antes del <fecha>», nunca «desde».
 * - `desde`: lo vio Celda por primera vez en `fecha`, y si hay `antes`, llegó entre `antes` y
 *   `fecha`. La web dice «desde el <fecha>».
 *
 * Sin ningún hecho que lo diga, como en un origen de la comunidad, es `desde` con la `fecha` del
 * origen.
 */
export const desdeDelOrigen = (
  origen: Pick<OrigenDeFicha, "fecha" | "historial">,
):
  | { readonly tipo: "antes-del"; readonly fecha: number }
  | { readonly tipo: "desde"; readonly fecha: number; readonly antes?: number } => {
  const ultimo = origen.historial.findLast((hecho) => ESTABLECEN.has(hecho.tipo));
  if (ultimo === undefined) return { tipo: "desde", fecha: origen.fecha };
  if (
    ultimo.tipo === "en-el-registro-antes" ||
    (ultimo.tipo === "alta" && ultimo.antes === undefined)
  ) {
    return { tipo: "antes-del", fecha: ultimo.fecha };
  }
  return ultimo.antes === undefined
    ? { tipo: "desde", fecha: ultimo.fecha }
    : { tipo: "desde", fecha: ultimo.fecha, antes: ultimo.antes };
};

/** Una estación base tal como la cuenta la ficha: sus bandas y las observaciones de las que sale. */
export const EstacionDeFicha = Schema.Struct({
  compania: Compania,
  codigos: Schema.Array(Schema.String),
  bandas: Schema.Array(Banda),
  origenes: Schema.Array(OrigenDeFicha),
  /**
   * Si el registro oficial no tiene ficha de ella («Código de emplazamiento no válido»), la fecha
   * en que se comprobó. Falta si la tiene.
   */
  sinFichaEnRegistro: Schema.optionalKey(Schema.Finite),
  /**
   * Si Celda aún no ha leído la ficha del registro de alguna de sus observaciones del registro, así
   * que puede que falten bandas. Con `false` y sin bandas, Celda ha leído su ficha y el registro
   * no lista ninguna, o el registro no tiene ficha (`sinFichaEnRegistro`). En una estación base
   * que no está en el registro es `false`. Desde el formato 7 (#41).
   */
  bandasSinLeer: Schema.Boolean,
  /**
   * Las medidas de exposición del ministerio que publica el registro oficial en las fichas de sus
   * observaciones, por acimut. El ministerio no las fecha: desde cuándo las publica es la `fecha`
   * de esos orígenes. Una lista vacía es que el registro no publica ninguna. Falta si Celda aún no
   * ha leído sus fichas desde que las guarda (#73): la relectura de toda España las trae en unas
   * noches, y hasta entonces la ficha no sabe si las hay.
   */
  medidasDeExposicion: Schema.optionalKey(Schema.Array(MedidaDeExposicion)),
});
export type EstacionDeFicha = typeof EstacionDeFicha.Type;

/**
 * Una corrección de la comunidad aceptada por la moderación, tal como llega a la ficha (ADR 0020):
 * lo que cambia, cuántas personas la sostienen y desde cuándo. Se enseña al lado de lo que dice el
 * registro oficial y nunca lo sustituye. Es dato propio de Celda, con la dedicación CC0 (ADR 0021).
 * La escribe la ingesta nocturna con lo aceptado (#57).
 */
export const CorreccionDeFicha = Schema.Struct({
  /**
   * Identificador estable de la corrección publicada: el de la primera corrección propuesta
   * aceptada que la sostiene. Una corroboración lo cita.
   */
  clave: Schema.String,
  cambio: Cambio,
  /**
   * Cuántas personas la sostienen: identidades distintas con una corrección propuesta igual o una
   * corroboración aceptadas. Al menos una.
   */
  personas: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
  /** Cuándo se aceptó la primera, en milisegundos. */
  aceptadaEl: Schema.Finite,
  licencia: Schema.Literal("CC0-1.0"),
});
export type CorreccionDeFicha = typeof CorreccionDeFicha.Type;

/**
 * Lo que el panel cuenta de un emplazamiento al seleccionarlo. Se publica con la capa, en un lote
 * de fichas de la misma versión. `version` es su marca de agua: nunca es posterior a la capa de
 * la que sale, pero la web puede acabar leyendo la de una capa más reciente que la del mapa.
 */
export const Ficha = Schema.Struct({
  clave: Schema.String,
  posicion: Coordenada,
  /** Dirección tal como la publica la fuente, con el municipio y la provincia al final. */
  direccion: Schema.String,
  /** El municipio tal como lo escribe la fuente en la dirección, en mayúsculas. */
  municipio: Schema.String,
  /**
   * El municipio y la provincia del IGN en que cae, que pone el publicador por punto en polígono
   * (ADR 0017). Las fichas publicadas antes no lo llevan.
   */
  lugar: Schema.optionalKey(Lugar),
  estado: Estado,
  confianza: Confianza,
  conflictos: Schema.Array(Conflicto),
  estaciones: Schema.Array(EstacionDeFicha),
  /**
   * Las correcciones de la comunidad aceptadas en este emplazamiento (ADR 0020). Opcional: las
   * fichas publicadas antes del buzón no la llevan, y sin correcciones tampoco.
   */
  correcciones: Schema.optionalKey(Schema.Array(CorreccionDeFicha)),
  /** Fecha más reciente de sus observaciones. */
  datosDel: Schema.Finite,
  /** Fecha de la ejecución de ingesta que cambió el emplazamiento por última vez. */
  version: Schema.Finite,
});
export type Ficha = typeof Ficha.Type;

/** Una estación base del emplazamiento con las observaciones de las que sale, ya leídas. */
export interface EstacionConOrigenes {
  readonly estacion: EstacionBase;
  /** Las observaciones de `estacion.observaciones` que se han encontrado, en su orden. */
  readonly observaciones: ReadonlyArray<
    Pick<Observacion, "fuente" | "clave" | "url" | "fecha" | "afirma"> & {
      readonly historial: ReadonlyArray<HechoDeFicha>;
    }
  >;
}

/**
 * La ficha de un emplazamiento con `version`, la fecha en que cambió por última vez. Las
 * estaciones van por compañía y sus bandas por frecuencia, así que las mismas estaciones dan
 * siempre la misma ficha, sea cual sea el orden en que lleguen.
 */
export const fichaDe = (
  emplazamiento: EmplazamientoSinEstaciones,
  version: number,
  estaciones: ReadonlyArray<EstacionConOrigenes>,
): Ficha => ({
  clave: emplazamiento.clave,
  posicion: emplazamiento.posicion,
  direccion: emplazamiento.direccion,
  municipio: emplazamiento.municipio,
  estado: emplazamiento.estado,
  confianza: emplazamiento.confianza,
  conflictos: emplazamiento.conflictos,
  estaciones: estaciones
    .toSorted((a, b) => compararTexto(a.estacion.compania, b.estacion.compania))
    .map(({ estacion, observaciones }) => {
      const deFicha: EstacionDeFicha = {
        compania: estacion.compania,
        codigos: estacion.codigos,
        bandas: estacion.bandas.toSorted(compararBandas),
        bandasSinLeer: estacion.bandasSinLeer === true,
        origenes: observaciones.map(
          ({ fuente, clave, url, fecha, afirma, historial }): OrigenDeFicha => ({
            fuente,
            clave,
            url,
            fecha,
            afirma,
            historial,
          }),
        ),
      };
      const { sinFichaEnRegistro, medidasDeExposicion } = estacion;
      const conMarca =
        sinFichaEnRegistro === undefined ? deFicha : { ...deFicha, sinFichaEnRegistro };
      return medidasDeExposicion === undefined ? conMarca : { ...conMarca, medidasDeExposicion };
    }),
  datosDel: emplazamiento.datosDel,
  version,
});
