import type { CentroDeProvincia, CentrosDeProvincia } from "@celda/dominio/centroVisual";
import {
  type Ciudad,
  type HabitantesDeCiudades,
  MINIMO_DE_HABITANTES,
} from "@celda/dominio/habitantesDeCiudades";
import {
  LimitesDeMunicipios,
  municipiosConHabitantes,
  PadronDeMunicipios,
} from "@celda/dominio/municipio";
import { nombreDeLugarDeMunicipio } from "@celda/dominio/nombreDeLugar";
import { dentroDelPoligono, type PoligonoEnGrados } from "@celda/dominio/poligono";
import { areaKm2 } from "@celda/dominio/poblacion";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { anillosDeLaUnion, type ContornoImposible } from "./espana.ts";
import { type PoligonoPlano, poloDeInaccesibilidad } from "./poloDeInaccesibilidad.ts";

/**
 * Lo que necesita la regla de choques del mapa (ADR 0024), sacado de los límites y el padrón del
 * repositorio sin descargar nada:
 *
 * - el centro visual de cada provincia, donde va su hexágono de lejos, y sus habitantes;
 * - los habitantes de las ciudades que el mapa base rotula de lejos, por su nombre de lugar.
 *
 * La orden `centros` los vuelve a escribir cuando cambian los límites o el padrón.
 */

/**
 * A cuánto se simplifica cada anillo antes de buscar el centro. Con 300 m el centro no se mueve
 * más que la precisión y el cálculo de las 52 provincias tarda unos segundos (prototipo del
 * 03/10/2026, e0b75de).
 */
export const TOLERANCIA_CENTROS_METROS = 300;

/** La precisión del polo de inaccesibilidad. A z5,5 un píxel son más de 2 km. */
export const PRECISION_CENTROS_METROS = 200;

/** Radio de la Tierra en la proyección de Mercator de la web, en metros. */
const RADIO = 6_378_137;

const aMercator = ([longitud, latitud]: readonly [number, number]): readonly [number, number] => [
  RADIO * ((longitud * Math.PI) / 180),
  RADIO * Math.log(Math.tan(Math.PI / 4 + (latitud * Math.PI) / 360)),
];

const deMercator = (x: number, y: number): readonly [number, number] => [
  (x / RADIO) * (180 / Math.PI),
  (2 * Math.atan(Math.exp(y / RADIO)) - Math.PI / 2) * (180 / Math.PI),
];

/** Cuatro decimales: unos 10 m, de sobra para una precisión de 200. */
const redondear = (grados: number): number => Math.round(grados * 1e4) / 1e4;

/** El doble del área con signo de un anillo: positiva si va contra las agujas del reloj. */
const dobleArea = (anillo: ReadonlyArray<readonly [number, number]>): number => {
  let doble = 0;
  for (let k = 0; k + 1 < anillo.length; k++) {
    const [x1 = 0, y1 = 0] = anillo[k] ?? [];
    const [x2 = 0, y2 = 0] = anillo[k + 1] ?? [];
    doble += x1 * y2 - x2 * y1;
  }
  return doble;
};

/** Un anillo de la unión en grados, y si lo forman bordes de agujeros de algún recinto. */
export interface AnilloEnGrados {
  readonly vertices: ReadonlyArray<readonly [number, number]>;
  readonly deAgujero: boolean;
}

/**
 * Los polígonos de unos anillos sin orden. Es agujero el que forman bordes de agujeros de algún
 * recinto y el que gira al revés que el mayor; cada agujero va con el exterior más pequeño que lo
 * contiene. Un enclave rodeado por varios municipios (el condado de Treviño dentro de Álava) no
 * es el agujero de ninguno: sale como un anillo que gira al revés.
 */
export const poligonosDeAnillos = (
  anillos: ReadonlyArray<AnilloEnGrados>,
): ReadonlyArray<PoligonoEnGrados> => {
  const mayor = anillos.reduce<AnilloEnGrados | undefined>(
    (actual, anillo) =>
      actual === undefined ||
      Math.abs(dobleArea(anillo.vertices)) > Math.abs(dobleArea(actual.vertices))
        ? anillo
        : actual,
    undefined,
  );
  if (mayor === undefined) return [];
  const sentido = Math.sign(dobleArea(mayor.vertices));
  const esAgujero = (anillo: AnilloEnGrados) =>
    anillo.deAgujero || Math.sign(dobleArea(anillo.vertices)) !== sentido;
  const poligonos = anillos
    .filter((anillo) => !esAgujero(anillo))
    .map((exterior) => [exterior.vertices]);
  for (const agujero of anillos.filter(esAgujero)) {
    const [x = 0, y = 0] = agujero.vertices[0] ?? [];
    const suyo = poligonos
      .filter(([exterior = []]) => dentroDelPoligono({ longitud: x, latitud: y }, [exterior]))
      .reduce<Array<ReadonlyArray<readonly [number, number]>> | undefined>(
        (actual, poligono) =>
          actual === undefined ||
          Math.abs(dobleArea(poligono[0] ?? [])) < Math.abs(dobleArea(actual[0] ?? []))
            ? poligono
            : actual,
        undefined,
      );
    suyo?.push(agujero.vertices);
  }
  return poligonos;
};

/** Un polígono de una provincia, con los habitantes de los municipios cuya etiqueta cae en él. */
export interface PoligonoPoblado {
  readonly poligono: PoligonoEnGrados;
  readonly habitantes: number;
  readonly areaKm2: number;
}

/** El centro visual de un polígono en grados, y lo que dista de su borde en metros de verdad. */
export interface CentroCalculado {
  readonly centro: readonly [number, number];
  readonly distanciaAlBordeKm: number;
}

/** Metros por grado de latitud, y de longitud en el ecuador. */
const METROS_POR_GRADO = { x: 111_320, y: 110_570 };

/**
 * Douglas-Peucker sobre un tramo abierto en grados, con la escala de la latitud de su primer
 * vértice. Guarda los extremos y, de lo de en medio, lo que se aparta más de `toleranciaMetros`.
 */
const douglasPeucker = (
  tramo: ReadonlyArray<readonly [number, number]>,
  toleranciaMetros: number,
): Array<readonly [number, number]> => {
  const [, latitud = 0] = tramo[0] ?? [];
  const kx = METROS_POR_GRADO.x * Math.cos((latitud * Math.PI) / 180);
  const plano = tramo.map(([x, y]) => [x * kx, y * METROS_POR_GRADO.y] as const);
  const guardar = new Uint8Array(tramo.length);
  guardar[0] = 1;
  guardar[tramo.length - 1] = 1;
  const pendientes: Array<readonly [number, number]> = [[0, tramo.length - 1]];
  for (let par = pendientes.pop(); par !== undefined; par = pendientes.pop()) {
    const [desde, hasta] = par;
    const [ax, ay] = plano[desde] ?? [0, 0];
    const [bx, by] = plano[hasta] ?? [0, 0];
    const largo = Math.hypot(bx - ax, by - ay);
    let peor = -1;
    let distancia = -1;
    for (let k = desde + 1; k < hasta; k++) {
      const [px, py] = plano[k] ?? [0, 0];
      const d =
        largo > 0
          ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / largo
          : Math.hypot(px - ax, py - ay);
      if (d > distancia) {
        distancia = d;
        peor = k;
      }
    }
    if (distancia > toleranciaMetros) {
      guardar[peor] = 1;
      pendientes.push([desde, peor], [peor, hasta]);
    }
  }
  return tramo.filter((_, k) => guardar[k] === 1);
};

/**
 * Un anillo cerrado simplificado: partido en dos mitades por el vértice del medio, cada una con
 * Douglas-Peucker, para que no se quede en un segmento. `undefined` si se queda en menos de
 * cuatro vértices.
 */
const simplificarAnillo = (
  anillo: ReadonlyArray<readonly [number, number]>,
  toleranciaMetros: number,
): ReadonlyArray<readonly [number, number]> | undefined => {
  const medio = Math.floor(anillo.length / 2);
  const simplificado = [
    ...douglasPeucker(anillo.slice(0, medio + 1), toleranciaMetros).slice(0, -1),
    ...douglasPeucker(anillo.slice(medio), toleranciaMetros),
  ];
  return simplificado.length >= 4 ? simplificado : undefined;
};

/**
 * El centro visual de un polígono: cada anillo simplificado a `toleranciaMetros` y pasado a
 * Mercator, y su polo de inaccesibilidad con `precisionMetros`. Los anillos que se quedan en menos
 * de cuatro vértices no cuentan.
 */
export const centroDelPoligono = (
  poligono: PoligonoEnGrados,
  toleranciaMetros: number,
  precisionMetros: number,
): CentroCalculado => {
  const plano: PoligonoPlano = poligono.flatMap((anillo) => {
    const simplificado = simplificarAnillo(anillo, toleranciaMetros);
    return simplificado === undefined ? [] : [simplificado.map(aMercator)];
  });
  const polo = poloDeInaccesibilidad(plano, precisionMetros);
  const [longitud, latitud] = deMercator(polo.x, polo.y);
  // Un metro de Mercator mide cos(latitud) metros de verdad.
  const distanciaAlBordeKm = (polo.distancia * Math.cos((latitud * Math.PI) / 180)) / 1000;
  return { centro: [redondear(longitud), redondear(latitud)], distanciaAlBordeKm };
};

/** Una provincia con todos sus polígonos poblados, del más poblado al menos, y su centro. */
export interface ProvinciaConCentro {
  readonly codigo: string;
  readonly habitantes: number;
  readonly poligonos: ReadonlyArray<PoligonoPoblado>;
  readonly centro: CentroCalculado;
}

/**
 * El centro visual y los habitantes de cada provincia de los límites. El centro va en su polígono
 * más poblado: el que contiene más habitantes del padrón por la etiqueta de sus municipios y, a
 * igualdad, el mayor. Los polígonos son la unión de los recintos de la provincia, municipios y
 * territorios compartidos.
 */
export const centrosDeProvincia = (
  limites: LimitesDeMunicipios,
  padron: PadronDeMunicipios,
  toleranciaMetros: number,
  precisionMetros: number,
): Result.Result<ReadonlyArray<ProvinciaConCentro>, ContornoImposible> => {
  const municipios = municipiosConHabitantes(limites, padron);
  const porGrado = limites.unidadesPorGrado;
  const provincias: Array<ProvinciaConCentro> = [];
  for (const { codigo } of limites.provincias) {
    const suyos = municipios.filter((m) => m.provincia === codigo);
    const anillos = anillosDeLaUnion({
      ...limites,
      territorios: limites.territorios.filter((t) => t.provincia === codigo),
    });
    if (Result.isFailure(anillos)) return Result.fail(anillos.failure);
    if (anillos.success.length === 0) continue;
    const enGrados = anillos.success.map((anillo) => ({
      vertices: anillo.vertices.map(([x, y]) => [x / porGrado, y / porGrado] as const),
      deAgujero: anillo.deAgujero,
    }));
    const poligonos = poligonosDeAnillos(enGrados)
      .map((poligono): PoligonoPoblado => ({
        poligono,
        habitantes: suyos.reduce(
          (suma, m) =>
            dentroDelPoligono(m.etiqueta, poligono) ? suma + (m.habitantes ?? 0) : suma,
          0,
        ),
        areaKm2: areaKm2([poligono.map((anillo) => anillo.map(([x, y]) => [x, y] as const))]),
      }))
      .toSorted((a, b) => b.habitantes - a.habitantes || b.areaKm2 - a.areaKm2);
    const elegido = poligonos[0];
    if (elegido === undefined) continue;
    provincias.push({
      codigo,
      habitantes: suyos.reduce((suma, m) => suma + (m.habitantes ?? 0), 0),
      poligonos,
      centro: centroDelPoligono(elegido.poligono, toleranciaMetros, precisionMetros),
    });
  }
  return Result.succeed(provincias);
};

/** La tabla de los centros, con las fuentes. */
export const tablaDeCentros = (
  limites: LimitesDeMunicipios,
  padron: PadronDeMunicipios,
  provincias: ReadonlyArray<ProvinciaConCentro>,
): CentrosDeProvincia => ({
  fuente: limites.fuente,
  padron: padron.fuente,
  toleranciaMetros: TOLERANCIA_CENTROS_METROS,
  precisionMetros: PRECISION_CENTROS_METROS,
  provincias: Object.fromEntries(
    provincias.map((p): readonly [string, CentroDeProvincia] => [
      p.codigo,
      { centro: [...p.centro.centro], habitantes: p.habitantes },
    ]),
  ),
});

/** El fichero de los centros, con una provincia por línea. */
export const ficheroDeCentros = (tabla: CentrosDeProvincia): string =>
  `{"fuente":${JSON.stringify(tabla.fuente)},\n"padron":${JSON.stringify(tabla.padron)},\n` +
  `"toleranciaMetros":${tabla.toleranciaMetros},"precisionMetros":${tabla.precisionMetros},\n` +
  `"provincias":{\n${Object.entries(tabla.provincias)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([codigo, fila]) => `${JSON.stringify(codigo)}:${JSON.stringify(fila)}`)
    .join(",\n")}\n}}\n`;

/** Dos decimales: un kilómetro, de sobra para buscar un rótulo a menos de 50. */
const dosDecimales = (grados: number): number => Math.round(grados * 100) / 100;

/**
 * Los municipios de `MINIMO_DE_HABITANTES` o más, con su nombre de lugar, la etiqueta del IGN y
 * sus habitantes, ordenados por nombre.
 */
export const tablaDeCiudades = (
  limites: LimitesDeMunicipios,
  padron: PadronDeMunicipios,
): HabitantesDeCiudades => ({
  padron: padron.fuente,
  minimo: MINIMO_DE_HABITANTES,
  ciudades: municipiosConHabitantes(limites, padron)
    .flatMap((m): ReadonlyArray<Ciudad> =>
      m.habitantes !== null && m.habitantes >= MINIMO_DE_HABITANTES
        ? [
            [
              nombreDeLugarDeMunicipio(m.codigo, m.nombre),
              dosDecimales(m.etiqueta.longitud),
              dosDecimales(m.etiqueta.latitud),
              m.habitantes,
            ],
          ]
        : [],
    )
    .toSorted(([a, x], [b, y]) => a.localeCompare(b, "es") || x - y),
});

/** El fichero de las ciudades, con una por línea. */
export const ficheroDeCiudades = (tabla: HabitantesDeCiudades): string =>
  `{"padron":${JSON.stringify(tabla.padron)},"minimo":${tabla.minimo},"ciudades":[\n` +
  `${tabla.ciudades.map((ciudad) => JSON.stringify(ciudad)).join(",\n")}\n]}\n`;

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));
const decodificarPadron = Schema.decodeEffect(Schema.fromJsonString(PadronDeMunicipios));

/**
 * Lee los límites de `municipios` y el padrón de `padron`, y escribe los centros en
 * `destinoCentros` y las ciudades en `destinoCiudades`. Si algo falla, no escribe ninguno.
 */
export const escribirCentros = Effect.fn("Capas.escribirCentros")(function* (
  municipios: string,
  padron: string,
  destinoCentros: string,
  destinoCiudades: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const limites = yield* decodificarLimites(yield* fs.readFileString(municipios));
  const habitantes = yield* decodificarPadron(yield* fs.readFileString(padron));
  const provincias = yield* Effect.fromResult(
    centrosDeProvincia(limites, habitantes, TOLERANCIA_CENTROS_METROS, PRECISION_CENTROS_METROS),
  );
  const centros = ficheroDeCentros(tablaDeCentros(limites, habitantes, provincias));
  const ciudades = tablaDeCiudades(limites, habitantes);
  const ficheroCiudades = ficheroDeCiudades(ciudades);
  yield* fs.writeFileString(destinoCentros, centros);
  yield* fs.writeFileString(destinoCiudades, ficheroCiudades);
  return {
    provincias,
    ciudades: ciudades.ciudades.length,
    bytesCentros: new TextEncoder().encode(centros).length,
    bytesCiudades: new TextEncoder().encode(ficheroCiudades).length,
  };
});
