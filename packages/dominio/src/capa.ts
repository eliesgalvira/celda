import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { Coordenada } from "./area.ts";
import { Mhz } from "./banda.ts";
import { type Barrio, barrioDelPunto, FuenteDeBarrios, type LimitesDeBarrios } from "./barrio.ts";
import { Compania } from "./compania.ts";
import { Estado } from "./emplazamiento.ts";

/** Las bandas en que emite la estación base de una compañía, de menor a mayor frecuencia. */
export const BandasDeCapa = Schema.Struct({
  compania: Compania,
  mhz: Schema.Array(Mhz),
});
export type BandasDeCapa = typeof BandasDeCapa.Type;

/**
 * Lo que la capa guarda de cada emplazamiento: lo justo para dibujar su marcador y la vista de
 * interferencia. El resto se lee en vivo en la ficha.
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

/** Un emplazamiento tal como sale de la capa: con el barrio en que cae. */
export interface EmplazamientoLeido extends EmplazamientoDeCapa {
  /** Código del barrio, o `null` si el emplazamiento queda fuera de Barcelona. */
  readonly barrio: string | null;
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
 * Formato del fichero. Cambiar las columnas o sus códigos es un formato nuevo. El 2 añade los
 * barrios: su tabla en la cabecera y la columna `barrio`. El 3 añade al final la columna
 * `bandas`. La web lee el 2 y el 3; en el 2 no se conoce ninguna banda.
 */
export const FORMATO_CAPA = 3;

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

const codigoDeBandas = (bandas: ReadonlyArray<BandasDeCapa>): number =>
  bandas.reduce(
    (codigo, { compania, mhz }) =>
      codigo +
      mhz.reduce((bits, banda) => bits | (1 << Mhz.literals.indexOf(banda)), 0) *
        BANDAS_POR_COMPANIA ** COMPANIAS_DE_CAPA.indexOf(compania),
    0,
  );

const bandasDeCodigo = (codigo: number): Array<BandasDeCapa> =>
  COMPANIAS_DE_CAPA.flatMap((compania, k) => {
    const bits = Math.floor(codigo / BANDAS_POR_COMPANIA ** k) % BANDAS_POR_COMPANIA;
    const mhz = Mhz.literals.filter((_, j) => (bits & (1 << j)) !== 0);
    return mhz.length === 0 ? [] : [{ compania, mhz }];
  });

/** Código de cada estado en la columna `estado`. */
const ESTADOS_DE_CAPA = ["verificado", "corregido", "nuevo"] as const;

/** Barrio de la columna `barrio` para un emplazamiento que no cae en ninguno. */
const SIN_BARRIO = -1;

/** Los barrios de la capa, por columnas, con la fuente de sus límites. */
const TablaDeBarrios = Schema.Struct({
  fuente: FuenteDeBarrios,
  codigo: Schema.Array(Schema.String),
  nombre: Schema.Array(Schema.String),
  /** Dónde va la etiqueta de cada barrio. */
  lon: Schema.Array(Schema.Finite),
  lat: Schema.Array(Schema.Finite),
});

const Columnas = Schema.Struct({
  /** La primera clave: se puede leer con los primeros bytes, antes de analizar el resto. */
  version: Schema.String,
  formato: Schema.Literals([2, FORMATO_CAPA]),
  barrios: TablaDeBarrios,
  clave: Schema.Array(Schema.String),
  lon: Schema.Array(Schema.Finite),
  lat: Schema.Array(Schema.Finite),
  companias: Schema.Array(Schema.Int),
  estado: Schema.Array(Schema.Int),
  /** Posición del barrio en la tabla `barrios`, o `SIN_BARRIO`. */
  barrio: Schema.Array(Schema.Int),
  /** Las bandas conocidas de cada emplazamiento (`codigoDeBandas`). Desde el formato 3. */
  bandas: Schema.optionalKey(Schema.Array(Schema.Int)),
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

const porCodigo = <A extends { readonly codigo: string }>(a: A, b: A): number =>
  a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0;

/**
 * La capa de una instantánea de emplazamientos con fecha `fecha`, con el barrio de cada uno según
 * `limites`. Es una función pura: la misma instantánea con los mismos límites da siempre los
 * mismos bytes, sea cual sea el orden en que llegue.
 */
export const generarCapa = (
  fecha: number,
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
  limites: LimitesDeBarrios,
): CapaGenerada => {
  const ordenados = emplazamientos
    .slice()
    .sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));
  const barrios = limites.barrios.slice().sort(porCodigo);
  const posicionDe = new Map(barrios.map((b, i) => [b.codigo, i]));
  const version = versionDeCapa(fecha);
  const columnas: Columnas = {
    version,
    formato: FORMATO_CAPA,
    barrios: {
      fuente: limites.fuente,
      codigo: barrios.map((b) => b.codigo),
      nombre: barrios.map((b) => b.nombre),
      lon: barrios.map((b) => redondear(b.etiqueta.longitud)),
      lat: barrios.map((b) => redondear(b.etiqueta.latitud)),
    },
    clave: ordenados.map((e) => e.clave),
    lon: ordenados.map((e) => redondear(e.posicion.longitud)),
    lat: ordenados.map((e) => redondear(e.posicion.latitud)),
    companias: ordenados.map((e) => mascara(e.companias)),
    estado: ordenados.map((e) => ESTADOS_DE_CAPA.indexOf(e.estado)),
    barrio: ordenados.map(
      (e) => posicionDe.get(barrioDelPunto(e.posicion, barrios)?.codigo ?? "") ?? SIN_BARRIO,
    ),
    bandas: ordenados.map((e) => codigoDeBandas(e.bandas ?? [])),
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
  readonly emplazamientos: ReadonlyArray<EmplazamientoLeido>;
  /** Los barrios de Barcelona, por código. */
  readonly barrios: ReadonlyArray<Barrio>;
  /** De dónde salen los límites de barrio. */
  readonly fuenteDeBarrios: FuenteDeBarrios;
}

const companiasDe = (bits: number): ReadonlyArray<Compania> =>
  COMPANIAS_DE_CAPA.filter((compania) => (bits & BIT_COMPANIA[compania]) !== 0);

const barriosDe = (t: typeof TablaDeBarrios.Type): Result.Result<Array<Barrio>, CapaIlegible> => {
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

const filas = (
  c: Columnas,
): Result.Result<Pick<CapaLeida, "emplazamientos" | "barrios">, CapaIlegible> => {
  const n = c.clave.length;
  const columnas = [
    c.lon,
    c.lat,
    c.companias,
    c.estado,
    c.barrio,
    ...(c.bandas === undefined ? [] : [c.bandas]),
  ];
  if (columnas.some((columna) => columna.length !== n)) {
    return Result.fail(new CapaIlegible({ motivo: "las columnas no tienen la misma longitud" }));
  }
  const barrios = barriosDe(c.barrios);
  if (Result.isFailure(barrios)) return Result.fail(barrios.failure);
  const emplazamientos: Array<EmplazamientoLeido> = [];
  for (let i = 0; i < n; i++) {
    const estado = ESTADOS_DE_CAPA[c.estado[i] ?? -1];
    if (estado === undefined) {
      return Result.fail(new CapaIlegible({ motivo: `estado desconocido en la fila ${i}` }));
    }
    const posicionBarrio = c.barrio[i] ?? SIN_BARRIO;
    const barrio = barrios.success[posicionBarrio];
    if (posicionBarrio !== SIN_BARRIO && barrio === undefined) {
      return Result.fail(new CapaIlegible({ motivo: `barrio desconocido en la fila ${i}` }));
    }
    const leido: EmplazamientoLeido = {
      clave: c.clave[i] ?? "",
      posicion: { longitud: c.lon[i] ?? 0, latitud: c.lat[i] ?? 0 },
      estado,
      companias: companiasDe(c.companias[i] ?? 0),
      barrio: barrio?.codigo ?? null,
    };
    // Sin ninguna banda conocida, el emplazamiento no lleva la clave.
    const bandas = bandasDeCodigo(c.bandas?.[i] ?? 0);
    emplazamientos.push(bandas.length === 0 ? leido : { ...leido, bandas });
  }
  return Result.succeed({ emplazamientos, barrios: barrios.success });
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
    Result.flatMap((columnas) =>
      Result.map(filas(columnas), ({ emplazamientos, barrios }) => ({
        version: cabecera.value,
        fecha: fecha.value,
        emplazamientos,
        barrios,
        fuenteDeBarrios: columnas.barrios.fuente,
      })),
    ),
  );
};
