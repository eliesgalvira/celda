import { LimitesDeMunicipios } from "@celda/dominio/municipio";
import {
  deLaComunitatValenciana,
  formasDe,
  type NombreBilingue,
  PROVINCIAS_DE_LA_COMUNITAT_VALENCIANA,
  type TablaDeNombres,
} from "@celda/dominio/nombreDeLugar";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  type Contorno,
  contornoDeLaUnion,
  type ContornoImposible,
  ficheroDeContorno,
} from "./espana.ts";

/**
 * Lo que necesita el nombre de lugar (ADR 0025), sacado de los límites del repositorio sin
 * descargar nada:
 *
 * - la tabla de nombres: el nombre de lugar de cada provincia y municipio con oficial bilingüe, por
 *   su código INE, con la forma castellana de `FORMAS_CASTELLANAS`;
 * - el contorno de la Comunitat Valenciana, con que el mapa base y el buscador deciden la forma de
 *   lo que no trae código INE.
 *
 * La orden `nombres` los vuelve a escribir cuando cambian los límites.
 */

/**
 * Tolerancia de la simplificación del contorno. Con 400 m ningún municipio del IGN ni ningún lugar
 * de las teselas de OpenFreeMap de los zooms 8 a 10 cambia de lado respecto del contorno sin
 * simplificar (prototipo del 03/10/2026), y el fichero se queda en unos 3,5 KB con gzip.
 */
export const TOLERANCIA_COMUNITAT_METROS = 400;

/**
 * Los islotes de menos de 1 km² no van, como en el contorno de España: Tabarca y las Columbretes
 * no tienen ningún rótulo con barra.
 */
export const AREA_MINIMA_COMUNITAT_KM2 = 1;

/** Un oficial bilingüe sin forma castellana decidida, o una forma que sobra: no se escribe nada. */
export class NombresSinDecidir extends Schema.TaggedError<NombresSinDecidir>()(
  "NombresSinDecidir",
  { motivos: Schema.Array(Schema.String) },
) {
  override get message() {
    return `Faltan formas castellanas en formasCastellanas.ts: ${this.motivos.join("; ")}`;
  }
}

/**
 * La fila de la tabla de un oficial bilingüe: en la Comunitat Valenciana, la forma que no es la
 * castellana; fuera, la castellana. Un motivo si la castellana falta o no es una de las dos.
 */
const filaDe = (
  codigo: string,
  oficial: string,
  formas: readonly [string, string],
  castellanas: ReadonlyMap<string, string>,
): Result.Result<NombreBilingue, string> => {
  const castellana = castellanas.get(codigo);
  if (castellana === undefined) return Result.fail(`${codigo} ${oficial} no tiene`);
  if (!formas.includes(castellana)) {
    return Result.fail(`${codigo} ${oficial} tiene «${castellana}», que no es ninguna de las dos`);
  }
  const [una, otra] = formas;
  const local = una === castellana ? otra : una;
  return Result.succeed({
    oficial,
    nombre: deLaComunitatValenciana(codigo) ? local : castellana,
  });
};

/**
 * La tabla de nombres de los límites: una fila por provincia y por municipio con oficial bilingüe,
 * por código INE. Falla, con todos los motivos juntos, si alguno no tiene forma castellana, si no
 * es una de sus dos partes o si `castellanas` tiene un código que no es bilingüe.
 */
export const tablaDeNombres = (
  limites: LimitesDeMunicipios,
  castellanas: ReadonlyMap<string, string>,
): Result.Result<TablaDeNombres, NombresSinDecidir> => {
  const motivos: Array<string> = [];
  const usados = new Set<string>();
  const filas = (lugares: ReadonlyArray<{ readonly codigo: string; readonly nombre: string }>) => {
    const tabla: Record<string, NombreBilingue> = {};
    for (const { codigo, nombre } of lugares) {
      const formas = formasDe(nombre);
      if (formas === undefined) continue;
      usados.add(codigo);
      const fila = filaDe(codigo, nombre, formas, castellanas);
      if (Result.isFailure(fila)) motivos.push(fila.failure);
      else tabla[codigo] = fila.success;
    }
    return tabla;
  };
  const provincias = filas(limites.provincias);
  const municipios = filas(limites.territorios.filter((t) => t.tipo === "municipio"));
  for (const codigo of castellanas.keys()) {
    if (!usados.has(codigo)) motivos.push(`${codigo} sobra: su oficial ya no es bilingüe`);
  }
  return motivos.length > 0
    ? Result.fail(new NombresSinDecidir({ motivos }))
    : Result.succeed({ fuente: limites.fuente, provincias, municipios });
};

/** El fichero de la tabla, con una provincia o un municipio por línea. */
export const ficheroDeNombres = (tabla: TablaDeNombres): string => {
  const lineas = (filas: TablaDeNombres["provincias"]) =>
    Object.entries(filas)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([codigo, fila]) => `${JSON.stringify(codigo)}:${JSON.stringify(fila)}`)
      .join(",\n");
  return (
    `{"fuente":${JSON.stringify(tabla.fuente)},\n` +
    `"provincias":{\n${lineas(tabla.provincias)}\n},\n` +
    `"municipios":{\n${lineas(tabla.municipios)}\n}}\n`
  );
};

/**
 * El contorno de la Comunitat Valenciana: la unión de los recintos de sus tres provincias, como
 * el contorno de España, con el Rincón de Ademuz, que sale como otro polígono.
 */
export const contornoDeLaComunitatValenciana = (
  limites: LimitesDeMunicipios,
  toleranciaMetros: number,
  areaMinimaKm2: number,
): Result.Result<Contorno, ContornoImposible> =>
  contornoDeLaUnion(
    {
      ...limites,
      territorios: limites.territorios.filter(
        (t) => t.provincia !== null && PROVINCIAS_DE_LA_COMUNITAT_VALENCIANA.includes(t.provincia),
      ),
    },
    toleranciaMetros,
    areaMinimaKm2,
  );

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));

/**
 * Lee los límites de `municipios` y escribe la tabla de nombres en `destinoTabla` y el contorno de
 * la Comunitat Valenciana en `destinoContorno`. Si algo falla, no escribe ninguno.
 */
export const escribirNombres = Effect.fn("Capas.escribirNombres")(function* (
  municipios: string,
  castellanas: ReadonlyMap<string, string>,
  destinoTabla: string,
  destinoContorno: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const limites = yield* decodificarLimites(yield* fs.readFileString(municipios));
  const tabla = yield* Effect.fromResult(tablaDeNombres(limites, castellanas));
  const contorno = yield* Effect.fromResult(
    contornoDeLaComunitatValenciana(
      limites,
      TOLERANCIA_COMUNITAT_METROS,
      AREA_MINIMA_COMUNITAT_KM2,
    ),
  );
  const ficheroTabla = ficheroDeNombres(tabla);
  const ficheroContorno = ficheroDeContorno(
    limites,
    contorno,
    TOLERANCIA_COMUNITAT_METROS,
    AREA_MINIMA_COMUNITAT_KM2,
  );
  yield* fs.writeFileString(destinoTabla, ficheroTabla);
  yield* fs.writeFileString(destinoContorno, ficheroContorno);
  return {
    tabla,
    contorno,
    bytesTabla: new TextEncoder().encode(ficheroTabla).length,
    bytesContorno: ficheroContorno.length,
  };
});
