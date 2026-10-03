import type { Coordenada } from "@celda/dominio/area";
import { type Cuadro, cuadroDe, ZONAS_DE_BARRIDO, zonaDelCuadro } from "@celda/dominio/barrido";
import { cuadrosDeProvincias } from "@celda/dominio/cobertura";
import type {
  CuadroDeBorde,
  CuadroDelRegistro,
  CuadrosDelRegistro,
  PasadaDeBorde,
} from "@celda/dominio/cuadrosDelRegistro";
import { type IndiceDeMunicipios, municipioDelPunto } from "@celda/dominio/municipio";
import { recorrerCuadro } from "@celda/ingesta/barrido";
import { describirError, ExtractorPorCajas } from "@celda/ingesta/extractor";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

/**
 * Los cuadros de las zonas de barrido salen del listado propio del registro oficial (ADR 0019,
 * #55). El listado de las zonas solo pide sus cuadros, así que un registro en otro cuadro nunca
 * aparece en él: los cuadros que tocan España y no están en ninguna zona se piden una vez aparte
 * (`pasadaDeBorde`), y lo que traen se suma al listado (`derivarCuadros`).
 */

/** La rejilla que cubre España con Canarias: de 19° O a 5° E y de 27° N a 44° N. */
const OESTE = -19;
const ESTE = 4;
const SUR = 27;
const NORTE = 43;

/** Los cuadros de la rejilla que cubre España, aunque sean de mar. */
const rejillaDeEspana = (): ReadonlySet<Cuadro> => {
  const cuadros = new Set<Cuadro>();
  for (let longitud = OESTE; longitud <= ESTE; longitud++) {
    for (let latitud = SUR; latitud <= NORTE; latitud++) {
      cuadros.add(cuadroDe({ longitud, latitud }));
    }
  }
  return cuadros;
};

/** De sur a norte y, a la misma latitud, de oeste a este, como en `ZONAS_DE_BARRIDO`. */
const ordenarCuadros = (a: Cuadro, b: Cuadro): number => {
  const [oa = 0, sa = 0] = a.split(",").map(Number);
  const [ob = 0, sb = 0] = b.split(",").map(Number);
  return sa - sb || oa - ob;
};

/**
 * Las provincias que toca cada cuadro de 1° que toca alguna, con los límites del IGN
 * (`cuadrosDeProvincias`, ADR 0017), por código del INE y ordenadas.
 */
export const provinciasPorCuadro = (
  indice: IndiceDeMunicipios,
): ReadonlyMap<Cuadro, ReadonlyArray<string>> => {
  const porCuadro = new Map<Cuadro, Array<string>>();
  for (const [provincia, cuadros] of cuadrosDeProvincias(indice, rejillaDeEspana())) {
    for (const cuadro of cuadros) {
      const suyas = porCuadro.get(cuadro) ?? [];
      suyas.push(provincia);
      porCuadro.set(cuadro, suyas);
    }
  }
  return new Map(
    [...porCuadro]
      .sort(([a], [b]) => ordenarCuadros(a, b))
      .map(([cuadro, provincias]) => [cuadro, provincias.toSorted()]),
  );
};

/** Los cuadros que tocan alguna provincia y no están en ninguna zona de barrido. */
export const cuadrosDeBorde = (indice: IndiceDeMunicipios): ReadonlyArray<Cuadro> => {
  const enZonas = new Set(ZONAS_DE_BARRIDO.flatMap((zona) => zona.cuadros));
  return [...provinciasPorCuadro(indice).keys()].filter((cuadro) => !enZonas.has(cuadro));
};

/** Cuántos registros caen en cada provincia, por código del INE. */
const contarPorProvincia = (
  posiciones: Iterable<Coordenada>,
  provinciaDe: (posicion: Coordenada) => string | undefined,
): Record<string, number> => {
  const porProvincia: Record<string, number> = {};
  for (const posicion of posiciones) {
    const provincia = provinciaDe(posicion);
    if (provincia !== undefined) porProvincia[provincia] = (porProvincia[provincia] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(porProvincia).sort(([a], [b]) => (a < b ? -1 : 1)));
};

/**
 * Pide una vez cada cuadro de `cuadros` con el extractor del registro oficial, con su ritmo, su
 * `User-Agent`, su `robots.txt` y su tope, y apunta cuántos registros trae cada uno y de qué
 * provincias. Un cuadro que llega al tope se divide como en el barrido. No escribe nada en la base:
 * lo que traiga se suma a los cuadros con `derivarCuadros`. Si la fuente deja de responder o pide
 * esperar, para y apunta los que faltan.
 */
export const pasadaDeBorde = Effect.fn("Nocturna.pasadaDeBorde")(function* (
  cuadros: ReadonlyArray<Cuadro>,
  provinciaDe: (posicion: Coordenada) => string | undefined,
) {
  const extractor = yield* ExtractorPorCajas;
  const inicio = yield* Clock.currentTimeMillis;
  const pedidos: Array<CuadroDeBorde> = [];
  const errores: Array<string> = [];
  let bytes = 0;
  for (const [i, cuadro] of cuadros.entries()) {
    const recorrido = yield* Effect.result(recorrerCuadro(cuadro, []));
    if (Result.isFailure(recorrido)) {
      const fallo = recorrido.failure;
      const motivo = fallo._tag === "CuadroSinDividir" ? fallo.message : describirError(fallo);
      errores.push(`${cuadro}: ${motivo}`);
      if (fallo._tag === "CuadroSinDividir") continue;
      const faltan = cuadros.slice(i + 1);
      if (faltan.length > 0) errores.push(`Sin pedir: ${faltan.join(" ")}`);
      break;
    }
    const { registros } = recorrido.success;
    bytes += recorrido.success.bytes;
    pedidos.push({
      cuadro,
      registros: registros.length,
      porProvincia: contarPorProvincia(
        registros.map((r) => r.posicion),
        provinciaDe,
      ),
    });
    yield* Effect.logInfo(`Cuadro ${cuadro}: ${registros.length} registros`);
  }
  const pasada: PasadaDeBorde = {
    inicio,
    fin: yield* Clock.currentTimeMillis,
    peticiones: yield* extractor.peticiones,
    bytes,
    cuadros: pedidos,
    errores,
  };
  return pasada;
});

/** El listado de toda España del que salen los cuadros. */
export interface ListadoDeEspana {
  readonly fuente: string;
  /** El inicio del barrido más antiguo de los que dan el listado, en milisegundos. */
  readonly barrido: number;
  /** La posición de cada registro vigente. */
  readonly posiciones: ReadonlyArray<Coordenada>;
}

/** Un cuadro que no cae en ninguna zona: no toca ninguna provincia ni tiene registros en ellas. */
export class CuadroSinZona extends Schema.TaggedError<CuadroSinZona>()("CuadroSinZona", {
  cuadro: Schema.String,
}) {
  override get message() {
    return `el cuadro ${this.cuadro} no toca ninguna provincia ni tiene registros en ellas`;
  }
}

/**
 * Los cuadros de las zonas de barrido con sus registros: los del listado de toda España y los de
 * borde que trajeron alguno. Cada uno va a su zona con la regla del ADR 0014 (`zonaDelCuadro`).
 */
export const derivarCuadros = (
  listado: ListadoDeEspana,
  borde: PasadaDeBorde | null,
  indice: IndiceDeMunicipios,
): Result.Result<CuadrosDelRegistro, CuadroSinZona> => {
  const provinciaDe = (posicion: Coordenada) =>
    municipioDelPunto(posicion, indice).provincia?.codigo;
  const porCuadro = new Map<Cuadro, Array<Coordenada>>();
  for (const posicion of listado.posiciones) {
    const cuadro = cuadroDe(posicion);
    const suyas = porCuadro.get(cuadro) ?? [];
    suyas.push(posicion);
    porCuadro.set(cuadro, suyas);
  }
  const conteos = new Map<Cuadro, Omit<CuadroDeBorde, "cuadro">>(
    [...porCuadro].map(([cuadro, posiciones]) => [
      cuadro,
      { registros: posiciones.length, porProvincia: contarPorProvincia(posiciones, provinciaDe) },
    ]),
  );
  for (const { cuadro, registros, porProvincia } of borde?.cuadros ?? []) {
    if (registros > 0 && !conteos.has(cuadro)) conteos.set(cuadro, { registros, porProvincia });
  }
  const toca = provinciasPorCuadro(indice);
  const cuadros: Array<CuadroDelRegistro> = [];
  for (const [cuadro, { registros, porProvincia }] of conteos) {
    const suyas = toca.get(cuadro) ?? [];
    const zona = zonaDelCuadro({ porProvincia, toca: suyas });
    if (zona === undefined) return Result.fail(new CuadroSinZona({ cuadro }));
    cuadros.push({ cuadro, zona: zona.nombre, registros, porProvincia, toca: suyas });
  }
  const orden = new Map(ZONAS_DE_BARRIDO.map((zona, i) => [zona.nombre, i]));
  cuadros.sort(
    (a, b) =>
      (orden.get(a.zona) ?? 0) - (orden.get(b.zona) ?? 0) || ordenarCuadros(a.cuadro, b.cuadro),
  );
  return Result.succeed({
    fuente: listado.fuente,
    barrido: listado.barrido,
    registros: cuadros.reduce((suma, c) => suma + c.registros, 0),
    cuadros,
    borde,
  });
};
