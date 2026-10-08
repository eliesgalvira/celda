import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { CapaIlegible, mascaraDeCompanias } from "./capa.ts";
import { type MascarasDeFiltro, papelDeMascara } from "./filtro.ts";
import { indiceDeHilbert } from "./lotes.ts";
import { type EmplazamientoSituado, FORMATO_PROVINCIAS, LARGO_HUELLA } from "./provincias.ts";

/**
 * Los puntos de toda España (ADR 0028): la posición y las compañías de cada emplazamiento, lo justo
 * para dibujar la vista de puntos de una vez, sin pedir ninguna capa de provincia. Se publica con
 * cada versión desde el formato 8 y el resumen nacional dice su fichero.
 *
 * - Los emplazamientos van por provincia, dentro de cada una por municipio y dentro de cada
 *   municipio a lo largo de la curva de Hilbert. Así las posiciones seguidas están cerca y sus
 *   diferencias son números pequeños, que es lo que mejor comprime gzip.
 * - Cada posición es la diferencia con la anterior en cienmilésimas de grado (`ESCALA`), un metro
 *   más o menos. Para dibujar sobra, y para saber qué emplazamiento se ha tocado basta con buscar
 *   el más cercano en la capa de su provincia.
 * - De cada provincia van sus municipios en tramos: el municipio y cuántos emplazamientos seguidos
 *   tiene. De ahí salen los números de la cabecera sin descargar ninguna capa.
 *
 * Con los 35.689 emplazamientos publicados el 07/10/2026 pesa unos 455 KB y 186 KB con gzip.
 */

/** Cuántas unidades de las posiciones hay en un grado: cienmilésimas. */
export const ESCALA_DE_PUNTOS = 100_000;

/** El municipio de un tramo sin municipio: un territorio compartido o el mar. */
const SIN_MUNICIPIO = -1;

/** Los puntos de una versión: `puntos/<huella>.json`. */
export const ficheroDePuntos = (huella: string): string =>
  `puntos/${huella.slice(0, LARGO_HUELLA)}.json`;

const ColumnasDePuntos = Schema.Struct({
  formato: Schema.Literal(FORMATO_PROVINCIAS),
  /** Las provincias, por código, en el orden en que van sus emplazamientos. */
  provincias: Schema.Array(Schema.String),
  /**
   * Por provincia, sus tramos en pares: las tres últimas cifras del código INE del municipio, o
   * -1 sin municipio, y cuántos emplazamientos seguidos son suyos.
   */
  municipios: Schema.Array(Schema.Array(Schema.Int)),
  /** La longitud de cada emplazamiento menos la del anterior, en `ESCALA_DE_PUNTOS`. */
  lon: Schema.Array(Schema.Int),
  /** Lo mismo con la latitud. */
  lat: Schema.Array(Schema.Int),
  /** La máscara de sus compañías, como la columna `companias` de la capa. */
  companias: Schema.Array(Schema.Int),
});
type ColumnasDePuntos = typeof ColumnasDePuntos.Type;

const PuntosEnJson = Schema.fromJsonString(ColumnasDePuntos);
const codificarPuntos = Schema.encodeSync(PuntosEnJson);
const decodificarPuntos = Schema.decodeUnknownResult(PuntosEnJson);

/** Las tres últimas cifras del código INE de un municipio, o `SIN_MUNICIPIO`. */
const cifrasDeMunicipio = (municipio: string | null): number =>
  municipio === null ? SIN_MUNICIPIO : Number(municipio.slice(2));

const enUnidades = (grados: number): number => Math.round(grados * ESCALA_DE_PUNTOS);

/**
 * El contenido de los puntos de una versión, con los emplazamientos de cada provincia como los
 * deja `situarEmplazamientos`. Es una función pura: los mismos emplazamientos dan los mismos bytes
 * aunque lleguen en otro orden.
 */
export const generarPuntos = (
  situados: ReadonlyMap<string, ReadonlyArray<EmplazamientoSituado>>,
): string => {
  const provincias = [...situados.keys()].sort();
  const columnas = {
    municipios: new Array<Array<number>>(),
    lon: new Array<number>(),
    lat: new Array<number>(),
    companias: new Array<number>(),
  };
  let x = 0;
  let y = 0;
  for (const provincia of provincias) {
    const ordenados = (situados.get(provincia) ?? [])
      .map((s) => ({
        municipio: cifrasDeMunicipio(s.municipio),
        hilbert: indiceDeHilbert(s.emplazamiento.posicion),
        clave: s.emplazamiento.clave,
        x: enUnidades(s.emplazamiento.posicion.longitud),
        y: enUnidades(s.emplazamiento.posicion.latitud),
        companias: mascaraDeCompanias(s.emplazamiento.companias),
      }))
      .sort((a, b) =>
        a.municipio !== b.municipio
          ? a.municipio - b.municipio
          : a.hilbert !== b.hilbert
            ? a.hilbert - b.hilbert
            : a.clave < b.clave
              ? -1
              : a.clave > b.clave
                ? 1
                : 0,
      );
    const tramos: Array<number> = [];
    for (const punto of ordenados) {
      const ultimo = tramos.length - 2;
      if (tramos[ultimo] === punto.municipio) {
        tramos[ultimo + 1] = (tramos[ultimo + 1] ?? 0) + 1;
      } else {
        tramos.push(punto.municipio, 1);
      }
      columnas.lon.push(punto.x - x);
      columnas.lat.push(punto.y - y);
      columnas.companias.push(punto.companias);
      x = punto.x;
      y = punto.y;
    }
    columnas.municipios.push(tramos);
  }
  return codificarPuntos({ formato: FORMATO_PROVINCIAS, provincias, ...columnas });
};

/** Los emplazamientos seguidos de un municipio, o de una provincia sin municipio. */
export interface TramoDePuntos {
  /** El código INE del municipio, o `null` sin municipio. */
  readonly municipio: string | null;
  /** La posición de su provincia en `PuntosLeidos.provincias`. */
  readonly provincia: number;
  /** El primero, en las columnas. */
  readonly desde: number;
  readonly cuantos: number;
}

/** Los puntos de toda España, leídos, en columnas. */
export interface PuntosLeidos {
  readonly cuantos: number;
  readonly longitud: Float64Array<ArrayBuffer>;
  readonly latitud: Float64Array<ArrayBuffer>;
  /** La máscara de las compañías de cada uno. */
  readonly companias: Uint8Array<ArrayBuffer>;
  /** La posición de su provincia en `provincias`. */
  readonly provincia: Uint8Array<ArrayBuffer>;
  /** Las provincias, por código. */
  readonly provincias: ReadonlyArray<string>;
  /** Los tramos de cada municipio, en el orden de las columnas. */
  readonly tramos: ReadonlyArray<TramoDePuntos>;
}

const descuadrados = (motivo: string) => Result.fail(new CapaIlegible({ motivo }));

const columnasLeidas = (c: ColumnasDePuntos): Result.Result<PuntosLeidos, CapaIlegible> => {
  const n = c.lon.length;
  if (c.lat.length !== n || c.companias.length !== n) {
    return descuadrados("las columnas de los puntos no tienen la misma longitud");
  }
  if (c.municipios.length !== c.provincias.length || c.provincias.length > 255) {
    return descuadrados("los municipios de los puntos no cuadran con sus provincias");
  }
  const tramos: Array<TramoDePuntos> = [];
  const provincia = new Uint8Array(n);
  let desde = 0;
  for (const [p, pares] of c.municipios.entries()) {
    const codigo = c.provincias[p] ?? "";
    if (pares.length % 2 !== 0) return descuadrados(`los tramos de ${codigo} van sueltos`);
    for (let i = 0; i < pares.length; i += 2) {
      const cifras = pares[i] ?? SIN_MUNICIPIO;
      const cuantos = pares[i + 1] ?? 0;
      if (cuantos <= 0 || desde + cuantos > n) {
        return descuadrados(`un tramo de ${codigo} se sale de las columnas`);
      }
      tramos.push({
        municipio: cifras < 0 ? null : `${codigo}${String(cifras).padStart(3, "0")}`,
        provincia: p,
        desde,
        cuantos,
      });
      provincia.fill(p, desde, desde + cuantos);
      desde += cuantos;
    }
  }
  if (desde !== n) return descuadrados("los tramos no cubren todos los puntos");
  const longitud = new Float64Array(n);
  const latitud = new Float64Array(n);
  const companias = new Uint8Array(n);
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x += c.lon[i] ?? 0;
    y += c.lat[i] ?? 0;
    longitud[i] = x / ESCALA_DE_PUNTOS;
    latitud[i] = y / ESCALA_DE_PUNTOS;
    companias[i] = c.companias[i] ?? 0;
  }
  return Result.succeed({
    cuantos: n,
    longitud,
    latitud,
    companias,
    provincia,
    provincias: c.provincias,
    tramos,
  });
};

/** Lee los puntos de una versión y comprueba que sus columnas cuadran. */
export const leerPuntos = (contenido: string): Result.Result<PuntosLeidos, CapaIlegible> =>
  decodificarPuntos(contenido).pipe(
    Result.mapError((error) => new CapaIlegible({ motivo: error.message })),
    Result.flatMap(columnasLeidas),
  );

/**
 * Cuántos de los puntos de unos tramos salen con un filtro y cuentan en las zonas: los de las
 * compañías del filtro. Los de la red que usan salen aparte y no cuentan, como en los hexágonos.
 */
export const contarEnTramos = (
  puntos: PuntosLeidos,
  tramos: ReadonlyArray<TramoDePuntos>,
  filtro: MascarasDeFiltro,
): number => {
  let cuantos = 0;
  for (const tramo of tramos) {
    if (filtro.propias === 0) {
      cuantos += tramo.cuantos;
      continue;
    }
    for (let i = tramo.desde; i < tramo.desde + tramo.cuantos; i++) {
      if (papelDeMascara(puntos.companias[i] ?? 0, filtro) === "propio") cuantos += 1;
    }
  }
  return cuantos;
};

/** Los tramos de un municipio, por su código INE: uno, o ninguno si no tiene emplazamientos. */
export const tramosDeMunicipio = (
  puntos: PuntosLeidos,
  municipio: string,
): ReadonlyArray<TramoDePuntos> => puntos.tramos.filter((t) => t.municipio === municipio);
