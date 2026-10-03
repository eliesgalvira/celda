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

/** Clave de un emplazamiento, como la publica la capa: «movistar-0802532». */
export const ClaveEmplazamiento = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
);

/**
 * A qué está unida una medida propia: el emplazamiento que le daba servicio, en la posición que
 * publicaba su ficha al registrarla, y el azimut del sector que le daba servicio, si se sabía.
 * La posición va con la medida porque el buzón no tiene los emplazamientos: con ella comprueba
 * que la medida es verosímil, y la moderación la compara con lo publicado.
 */
export const UnidaA = Schema.Struct({
  emplazamiento: ClaveEmplazamiento,
  posicion: Coordenada,
  /** Azimut del sector que daba servicio, en grados desde el norte, o `null` si no se sabía. */
  azimut: Schema.NullOr(Schema.Finite.pipe(Schema.check(entre(0, 360)))),
});
export type UnidaA = typeof UnidaA.Type;

/** Versión del esquema de la medida propia. */
export const ESQUEMA_MEDIDA_PROPIA = 1;

/**
 * Medida que la persona registra en su dispositivo a partir de una captura. Es una aportación,
 * así que lleva el mismo sobre que las demás (ADR 0007): identificador, versión del esquema,
 * fecha de creación y origen. Solo tiene números: la captura nunca sale del dispositivo, ni
 * siquiera en el formato (ADR 0020).
 */
export const MedidaPropia = Schema.Struct({
  tipo: Schema.tag("propia"),
  /** UUID v4 creado en el dispositivo. Al compartirse es la clave idempotente. */
  id: Schema.String.pipe(Schema.check(Schema.isUUID(4))),
  esquema: Schema.Literal(ESQUEMA_MEDIDA_PROPIA),
  /** Cuándo se registró, en milisegundos desde 1970. */
  creada: Schema.Int,
  origen: Schema.Literal("captura"),
  punto: Coordenada,
  senal: LecturaDeSenal,
  unidaA: UnidaA,
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

/** Cómo es la potencia de la señal (RSRP). */
export type NivelDePotencia = "excelente" | "buena" | "regular" | "mala";

/**
 * Tramos habituales de RSRP en 4G, por decenas de dB. Son una regla práctica y no una norma:
 * salen de la guía de Teltonika citada en docs/investigacion/modo-de-informacion.md.
 */
export const potenciaDeLaSenal = (rsrpDbm: number): NivelDePotencia => {
  if (rsrpDbm >= -80) return "excelente";
  if (rsrpDbm > -90) return "buena";
  if (rsrpDbm > -100) return "regular";
  return "mala";
};

/** Cómo es la calidad de la señal (RSRQ). */
export type NivelDeCalidad = "excelente" | "buena" | "regular" | "mala";

/** Tramos habituales de RSRQ en 4G, de la misma guía que los de la potencia. */
export const calidadDeLaSenal = (rsrqDb: number): NivelDeCalidad => {
  if (rsrqDb >= -10) return "excelente";
  if (rsrqDb > -15) return "buena";
  if (rsrqDb > -20) return "regular";
  return "mala";
};
