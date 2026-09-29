import type { Caja } from "@celda/dominio/barrido";
import { arcoDe, LimitesDeMunicipios, type Territorio } from "@celda/dominio/municipio";
import type { IndiceDeZonas } from "@celda/dominio/zonaDelEjercicio";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ficheroDeMunicipios } from "./municipios.ts";
import { codificarArco, simplificarArco } from "./topologia.ts";

/**
 * Las zonas del ejercicio de emplazamientos que lleva la web (ADR 0017): el índice de municipios
 * para buscarlos y, por provincia, el contorno de sus municipios para dibujar la zona y elegirla
 * en el mapa. Salen de los límites del repositorio, sin descargar nada: la orden `zonas` los
 * vuelve a escribir cuando cambian los límites.
 */

/** Tolerancia de los contornos: basta para dibujar un municipio y elegirlo con el dedo. */
export const TOLERANCIA_CONTORNOS_METROS = 200;

/** Resolución de los contornos: diezmilésimas de grado, unos 11 m. */
export const UNIDADES_CONTORNOS = 10_000;

/** Un arco en diferencias como vértices seguidos, en las mismas unidades. */
const absoluto = (arco: ReadonlyArray<number>): Array<number> => {
  const vertices: Array<number> = [];
  let x = 0;
  let y = 0;
  for (let k = 0; k + 1 < arco.length; k += 2) {
    x += arco[k] ?? 0;
    y += arco[k + 1] ?? 0;
    vertices.push(x, y);
  }
  return vertices;
};

/** La caja de unos arcos en diferencias, en grados. */
const cajaDeArcos = (arcos: ReadonlyArray<ReadonlyArray<number>>, porGrado: number): Caja => {
  let [oeste, sur, este, norte] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const arco of arcos) {
    const vertices = absoluto(arco);
    for (let k = 0; k + 1 < vertices.length; k += 2) {
      oeste = Math.min(oeste, vertices[k] ?? 0);
      este = Math.max(este, vertices[k] ?? 0);
      sur = Math.min(sur, vertices[k + 1] ?? 0);
      norte = Math.max(norte, vertices[k + 1] ?? 0);
    }
  }
  return [oeste / porGrado, sur / porGrado, este / porGrado, norte / porGrado];
};

/**
 * Los contornos de cada provincia: sus municipios y sus territorios compartidos con los límites
 * simplificados a `TOLERANCIA_CONTORNOS_METROS` y en `UNIDADES_CONTORNOS`. Cada arco se simplifica
 * una vez, así que dos municipios vecinos siguen compartiendo el mismo límite. Cada provincia lleva
 * solo sus arcos, renumerados. Es una función pura.
 */
export const contornosDeProvincias = (
  limites: LimitesDeMunicipios,
): ReadonlyMap<string, LimitesDeMunicipios> => {
  const divisor = limites.unidadesPorGrado / UNIDADES_CONTORNOS;
  const arcos = limites.arcos.map((arco) =>
    codificarArco(
      simplificarArco(absoluto(arco), TOLERANCIA_CONTORNOS_METROS, limites.unidadesPorGrado),
      divisor,
    ),
  );
  const porProvincia = new Map<string, Array<Territorio>>();
  for (const territorio of limites.territorios) {
    if (territorio.provincia === null) continue;
    const suyos = porProvincia.get(territorio.provincia) ?? [];
    suyos.push(territorio);
    porProvincia.set(territorio.provincia, suyos);
  }
  return new Map(
    limites.provincias.flatMap((provincia) => {
      const territorios = porProvincia.get(provincia.codigo);
      if (territorios === undefined) return [];
      const nuevos = new Map<number, number>();
      const propios: Array<ReadonlyArray<number>> = [];
      const renumerar = (referencia: number): number => {
        const arco = arcoDe(referencia);
        let nuevo = nuevos.get(arco);
        if (nuevo === undefined) {
          nuevo = propios.length;
          nuevos.set(arco, nuevo);
          propios.push(arcos[arco] ?? []);
        }
        return referencia >= 0 ? nuevo : ~nuevo;
      };
      const renumerados = territorios.map((t) => ({
        ...t,
        poligonos: t.poligonos.map((anillos) => anillos.map((anillo) => anillo.map(renumerar))),
      }));
      const contorno: LimitesDeMunicipios = {
        fuente: limites.fuente,
        toleranciaMetros: TOLERANCIA_CONTORNOS_METROS,
        unidadesPorGrado: UNIDADES_CONTORNOS,
        provincias: [provincia],
        territorios: renumerados,
        arcos: propios,
      };
      return [[provincia.codigo, contorno] as const];
    }),
  );
};

/** El índice de zonas: las provincias con la caja de sus contornos y los municipios por código. */
export const indiceDeZonas = (
  limites: LimitesDeMunicipios,
  contornos: ReadonlyMap<string, LimitesDeMunicipios>,
): IndiceDeZonas => ({
  fuente: limites.fuente,
  toleranciaMetros: TOLERANCIA_CONTORNOS_METROS,
  provincias: limites.provincias.flatMap((p) => {
    const contorno = contornos.get(p.codigo);
    return contorno === undefined
      ? []
      : [
          {
            codigo: p.codigo,
            nombre: p.nombre,
            caja: cajaDeArcos(contorno.arcos, contorno.unidadesPorGrado),
          },
        ];
  }),
  municipios: limites.territorios
    .filter((t) => t.tipo === "municipio" && t.provincia !== null)
    .map((t) => [t.codigo, t.nombre] as const)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
});

const lineas = <A>(elementos: ReadonlyArray<A>) =>
  elementos.map((elemento) => JSON.stringify(elemento)).join(",\n");

/** El fichero del índice, con una provincia o un municipio por línea. */
export const ficheroDeIndice = (indice: IndiceDeZonas): string =>
  `{"fuente":${JSON.stringify(indice.fuente)},` +
  `"toleranciaMetros":${indice.toleranciaMetros},"provincias":[\n` +
  `${lineas(indice.provincias)}\n],"municipios":[\n` +
  `${lineas(indice.municipios)}\n]}\n`;

/**
 * El fichero de las provincias del índice, sin los municipios, con una provincia por línea: lo
 * que la web necesita para saber en qué provincia cae el centro del mapa.
 */
export const ficheroDeProvincias = (indice: IndiceDeZonas): string =>
  `{"fuente":${JSON.stringify(indice.fuente)},"provincias":[\n${lineas(indice.provincias)}\n]}\n`;

/**
 * Los ficheros de las zonas, por nombre: `indice.json`, `provincias.json` y uno por provincia,
 * `08.json`.
 */
export const ficherosDeZonas = (limites: LimitesDeMunicipios): ReadonlyMap<string, string> => {
  const contornos = contornosDeProvincias(limites);
  const indice = indiceDeZonas(limites, contornos);
  return new Map([
    ["indice.json", ficheroDeIndice(indice)],
    ["provincias.json", ficheroDeProvincias(indice)],
    ...[...contornos].map(
      ([codigo, contorno]) => [`${codigo}.json`, ficheroDeMunicipios(contorno)] as const,
    ),
  ]);
};

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));

/**
 * Lee los límites de `municipios` y escribe en `carpeta` el índice y el contorno de cada
 * provincia. Devuelve los ficheros escritos, por nombre, con sus bytes.
 */
export const escribirZonas = Effect.fn("Capas.escribirZonas")(function* (
  municipios: string,
  carpeta: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ficheros = ficherosDeZonas(yield* decodificarLimites(yield* fs.readFileString(municipios)));
  yield* fs.makeDirectory(carpeta, { recursive: true });
  for (const [nombre, contenido] of ficheros) {
    yield* fs.writeFileString(path.join(carpeta, nombre), contenido);
  }
  return new Map([...ficheros].map(([nombre, contenido]) => [nombre, contenido.length] as const));
});
