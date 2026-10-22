import { FuenteDeMunicipios } from "@celda/dominio/municipio";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { descargarDelIgn, type OpcionesDelIgn } from "./descargaDeMunicipios.ts";
import { GmlIlegible, MILLONESIMAS } from "./gml.ts";
import { codificarArco, simplificarArco } from "./topologia.ts";

/**
 * Las fronteras terrestres de España del IGN (ADR 0023): con Portugal, Francia, Andorra y
 * Marruecos en Ceuta, Melilla y el peñón de Vélez de la Gomera. Salen de las líneas de primer
 * orden (`au:AdministrativeBoundary`, «líneas de frontera») de la misma descarga masiva que los
 * municipios. Ese GML trae también la costa; aquí solo se guarda lo que separa España de otro
 * país, para que la orden `limites` sepa qué arcos del borde de los municipios son frontera.
 */

/** El GML de las líneas de frontera dentro del ZIP del IGN. */
const GML_FRONTERAS = "au_AdministrativeBoundary_1stOrder0.gml";

/**
 * El país al otro lado de una línea de primer orden, por el código del IGN que va tras el de
 * España en su identificador (`M34000000000M35000000000T…`). El IGN no publica la tabla; sale de
 * dónde cae cada línea, y `fronterasReal.test.ts` lo comprueba con sitios conocidos. Los códigos
 * 97, 98 y 99 son el mar (el Atlántico, el Mediterráneo y el Cantábrico) y no se guardan.
 */
const PAIS_DEL_IGN: ReadonlyMap<string, Vecino> = new Map([
  ["21", "MA"],
  ["33", "FR"],
  ["35", "PT"],
  ["37", "AD"],
]);

/** El país vecino de una frontera, con su código ISO. */
export const Vecino = Schema.Literals(["PT", "FR", "AD", "MA"]);
export type Vecino = typeof Vecino.Type;

/** Lo que guarda el repositorio (`packages/publicacion/datos/fronteras.json`). */
export const FronterasDeEspana = Schema.Struct({
  fuente: FuenteDeMunicipios,
  /** Tolerancia de la simplificación, en metros. */
  toleranciaMetros: Schema.Finite,
  /** Cuántas unidades de las líneas hay en un grado. */
  unidadesPorGrado: Schema.Int,
  /** Cada línea, en diferencias como las de los municipios: `[x0, y0, dx1, dy1, …]`. */
  lineas: Schema.Array(Schema.Struct({ vecino: Vecino, linea: Schema.Array(Schema.Int) })),
});
export type FronterasDeEspana = typeof FronterasDeEspana.Type;

/**
 * 20 m: los arcos de los municipios, simplificados a 50 m, quedan a menos de 100 m de la línea
 * guardada, y la costa más cercana, a más de 200 m (`tiposDeLimite`).
 */
const TOLERANCIA_FRONTERAS_METROS = 20;

/** Cienmilésimas de grado, como los municipios: unos 1,1 m. */
const UNIDADES_FRONTERAS_POR_GRADO = 100_000;

/** Una línea de frontera del GML, en millonésimas y con longitud antes que latitud. */
interface LineaDeFrontera {
  readonly vecino: Vecino;
  readonly vertices: ReadonlyArray<number>;
}

const leerLineas = (texto: string): ReadonlyArray<LineaDeFrontera> => {
  const lineas: Array<LineaDeFrontera> = [];
  let mar = 0;
  let k = texto.indexOf("<wfs:member>");
  while (k !== -1) {
    const fin = texto.indexOf("</wfs:member>", k);
    if (fin === -1) throw new Error("un miembro sin cerrar");
    const miembro = texto.slice(k, fin);
    const id = /<base:localId>M34\d{9}M(\d{2})\d{9}T\d+<\/base:localId>/u.exec(miembro)?.[1];
    const lista = /<gml:posList>([^<]+)<\/gml:posList>/u.exec(miembro)?.[1];
    if (id === undefined || lista === undefined) throw new Error("un miembro sin código o línea");
    const vecino = PAIS_DEL_IGN.get(id);
    if (vecino === undefined) {
      if (!["97", "98", "99"].includes(id)) throw new Error(`código de país desconocido: ${id}`);
      mar += 1;
    } else {
      const numeros = lista.trim().split(/\s+/u).map(Number);
      const vertices: Array<number> = [];
      for (let n = 0; n + 1 < numeros.length; n += 2) {
        vertices.push(
          Math.round((numeros[n + 1] ?? 0) * MILLONESIMAS),
          Math.round((numeros[n] ?? 0) * MILLONESIMAS),
        );
      }
      if (vertices.some((v) => !Number.isFinite(v))) throw new Error("un vértice mal formado");
      lineas.push({ vecino, vertices });
    }
    k = texto.indexOf("<wfs:member>", fin);
  }
  if (mar === 0) throw new Error("no trae ninguna línea de costa: ¿es el GML de fronteras?");
  return lineas;
};

/** Las líneas de frontera terrestre de un GML de primer orden del IGN, sin la costa. */
const fronterasDelGml = (
  texto: string,
): Result.Result<ReadonlyArray<LineaDeFrontera>, GmlIlegible> =>
  Result.try({
    try: () => leerLineas(texto),
    catch: (causa) =>
      new GmlIlegible({ motivo: causa instanceof Error ? causa.message : String(causa) }),
  });

/** Las fronteras simplificadas a `TOLERANCIA_FRONTERAS_METROS`, listas para guardar. */
const fronterasDeEspana = (
  lineas: ReadonlyArray<LineaDeFrontera>,
  fuente: FuenteDeMunicipios,
): FronterasDeEspana => ({
  fuente,
  toleranciaMetros: TOLERANCIA_FRONTERAS_METROS,
  unidadesPorGrado: UNIDADES_FRONTERAS_POR_GRADO,
  lineas: lineas.map(({ vecino, vertices }) => ({
    vecino,
    linea: codificarArco(
      simplificarArco(vertices, TOLERANCIA_FRONTERAS_METROS, MILLONESIMAS),
      MILLONESIMAS / UNIDADES_FRONTERAS_POR_GRADO,
    ),
  })),
});

/** El fichero de las fronteras, con una línea por renglón. */
const ficheroDeFronteras = (fronteras: FronterasDeEspana): string =>
  `{"fuente":${JSON.stringify(fronteras.fuente)},` +
  `"toleranciaMetros":${fronteras.toleranciaMetros},"unidadesPorGrado":${fronteras.unidadesPorGrado},"lineas":[\n` +
  `${fronteras.lineas.map((linea) => JSON.stringify(linea)).join(",\n")}\n]}\n`;

const decodificarFronteras = Schema.decodeEffect(Schema.fromJsonString(FronterasDeEspana));

/** Lee las fronteras guardadas en el repositorio. */
export const leerFronteras = Effect.fn("Capas.leerFronteras")(function* (ruta: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* decodificarFronteras(yield* fs.readFileString(ruta));
});

/**
 * La orden `fronteras`: lee las líneas de frontera de la descarga masiva del IGN (la misma que la
 * orden `municipios`, que se reutiliza si ya está en la caché) y las guarda en `destino`.
 */
export const descargarFronteras = Effect.fn("Capas.descargarFronteras")(function* (
  opciones: OpcionesDelIgn,
  destino: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const { fuente, gml } = yield* descargarDelIgn(opciones);
  const lineas = yield* Effect.fromResult(fronterasDelGml(yield* gml(GML_FRONTERAS)));
  const fronteras = fronterasDeEspana(lineas, fuente);
  const fichero = ficheroDeFronteras(fronteras);
  yield* fs.writeFileString(destino, fichero);
  return { fronteras, fichero };
});
