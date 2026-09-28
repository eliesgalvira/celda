import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/**
 * Lectura de las unidades administrativas (`au:AdministrativeUnit`) de la Base de Datos de
 * Límites Jurisdiccionales del IGN, en el GML 3.2 de su descarga masiva. Solo se leen el código
 * nacional, el nombre y la geometría, en ETRS89 con latitud y longitud (EPSG:4258). A la escala
 * de Celda, ETRS89 y WGS84 son el mismo sistema.
 */

/** El GML no trae lo que se esperaba. */
export class GmlIlegible extends Schema.TaggedError<GmlIlegible>()("GmlIlegible", {
  motivo: Schema.String,
}) {}

/**
 * Un anillo cerrado con sus vértices en millonésimas de grado, seguidos: `[x0, y0, x1, y1, …]`,
 * longitud antes que latitud. El último vértice repite el primero. La fuente da seis decimales,
 * así que los enteros son exactos y dos vecinos comparten los mismos números en su límite.
 */
export type AnilloEntero = ReadonlyArray<number>;

/** Una unidad administrativa del IGN. */
export interface UnidadDelIgn {
  /** Código nacional de once cifras, como «34090808019». */
  readonly codigoNacional: string;
  readonly nombre: string;
  /** Polígonos, cada uno con su anillo exterior y sus agujeros. */
  readonly poligonos: ReadonlyArray<ReadonlyArray<AnilloEntero>>;
}

export const MILLONESIMAS = 1_000_000;

const SISTEMA = "http://www.opengis.net/def/crs/EPSG/0/4258";

/** El texto entre la primera `<etiqueta>` que haya desde `desde` y su cierre, o `undefined`. */
const contenido = (texto: string, etiqueta: string, desde = 0, hasta = texto.length) => {
  const apertura = texto.indexOf(`<${etiqueta}>`, desde);
  if (apertura === -1 || apertura >= hasta) return undefined;
  const inicio = apertura + etiqueta.length + 2;
  const cierre = texto.indexOf(`</${etiqueta}>`, inicio);
  return cierre === -1 || cierre > hasta ? undefined : texto.slice(inicio, cierre);
};

const ENTIDADES: ReadonlyMap<string, string> = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&apos;", "'"],
]);

const sinEntidades = (texto: string): string =>
  texto.replace(/&(?:amp|lt|gt|quot|apos);/gu, (entidad) => ENTIDADES.get(entidad) ?? entidad);

/** Un `gml:posList` de latitud y longitud, como anillo cerrado en millonésimas. */
const anilloDe = (lista: string): AnilloEntero => {
  const numeros = lista.trim().split(/\s+/u);
  if (numeros.length < 8 || numeros.length % 2 !== 0) {
    throw new Error(`anillo con ${numeros.length / 2} vértices`);
  }
  const anillo: Array<number> = [];
  for (let k = 0; k < numeros.length; k += 2) {
    const latitud = Math.round(Number(numeros[k]) * MILLONESIMAS);
    const longitud = Math.round(Number(numeros[k + 1]) * MILLONESIMAS);
    if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) {
      throw new Error(`vértice mal formado: «${numeros[k]} ${numeros[k + 1]}»`);
    }
    anillo.push(longitud, latitud);
  }
  if (anillo[0] !== anillo.at(-2) || anillo[1] !== anillo.at(-1)) {
    throw new Error("un anillo sin cerrar");
  }
  return anillo;
};

/** Los polígonos de la geometría de un miembro, entre `desde` y `hasta`. */
const poligonosDe = (texto: string, desde: number, hasta: number) => {
  const poligonos: Array<Array<AnilloEntero>> = [];
  let k = texto.indexOf("<gml:Polygon ", desde);
  while (k !== -1 && k < hasta) {
    const fin = texto.indexOf("</gml:Polygon>", k);
    if (fin === -1 || fin > hasta) throw new Error("un polígono sin cerrar");
    const sistema = /srsName="([^"]+)"/u.exec(texto.slice(k, k + 300))?.[1];
    if (sistema !== SISTEMA) throw new Error(`el sistema de referencia es ${sistema ?? "ninguno"}`);
    const anillos: Array<AnilloEntero> = [];
    let lista = texto.indexOf("<gml:posList>", k);
    while (lista !== -1 && lista < fin) {
      const cierre = texto.indexOf("</gml:posList>", lista);
      anillos.push(anilloDe(texto.slice(lista + "<gml:posList>".length, cierre)));
      lista = texto.indexOf("<gml:posList>", cierre);
    }
    if (anillos.length === 0) throw new Error("un polígono sin anillos");
    poligonos.push(anillos);
    k = texto.indexOf("<gml:Polygon ", fin);
  }
  if (poligonos.length === 0) throw new Error("no tiene polígonos");
  return poligonos;
};

const leerMiembros = (texto: string): ReadonlyArray<UnidadDelIgn> => {
  const unidades: Array<UnidadDelIgn> = [];
  let k = texto.indexOf("<wfs:member>");
  while (k !== -1) {
    const fin = texto.indexOf("</wfs:member>", k);
    if (fin === -1) throw new Error("un miembro sin cerrar");
    const codigoNacional = contenido(texto, "au:nationalCode", k, fin);
    const nombre = contenido(texto, "gn:text", k, fin);
    if (codigoNacional === undefined || !/^\d{11}$/u.test(codigoNacional)) {
      throw new Error(`un miembro sin código nacional válido (${codigoNacional ?? "ninguno"})`);
    }
    if (nombre === undefined) throw new Error(`${codigoNacional} no tiene nombre`);
    try {
      unidades.push({
        codigoNacional,
        nombre: sinEntidades(nombre.trim()),
        poligonos: poligonosDe(texto, k, fin),
      });
    } catch (causa) {
      throw new Error(
        `${codigoNacional}: ${causa instanceof Error ? causa.message : String(causa)}`,
        { cause: causa },
      );
    }
    k = texto.indexOf("<wfs:member>", fin);
  }
  const anunciadas = /numberReturned="(\d+)"/u.exec(texto.slice(0, 5000))?.[1];
  if (anunciadas !== undefined && Number(anunciadas) !== unidades.length) {
    throw new Error(`anuncia ${anunciadas} unidades y trae ${unidades.length}`);
  }
  return unidades;
};

/**
 * Las unidades administrativas de un GML del IGN. Falla con `GmlIlegible` si alguna no tiene
 * código, nombre o una geometría que se pueda leer, o si no trae tantas como anuncia.
 */
export const unidadesDelGml = (
  texto: string,
): Result.Result<ReadonlyArray<UnidadDelIgn>, GmlIlegible> =>
  Result.try({
    try: () => leerMiembros(texto),
    catch: (causa) =>
      new GmlIlegible({ motivo: causa instanceof Error ? causa.message : String(causa) }),
  });
