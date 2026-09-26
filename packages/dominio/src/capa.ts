import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { Coordenada } from "./area.ts";
import { Compania } from "./compania.ts";
import { Estado } from "./emplazamiento.ts";

/**
 * Lo que la capa guarda de cada emplazamiento: lo justo para dibujar su marcador. El resto se
 * lee en vivo en la ficha.
 */
export const EmplazamientoDeCapa = Schema.Struct({
  clave: Schema.String,
  posicion: Coordenada,
  estado: Estado,
  /** Compañías con estación base en el emplazamiento, en el orden de `COMPANIAS_DE_CAPA`. */
  companias: Schema.Array(Compania),
});
export type EmplazamientoDeCapa = typeof EmplazamientoDeCapa.Type;

/** La capa publicada que dice el backend: su versión, dónde está y cuántos emplazamientos lleva. */
export const CapaPublicada = Schema.Struct({
  version: Schema.String,
  /** Fecha de la instantánea, en milisegundos. */
  fecha: Schema.Finite,
  url: Schema.String,
  emplazamientos: Schema.Int,
});
export type CapaPublicada = typeof CapaPublicada.Type;

/** Formato del fichero. Cambiar las columnas o sus códigos es un formato nuevo. */
export const FORMATO_CAPA = 1;

/** Bit de cada compañía en la columna `companias` del formato 1. */
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

/** Código de cada estado en la columna `estado` del formato 1. */
const ESTADOS_DE_CAPA = ["verificado", "corregido", "nuevo"] as const;

const Columnas = Schema.Struct({
  /** La primera clave: se puede leer con los primeros bytes, antes de analizar el resto. */
  version: Schema.String,
  formato: Schema.Literal(FORMATO_CAPA),
  clave: Schema.Array(Schema.String),
  lon: Schema.Array(Schema.Finite),
  lat: Schema.Array(Schema.Finite),
  companias: Schema.Array(Schema.Int),
  estado: Schema.Array(Schema.Int),
});
type Columnas = typeof Columnas.Type;

const ColumnasEnJson = Schema.fromJsonString(Columnas);
const codificarColumnas = Schema.encodeSync(ColumnasEnJson);
const decodificarColumnas = Schema.decodeUnknownResult(ColumnasEnJson);

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

/** Nombre del fichero de una versión. Cada versión es un fichero distinto que nunca cambia. */
export const ficheroDeCapa = (version: string): string => `${version}.json`;

/**
 * La versión de la capa a partir de los primeros bytes del fichero, sin esperar al resto: la
 * cabecera empieza por `{"version":"…"`.
 */
export const versionDeCabecera = (inicio: string): Option.Option<string> =>
  Option.fromNullishOr(/^\{"version":"([^"]+)"/u.exec(inicio)?.[1]);

/** Seis decimales: unos 10 cm, más de lo que precisa cualquier fuente. */
const redondear = (grados: number): number => Math.round(grados * 1e6) / 1e6;

const mascara = (companias: ReadonlyArray<Compania>): number =>
  companias.reduce((bits, compania) => bits | BIT_COMPANIA[compania], 0);

export interface CapaGenerada {
  readonly version: string;
  readonly fichero: string;
  readonly contenido: string;
  readonly emplazamientos: number;
}

/**
 * La capa de una instantánea de emplazamientos con fecha `fecha`. Es una función pura: la
 * misma instantánea da siempre los mismos bytes, sea cual sea el orden en que llegue.
 */
export const generarCapa = (
  fecha: number,
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
): CapaGenerada => {
  const ordenados = emplazamientos
    .slice()
    .sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));
  const version = versionDeCapa(fecha);
  const columnas: Columnas = {
    version,
    formato: FORMATO_CAPA,
    clave: ordenados.map((e) => e.clave),
    lon: ordenados.map((e) => redondear(e.posicion.longitud)),
    lat: ordenados.map((e) => redondear(e.posicion.latitud)),
    companias: ordenados.map((e) => mascara(e.companias)),
    estado: ordenados.map((e) => ESTADOS_DE_CAPA.indexOf(e.estado)),
  };
  return {
    version,
    fichero: ficheroDeCapa(version),
    contenido: codificarColumnas(columnas),
    emplazamientos: ordenados.length,
  };
};

/** El fichero no es una capa que Celda sepa leer. */
export class CapaIlegible extends Schema.TaggedError<CapaIlegible>()("CapaIlegible", {
  motivo: Schema.String,
}) {}

/** El fichero es de otra versión que la publicada: no se pinta. */
export class VersionDistinta extends Schema.TaggedError<VersionDistinta>()("VersionDistinta", {
  esperada: Schema.String,
  encontrada: Schema.String,
}) {}

export interface CapaLeida {
  readonly version: string;
  /** Fecha de la instantánea, en milisegundos: la marca de agua del mapa. */
  readonly fecha: number;
  readonly emplazamientos: ReadonlyArray<EmplazamientoDeCapa>;
}

const companiasDe = (bits: number): ReadonlyArray<Compania> =>
  COMPANIAS_DE_CAPA.filter((compania) => (bits & BIT_COMPANIA[compania]) !== 0);

const filas = (c: Columnas): Result.Result<ReadonlyArray<EmplazamientoDeCapa>, CapaIlegible> => {
  const n = c.clave.length;
  if ([c.lon, c.lat, c.companias, c.estado].some((columna) => columna.length !== n)) {
    return Result.fail(new CapaIlegible({ motivo: "las columnas no tienen la misma longitud" }));
  }
  const emplazamientos: Array<EmplazamientoDeCapa> = [];
  for (let i = 0; i < n; i++) {
    const estado = ESTADOS_DE_CAPA[c.estado[i] ?? -1];
    if (estado === undefined) {
      return Result.fail(new CapaIlegible({ motivo: `estado desconocido en la fila ${i}` }));
    }
    emplazamientos.push({
      clave: c.clave[i] ?? "",
      posicion: { longitud: c.lon[i] ?? 0, latitud: c.lat[i] ?? 0 },
      estado,
      companias: companiasDe(c.companias[i] ?? 0),
    });
  }
  return Result.succeed(emplazamientos);
};

/**
 * Lee el fichero de una capa y comprueba, antes de analizar nada más, que su cabecera es la
 * versión `esperada`, la que publica el backend. Un fichero de otra versión no se pinta.
 */
export const leerCapa = (
  contenido: string,
  esperada: string,
): Result.Result<CapaLeida, CapaIlegible | VersionDistinta> => {
  const cabecera = versionDeCabecera(contenido.slice(0, 64));
  if (Option.isNone(cabecera)) {
    return Result.fail(new CapaIlegible({ motivo: "no empieza por la versión" }));
  }
  if (cabecera.value !== esperada) {
    return Result.fail(new VersionDistinta({ esperada, encontrada: cabecera.value }));
  }
  const fecha = fechaDeVersion(cabecera.value);
  if (Option.isNone(fecha)) {
    return Result.fail(new CapaIlegible({ motivo: `versión mal formada: ${cabecera.value}` }));
  }
  return decodificarColumnas(contenido).pipe(
    Result.mapError((error) => new CapaIlegible({ motivo: error.message })),
    Result.flatMap(filas),
    Result.map((emplazamientos) => ({
      version: cabecera.value,
      fecha: fecha.value,
      emplazamientos,
    })),
  );
};
