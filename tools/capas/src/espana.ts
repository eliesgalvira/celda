import type { Anillo } from "@celda/dominio/barrio";
import { arcoDe, LimitesDeMunicipios } from "@celda/dominio/municipio";
import { areaKm2 } from "@celda/dominio/poblacion";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { simplificarArco } from "./topologia.ts";

/**
 * El contorno de España que usa el mapa base para no rotular de lejos los lugares de fuera (ADR
 * 0024): la unión de todos los recintos del IGN del repositorio, con las islas de 1 km² o más,
 * simplificada a 400 m. Sale de los límites de municipios sin descargar nada; la orden `espana`
 * lo vuelve a escribir cuando cambian.
 */

/**
 * Tolerancia de la simplificación. Con 400 m, ninguna ciudad ni ningún pueblo grande de las
 * teselas de OpenFreeMap del zoom 8 cambia de lado respecto del contorno sin simplificar
 * (prototipo del 03/10/2026), y el fichero se queda en unos 24 KB con gzip.
 */
export const TOLERANCIA_ESPANA_METROS = 400;

/**
 * Las islas y los islotes más pequeños no van: a esa escala no hay ningún pueblo que rotular, y
 * cada uno serían cuatro vértices más. Quedan fuera las Chafarinas, el peñón de Vélez de la Gomera
 * y los islotes de la costa.
 */
export const AREA_MINIMA_ESPANA_KM2 = 1;

/** Cuatro decimales: unos 10 m, de sobra para una tolerancia de 400. */
const DECIMALES = 4;

/** El contorno, como la geometría `MultiPolygon` de GeoJSON, en grados. */
export interface Contorno {
  readonly type: "MultiPolygon";
  readonly coordinates: ReadonlyArray<ReadonlyArray<Anillo>>;
}

/** Los límites no se pueden unir en un contorno cerrado y sin agujeros: no se escribe nada. */
export class ContornoImposible extends Schema.TaggedError<ContornoImposible>()(
  "ContornoImposible",
  { motivo: Schema.String },
) {
  override get message() {
    return `No sale el contorno: ${this.motivo}`;
  }
}

/** Un arco en diferencias como vértices `[x, y]`, en las mismas unidades. */
const verticesDe = (arco: ReadonlyArray<number>): Array<readonly [number, number]> => {
  const vertices: Array<readonly [number, number]> = [];
  let x = 0;
  let y = 0;
  for (let k = 0; k + 1 < arco.length; k += 2) {
    x += arco[k] ?? 0;
    y += arco[k + 1] ?? 0;
    vertices.push([x, y]);
  }
  return vertices;
};

const claveDe = ([x, y]: readonly [number, number]): string => `${x},${y}`;

/** El doble del área con signo de un anillo cerrado: positiva si va contra las agujas del reloj. */
const dobleAreaConSigno = (anillo: ReadonlyArray<readonly [number, number]>): number => {
  let doble = 0;
  for (let k = 0; k + 1 < anillo.length; k++) {
    const [x1 = 0, y1 = 0] = anillo[k] ?? [];
    const [x2 = 0, y2 = 0] = anillo[k + 1] ?? [];
    doble += x1 * y2 - x2 * y1;
  }
  return doble;
};

/** Un anillo de la unión, en las unidades de los límites, y si lo forman bordes de agujeros. */
interface AnilloDeLaUnion {
  readonly vertices: ReadonlyArray<readonly [number, number]>;
  readonly deAgujero: boolean;
}

/**
 * Los bordes de la unión de los recintos. Un arco que solo usa un recinto es borde de la unión;
 * uno que usan dos queda dentro. Cada borde va en el sentido en que lo recorre su recinto.
 */
const bordesDeLaUnion = (limites: LimitesDeMunicipios): Array<AnilloDeLaUnion> => {
  const usos = new Map<number, number>();
  for (const referencia of limites.territorios.flatMap((t) => t.poligonos.flat(2))) {
    const arco = arcoDe(referencia);
    usos.set(arco, (usos.get(arco) ?? 0) + 1);
  }
  return limites.territorios.flatMap((territorio) =>
    territorio.poligonos.flatMap((anillos) =>
      anillos.flatMap((anillo, k) =>
        anillo.flatMap((referencia) => {
          const arco = arcoDe(referencia);
          if (usos.get(arco) !== 1) return [];
          const vertices = verticesDe(limites.arcos[arco] ?? []);
          return [
            {
              vertices: referencia >= 0 ? vertices : vertices.toReversed(),
              deAgujero: k > 0,
            },
          ];
        }),
      ),
    ),
  );
};

/**
 * Los anillos de la unión: sus bordes encadenados por sus extremos hasta cerrar cada anillo. Un
 * anillo hecho con el agujero de algún recinto es un agujero de la unión: nadie lo llena.
 */
const anillosDeLaUnion = (
  limites: LimitesDeMunicipios,
): Result.Result<Array<AnilloDeLaUnion>, ContornoImposible> => {
  const bordes = bordesDeLaUnion(limites);
  const porInicio = new Map<string, Array<number>>();
  for (const [k, borde] of bordes.entries()) {
    const clave = claveDe(borde.vertices[0] ?? [0, 0]);
    porInicio.set(clave, [...(porInicio.get(clave) ?? []), k]);
  }
  const usados = new Uint8Array(bordes.length);
  const siguienteDe = (vertice: readonly [number, number]) =>
    (porInicio.get(claveDe(vertice)) ?? []).find((j) => usados[j] === 0);
  const anillos: Array<AnilloDeLaUnion> = [];
  for (const [k, borde] of bordes.entries()) {
    if (usados[k] === 1) continue;
    usados[k] = 1;
    const vertices = [...borde.vertices];
    let deAgujero = borde.deAgujero;
    const inicio = claveDe(vertices[0] ?? [0, 0]);
    for (let ultimo = vertices.at(-1) ?? [0, 0]; claveDe(ultimo) !== inicio;) {
      const siguiente = siguienteDe(ultimo);
      const otro = siguiente === undefined ? undefined : bordes[siguiente];
      if (siguiente === undefined || otro === undefined) {
        const grados = `${ultimo[0] / limites.unidadesPorGrado}, ${ultimo[1] / limites.unidadesPorGrado}`;
        return Result.fail(new ContornoImposible({ motivo: `el borde no se cierra en ${grados}` }));
      }
      usados[siguiente] = 1;
      vertices.push(...otro.vertices.slice(1));
      deAgujero ||= otro.deAgujero;
      ultimo = vertices.at(-1) ?? [0, 0];
    }
    anillos.push({ vertices, deAgujero });
  }
  return Result.succeed(anillos);
};

const redondear = (valor: number, porGrado: number): number =>
  Math.round((valor / porGrado) * 10 ** DECIMALES) / 10 ** DECIMALES;

/** Un anillo simplificado y en grados, sin vértices repetidos y contra las agujas del reloj. */
const simplificarAnillo = (
  anillo: ReadonlyArray<readonly [number, number]>,
  toleranciaMetros: number,
  porGrado: number,
): Anillo => {
  // Un anillo cerrado: `simplificarArco` lo parte por su vértice más lejano y nunca lo deja en
  // menos de cuatro vértices.
  const simplificado = simplificarArco(anillo.flat(), toleranciaMetros, porGrado);
  const redondeado: Array<readonly [number, number]> = [];
  for (let k = 0; k + 1 < simplificado.length; k += 2) {
    const vertice = [
      redondear(simplificado[k] ?? 0, porGrado),
      redondear(simplificado[k + 1] ?? 0, porGrado),
    ] as const;
    const anterior = redondeado.at(-1);
    if (anterior === undefined || anterior[0] !== vertice[0] || anterior[1] !== vertice[1]) {
      redondeado.push(vertice);
    }
  }
  return dobleAreaConSigno(redondeado) < 0 ? redondeado.toReversed() : redondeado;
};

/**
 * El contorno de los recintos de los límites, como el de España: la unión de todos, con municipio,
 * compartidos o sin provincia, sin las islas de menos de `areaMinimaKm2` y con cada anillo
 * simplificado a `toleranciaMetros`. Cada anillo es un polígono, en el sentido contrario a las
 * agujas del reloj, como pide GeoJSON. Gibraltar va dentro: el IGN lo da como territorio sin
 * provincia.
 *
 * La unión de los términos municipales no tiene agujeros: dentro de España no hay ningún
 * territorio de otro país (Llívia es al revés, España dentro de Francia, y sale como otro
 * polígono). Si algún día sale un agujero de `areaMinimaKm2` o más, o un borde abierto, falla en
 * lugar de dar un contorno que pinte como España lo que no lo es. Con los recintos de unas pocas
 * provincias, como el contorno de la Comunitat Valenciana (`nombres.ts`), vale lo mismo.
 */
export const contornoDeLaUnion = (
  limites: LimitesDeMunicipios,
  toleranciaMetros: number,
  areaMinimaKm2: number,
): Result.Result<Contorno, ContornoImposible> =>
  Result.flatMap(anillosDeLaUnion(limites), (anillos) => {
    const porGrado = limites.unidadesPorGrado;
    const enGrados = (anillo: ReadonlyArray<readonly [number, number]>): Anillo =>
      anillo.map(([x, y]) => [x / porGrado, y / porGrado] as const);
    const grandes = anillos.filter(
      (anillo) => areaKm2([[enGrados(anillo.vertices)]]) >= areaMinimaKm2,
    );
    const agujero = grandes.find((anillo) => anillo.deAgujero);
    if (agujero !== undefined) {
      const [x = 0, y = 0] = agujero.vertices[0] ?? [];
      const grados = `${x / porGrado}, ${y / porGrado}`;
      return Result.fail(new ContornoImposible({ motivo: `hay un agujero en ${grados}` }));
    }
    return Result.succeed({
      type: "MultiPolygon",
      coordinates: grandes.map((anillo) => [
        simplificarAnillo(anillo.vertices, toleranciaMetros, porGrado),
      ]),
    });
  });

/** El fichero del contorno, con la fuente, cómo se hizo y un polígono por línea. */
export const ficheroDeContorno = (
  limites: LimitesDeMunicipios,
  contorno: Contorno,
  toleranciaMetros: number,
  areaMinimaKm2: number,
): string =>
  `{"fuente":${JSON.stringify(limites.fuente)},` +
  `"toleranciaMetros":${toleranciaMetros},"areaMinimaKm2":${areaMinimaKm2},` +
  `"contorno":{"type":"MultiPolygon","coordinates":[\n` +
  `${contorno.coordinates.map((poligono) => JSON.stringify(poligono)).join(",\n")}\n]}}\n`;

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));

/**
 * Lee los límites de `municipios` y escribe en `destino` el contorno de España. Devuelve el
 * contorno escrito y los bytes del fichero.
 */
export const escribirEspana = Effect.fn("Capas.escribirEspana")(function* (
  municipios: string,
  destino: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const limites = yield* decodificarLimites(yield* fs.readFileString(municipios));
  const contorno = yield* Effect.fromResult(
    contornoDeLaUnion(limites, TOLERANCIA_ESPANA_METROS, AREA_MINIMA_ESPANA_KM2),
  );
  const fichero = ficheroDeContorno(
    limites,
    contorno,
    TOLERANCIA_ESPANA_METROS,
    AREA_MINIMA_ESPANA_KM2,
  );
  yield* fs.writeFileString(destino, fichero);
  return { contorno, bytes: fichero.length };
});
