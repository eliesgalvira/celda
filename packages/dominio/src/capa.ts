import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { Coordenada } from "./area.ts";
import { Mhz } from "./banda.ts";
import { type Barrio, FuenteDeBarrios } from "./barrio.ts";
import { Compania } from "./compania.ts";
import { type Emplazamiento, Estado, type EstacionBase } from "./emplazamiento.ts";

/** Las bandas en que emite la estación base de una compañía, de menor a mayor frecuencia. */
export const BandasDeCapa = Schema.Struct({
  compania: Compania,
  mhz: Schema.Array(Mhz),
});
export type BandasDeCapa = typeof BandasDeCapa.Type;

/**
 * Lo que la capa guarda de cada emplazamiento: lo justo para dibujar su marcador y la vista de
 * interferencia. El resto va en su ficha, que se publica con la capa.
 */
export const EmplazamientoDeCapa = Schema.Struct({
  clave: Schema.String,
  posicion: Coordenada,
  estado: Estado,
  /** Compañías con estación base en el emplazamiento, en el orden de `COMPANIAS_DE_CAPA`. */
  companias: Schema.Array(Compania),
  /**
   * Las bandas conocidas de sus estaciones base, en el orden de `COMPANIAS_DE_CAPA`. Una compañía
   * de la que aún no se ha leído ninguna banda no aparece, y sin ninguna falta la clave. Tampoco
   * está en las capas del formato 2.
   */
  bandas: Schema.optionalKey(Schema.Array(BandasDeCapa)),
});
export type EmplazamientoDeCapa = typeof EmplazamientoDeCapa.Type;

/**
 * Las bandas de cada estación base que el registro ya ha dado, sin repetir. Una estación base de
 * la que no se conoce ninguna no aparece: en la capa, eso es «sin leer», no «sin bandas».
 */
const bandasConocidas = (
  estaciones: ReadonlyArray<Pick<EstacionBase, "compania" | "bandas">>,
): Array<BandasDeCapa> =>
  estaciones.flatMap(({ compania, bandas }) => {
    const mhz = [...new Set(bandas.flatMap((b) => (b.mhz === null ? [] : [b.mhz])))].toSorted(
      (a, b) => a - b,
    );
    return mhz.length === 0 ? [] : [{ compania, mhz }];
  });

/** Lo que la capa guarda de un emplazamiento con sus estaciones base: compañías y bandas. */
export const emplazamientoDeCapa = (
  emplazamiento: Pick<Emplazamiento, "clave" | "posicion" | "estado">,
  estaciones: ReadonlyArray<Pick<EstacionBase, "compania" | "bandas">>,
): EmplazamientoDeCapa => ({
  clave: emplazamiento.clave,
  posicion: emplazamiento.posicion,
  estado: emplazamiento.estado,
  companias: estaciones.map((estacion) => estacion.compania),
  bandas: bandasConocidas(estaciones),
});

/** Un emplazamiento tal como sale de la capa: con el barrio en que cae. */
export interface EmplazamientoLeido extends EmplazamientoDeCapa {
  /** Código del barrio, o `null` si el emplazamiento queda fuera de Barcelona. */
  readonly barrio: string | null;
  /**
   * El lote de fichas de su versión en el que está su ficha. Desde el formato 4. En el 5 es la
   * posición del fichero en la lista de lotes de su provincia.
   */
  readonly lote?: number;
  /** Código INE de la provincia en cuya capa va. Desde el formato 5. */
  readonly provincia?: string;
  /** Código INE del municipio, o `null` en un territorio compartido. Desde el formato 5. */
  readonly municipio?: string | null;
}

/** La capa publicada que dice el backend: su versión, dónde está y cuántos emplazamientos lleva. */
export const CapaPublicada = Schema.Struct({
  version: Schema.String,
  /** Fecha de la instantánea, en milisegundos. */
  fecha: Schema.Finite,
  url: Schema.String,
  emplazamientos: Schema.Int,
});
export type CapaPublicada = typeof CapaPublicada.Type;

/**
 * La publicación vigente: el único fichero del almacén que cambia. Dice qué versión tiene que
 * cargar la web y, desde el formato 5, su resumen nacional (ADR 0016), que dice dónde está la
 * capa de cada provincia. Se escribe el último, cuando ya están todos los demás.
 */
export const Vigente = Schema.Struct({
  version: Schema.String,
  /** Fecha de la instantánea, en milisegundos. */
  fecha: Schema.Finite,
  emplazamientos: Schema.Int,
  /** Cuántos lotes de fichas tiene la versión. */
  lotes: Schema.Int,
  /**
   * Desde el formato 5, el resumen nacional de la versión (`ficheroDeResumen`). Sin él, la
   * versión es de una capa entera del formato 4 o anterior.
   */
  resumen: Schema.optionalKey(Schema.String),
});
export type Vigente = typeof Vigente.Type;

/** El nombre del fichero de la publicación vigente, en la raíz del almacén. */
export const FICHERO_VIGENTE = "vigente.json";

const VigenteEnJson = Schema.fromJsonString(Vigente);
/** El contenido de `vigente.json`. */
export const codificarVigente = Schema.encodeSync(VigenteEnJson);
/** Lee `vigente.json`; falla si no tiene la forma esperada. */
export const decodificarVigente = Schema.decodeUnknownResult(VigenteEnJson);

/** Bit de cada compañía en la columna `companias`. */
const BIT_COMPANIA: Readonly<Record<Compania, number>> = {
  movistar: 1,
  vodafone: 2,
  orange: 4,
  digi: 8,
  yoigo: 16,
};

/** Orden en que la capa devuelve las compañías de un emplazamiento: el de sus bits. */
export const COMPANIAS_DE_CAPA: ReadonlyArray<Compania> = Compania.literals
  .slice()
  .sort((a, b) => BIT_COMPANIA[a] - BIT_COMPANIA[b]);

/**
 * La columna `bandas` guarda un número por emplazamiento con siete bits por compañía, uno por
 * banda de `Mhz` en su orden: los de la compañía `k` de `COMPANIAS_DE_CAPA` valen 128^k. Con
 * cinco compañías llega a 2^35, lejos de los enteros exactos de JSON.
 */
const BANDAS_POR_COMPANIA = 2 ** Mhz.literals.length;

export const codigoDeBandas = (bandas: ReadonlyArray<BandasDeCapa>): number =>
  bandas.reduce(
    (codigo, { compania, mhz }) =>
      codigo +
      mhz.reduce((bits, banda) => bits | (1 << Mhz.literals.indexOf(banda)), 0) *
        BANDAS_POR_COMPANIA ** COMPANIAS_DE_CAPA.indexOf(compania),
    0,
  );

export const bandasDeCodigo = (codigo: number): Array<BandasDeCapa> =>
  COMPANIAS_DE_CAPA.flatMap((compania, k) => {
    const bits = Math.floor(codigo / BANDAS_POR_COMPANIA ** k) % BANDAS_POR_COMPANIA;
    const mhz = Mhz.literals.filter((_, j) => (bits & (1 << j)) !== 0);
    return mhz.length === 0 ? [] : [{ compania, mhz }];
  });

/** Código de cada estado en la columna `estado`. */
export const ESTADOS_DE_CAPA = ["verificado", "corregido", "nuevo"] as const;

/** Barrio de la columna `barrio` para un emplazamiento que no cae en ninguno. */
export const SIN_BARRIO = -1;

/** Los barrios de la capa, por columnas, con la fuente de sus límites. */
export const TablaDeBarrios = Schema.Struct({
  fuente: FuenteDeBarrios,
  codigo: Schema.Array(Schema.String),
  nombre: Schema.Array(Schema.String),
  /** Dónde va la etiqueta de cada barrio. */
  lon: Schema.Array(Schema.Finite),
  lat: Schema.Array(Schema.Finite),
});

const PREFIJO_VERSION = "sitios@";
const VERSION = /^sitios@(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/u;

/**
 * Versión de la capa que sale de una instantánea con fecha `fecha`, al segundo:
 * `sitios@2026-09-26T02:15:03Z`. Va en el nombre del fichero y en su cabecera.
 */
export const versionDeCapa = (fecha: number): string =>
  `${PREFIJO_VERSION}${DateTime.formatIso(DateTime.makeUnsafe(fecha)).slice(0, 19)}Z`;

/** Fecha, en milisegundos, de la instantánea de una versión de capa. */
export const fechaDeVersion = (version: string): Option.Option<number> =>
  Option.fromNullishOr(VERSION.exec(version)?.[1]).pipe(
    Option.flatMap((iso) => DateTime.make(iso)),
    Option.map(DateTime.toEpochMillis),
  );

/**
 * La carpeta con los lotes de fichas de una versión del formato 4: `fichas@2026-09-26T02:15:03Z`
 * para la capa `sitios@2026-09-26T02:15:03Z`. La retirada de versiones viejas aún la reconoce.
 */
export const carpetaDeFichas = (version: string): string =>
  version.startsWith(PREFIJO_VERSION)
    ? `fichas@${version.slice(PREFIJO_VERSION.length)}`
    : `fichas@${version}`;

/**
 * La versión de la capa a partir de los primeros bytes del fichero, sin esperar al resto: la
 * cabecera empieza por `{"version":"…"`.
 */
export const versionDeCabecera = (inicio: string): Option.Option<string> =>
  Option.fromNullishOr(/^\{"version":"([^"]+)"/u.exec(inicio)?.[1]);

/** Seis decimales: unos 10 cm, más de lo que precisa cualquier fuente. */
export const redondear = (grados: number): number => Math.round(grados * 1e6) / 1e6;

/** La máscara de bits de unas compañías, como en la columna `companias`. */
export const mascaraDeCompanias = (companias: ReadonlyArray<Compania>): number =>
  companias.reduce((bits, compania) => bits | BIT_COMPANIA[compania], 0);

/** El fichero no es una capa que Celda sepa leer. */
export class CapaIlegible extends Schema.TaggedError<CapaIlegible>()("CapaIlegible", {
  motivo: Schema.String,
}) {}

/** El fichero es de otra versión que la publicada: no se pinta. */
export class VersionDistinta extends Schema.TaggedError<VersionDistinta>()("VersionDistinta", {
  esperada: Schema.String,
  encontrada: Schema.String,
}) {}

/** Las compañías de una máscara de la columna `companias`, en el orden de `COMPANIAS_DE_CAPA`. */
export const companiasDeMascara = (bits: number): ReadonlyArray<Compania> =>
  COMPANIAS_DE_CAPA.filter((compania) => (bits & BIT_COMPANIA[compania]) !== 0);

/** Los barrios de una tabla de la capa, con la tabla comprobada. */
export const barriosDe = (
  t: typeof TablaDeBarrios.Type,
): Result.Result<Array<Barrio>, CapaIlegible> => {
  const n = t.codigo.length;
  if ([t.nombre, t.lon, t.lat].some((columna) => columna.length !== n)) {
    return Result.fail(new CapaIlegible({ motivo: "la tabla de barrios está descuadrada" }));
  }
  return Result.succeed(
    t.codigo.map((codigo, i) => ({
      codigo,
      nombre: t.nombre[i] ?? "",
      etiqueta: { longitud: t.lon[i] ?? 0, latitud: t.lat[i] ?? 0 },
    })),
  );
};
