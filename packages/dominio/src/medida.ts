import * as Schema from "effect/Schema";

import { Coordenada } from "./area.ts";
import { Mhz } from "./banda.ts";
import { Compania } from "./compania.ts";

/** Generación de la red a la que estaba conectado el móvil. */
export const TipoDeRed = Schema.Literals(["2g", "3g", "4g", "5g"]);
export type TipoDeRed = typeof TipoDeRed.Type;

const entre = (minimo: number, maximo: number) =>
  Schema.isBetween({ minimum: minimo, maximum: maximo });

/**
 * Los números de la señal que se leen en el modo de información. Los márgenes son los que
 * admite la norma para 4G y 5G (3GPP TS 36.133 y 38.133): un valor fuera de ellos es un error
 * de lectura, no una señal.
 */
export const LecturaDeSenal = Schema.Struct({
  compania: Compania,
  red: TipoDeRed,
  /** Banda en la que estaba conectado, si se sabe. */
  mhz: Schema.NullOr(Mhz),
  /** Potencia de la señal (RSRP), en dBm. */
  rsrpDbm: Schema.Finite.pipe(Schema.check(entre(-156, -31))),
  /** Calidad de la señal (RSRQ), en dB, si la pantalla la enseña. */
  rsrqDb: Schema.NullOr(Schema.Finite.pipe(Schema.check(entre(-43, 20)))),
  /** Identificador físico de la celda (PCI), si la pantalla lo enseña. */
  pci: Schema.NullOr(Schema.Int.pipe(Schema.check(entre(0, 1007)))),
});
export type LecturaDeSenal = typeof LecturaDeSenal.Type;

/**
 * Medida que la persona registra en su dispositivo a partir de una captura. Es una aportación,
 * así que lleva identificador, versión del esquema, fecha y origen (ADR 0007).
 */
export const MedidaPropia = Schema.Struct({
  tipo: Schema.tag("propia"),
  id: Schema.String,
  version: Schema.Literal(1),
  /** Cuándo se registró, en milisegundos. */
  creadaEl: Schema.Finite,
  origen: Schema.Literal("captura"),
  punto: Coordenada,
  senal: LecturaDeSenal,
});
export type MedidaPropia = typeof MedidaPropia.Type;

/**
 * Medida que trae Celda para enseñar cómo funciona. No es de nadie ni es una aportación: no
 * tiene identificador, fecha ni origen, y no se guarda en el dispositivo.
 */
export const MedidaDeEjemplo = Schema.Struct({
  tipo: Schema.tag("ejemplo"),
  /** Dónde se supone tomada, dicho para las personas. */
  lugar: Schema.String,
  punto: Coordenada,
  senal: LecturaDeSenal,
});
export type MedidaDeEjemplo = typeof MedidaDeEjemplo.Type;

/**
 * Lectura de la señal en un punto. Siempre es propia o de ejemplo, nunca las dos. El
 * discriminante es `tipo` y no `_tag`, como en el resto del dominio, por Convex.
 */
export const Medida = Schema.Union([MedidaPropia, MedidaDeEjemplo]);
export type Medida = typeof Medida.Type;

/** Las medidas de la persona. Una medida de ejemplo nunca cuenta como suya (historia 49). */
export const medidasPropias = (medidas: ReadonlyArray<Medida>): ReadonlyArray<MedidaPropia> =>
  medidas.filter((medida): medida is MedidaPropia => medida.tipo === "propia");

/**
 * La medida de ejemplo de Celda. Los números son inventados, pero verosímiles para un móvil de
 * Movistar en 4G en el centro de Barcelona.
 */
export const MEDIDA_DE_EJEMPLO: MedidaDeEjemplo = {
  tipo: "ejemplo",
  lugar: "Plaça de Catalunya, Barcelona",
  punto: { longitud: 2.1701, latitud: 41.3871 },
  senal: { compania: "movistar", red: "4g", mhz: 1800, rsrpDbm: -95, rsrqDb: -11, pci: 212 },
};

/** Cómo es la potencia de la señal (RSRP), por tramos de 10 dB. */
export type NivelDePotencia = "excelente" | "buena" | "regular" | "mala";

/**
 * Tramos habituales de RSRP en 4G. Son una regla práctica, no una norma: ver
 * docs/investigacion/modo-de-informacion.md.
 */
export const potenciaDeLaSenal = (rsrpDbm: number): NivelDePotencia => {
  if (rsrpDbm >= -80) return "excelente";
  if (rsrpDbm > -90) return "buena";
  if (rsrpDbm > -100) return "regular";
  return "mala";
};

/** Cómo es la calidad de la señal (RSRQ). */
export type NivelDeCalidad = "buena" | "regular" | "mala";

/** Tramos habituales de RSRQ en 4G, con la misma fuente que los de la potencia. */
export const calidadDeLaSenal = (rsrqDb: number): NivelDeCalidad => {
  if (rsrqDb >= -10) return "buena";
  if (rsrqDb >= -15) return "regular";
  return "mala";
};
