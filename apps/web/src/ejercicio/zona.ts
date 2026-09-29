import type { Coordenada, Rectangulo } from "@celda/dominio/area";
import type { Poligono } from "@celda/dominio/barrio";
import type { EmplazamientoDelEjercicio, Vecina } from "@celda/dominio/ejercicio";
import {
  type IndiceDeMunicipios,
  indexarMunicipios,
  LimitesDeMunicipios,
} from "@celda/dominio/municipio";
import { PoblacionDeBarrios } from "@celda/dominio/poblacion";
import { IndiceDeZonas, ProvinciasDeZonas } from "@celda/dominio/zonaDelEjercicio";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

type Vertice = [number, number];

/** Una parte del límite de la zona o una línea de una estación base a su vecina. */
export type RasgoDeZona =
  | {
      type: "Feature";
      properties: Record<string, string>;
      geometry: { type: "Polygon"; coordinates: Array<Array<Vertice>> };
    }
  | {
      type: "Feature";
      properties: Record<string, string>;
      geometry: { type: "LineString"; coordinates: Array<Vertice> };
    };

/** Lo que el mapa dibuja del ejercicio: el límite de la zona y las líneas a las vecinas. */
export interface ZonaEnMapa {
  readonly type: "FeatureCollection";
  readonly features: Array<RasgoDeZona>;
}

export const SIN_ZONA: ZonaEnMapa = { type: "FeatureCollection", features: [] };

const par = (c: Coordenada): Vertice => [c.longitud, c.latitud];

/**
 * La zona para el mapa: un polígono por parte de la zona y una línea de cada estación base a su
 * vecina. Una vecina que no está entre los emplazamientos conocidos no se dibuja.
 */
export const zonaEnMapa = (
  poligonos: ReadonlyArray<Poligono>,
  vecinas: ReadonlyArray<Vecina>,
  emplazamientos: ReadonlyArray<EmplazamientoDelEjercicio>,
): ZonaEnMapa => {
  const posicion = new Map(emplazamientos.map((e) => [e.clave, e.posicion]));
  return {
    type: "FeatureCollection",
    features: [
      ...poligonos.map((poligono): RasgoDeZona => ({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: poligono.map((anillo) => anillo.map(([x, y]): Vertice => [x, y])),
        },
      })),
      ...vecinas.flatMap((vecina): Array<RasgoDeZona> => {
        const desde = posicion.get(vecina.desde);
        const hasta = posicion.get(vecina.hasta);
        return desde === undefined || hasta === undefined
          ? []
          : [
              {
                type: "Feature",
                properties: { desde: vecina.desde, hasta: vecina.hasta },
                geometry: { type: "LineString", coordinates: [par(desde), par(hasta)] },
              },
            ];
      }),
    ],
  };
};

/** El rectángulo que abarca unos polígonos, para encuadrar la zona en el mapa. */
export const encuadreDe = (poligonos: ReadonlyArray<Poligono>): Rectangulo | undefined => {
  const vertices = poligonos.flatMap((p) => p[0] ?? []);
  if (vertices.length === 0) return undefined;
  const lon = vertices.map(([x]) => x);
  const lat = vertices.map(([, y]) => y);
  return {
    suroeste: { longitud: Math.min(...lon), latitud: Math.min(...lat) },
    noreste: { longitud: Math.max(...lon), latitud: Math.max(...lat) },
  };
};

const decodificarPoblacion = Schema.decodeUnknownEffect(PoblacionDeBarrios);
const decodificarIndice = Schema.decodeUnknownEffect(IndiceDeZonas);
const decodificarContorno = Schema.decodeUnknownEffect(LimitesDeMunicipios);
const decodificarProvincias = Schema.decodeUnknownEffect(ProvinciasDeZonas);

/** Algo que el ejercicio descarga al abrirse no ha llegado o no es lo que se esperaba. */
export class ZonasNoCargadas extends Schema.TaggedError<ZonasNoCargadas>()("ZonasNoCargadas", {
  motivo: Schema.String,
}) {}

const noHaLlegado = () => new ZonasNoCargadas({ motivo: "no ha llegado" });

const noEsElEsperado = (error: ZonasNoCargadas | Schema.SchemaError) =>
  error._tag === "ZonasNoCargadas"
    ? error
    : new ZonasNoCargadas({ motivo: "el fichero no es el que se esperaba" });

// Cada fichero va en un trozo aparte de la web que se descarga la primera vez que se pide. El
// padrón de los barrios y el índice solo los pide el ejercicio: quien no usa el modo estudiante no
// los descarga nunca. Las provincias y sus contornos los pide también la cabecera del mapa, desde
// el nivel de provincias, para decir dónde está el centro.

/** Los habitantes, el área y el límite de cada barrio de Barcelona, del padrón de Open Data BCN. */
export const cargarPoblacion: Effect.Effect<PoblacionDeBarrios, ZonasNoCargadas> =
  Effect.tryPromise({ try: () => import("./poblacion.json"), catch: noHaLlegado }).pipe(
    Effect.flatMap((modulo) => decodificarPoblacion(modulo.default)),
    Effect.mapError(noEsElEsperado),
  );

/** El índice de municipios y provincias para buscar una zona (`pnpm run zonas`). */
export const cargarIndiceDeZonas: Effect.Effect<IndiceDeZonas, ZonasNoCargadas> = Effect.tryPromise(
  { try: () => import("./zonas/indice.json"), catch: noHaLlegado },
).pipe(
  Effect.flatMap((modulo) => decodificarIndice(modulo.default)),
  Effect.mapError(noEsElEsperado),
);

/** Las provincias con la caja de sus límites (`pnpm run zonas`), unos 2 KB con gzip. */
export const cargarProvinciasDeZonas: Effect.Effect<ProvinciasDeZonas, ZonasNoCargadas> =
  Effect.tryPromise({ try: () => import("./zonas/provincias.json"), catch: noHaLlegado }).pipe(
    Effect.flatMap((modulo) => decodificarProvincias(modulo.default)),
    Effect.mapError(noEsElEsperado),
  );

/** Los contornos de cada provincia, uno por trozo: solo se descarga el de la que se pide. */
const CONTORNOS = import.meta.glob("./zonas/[0-9][0-9].json", { import: "default" });

/**
 * El contorno de los municipios de una provincia, a 200 m, listo para dibujar un municipio y
 * saber en cuál cae un punto.
 */
export const cargarContornos = (
  provincia: string,
): Effect.Effect<IndiceDeMunicipios, ZonasNoCargadas> => {
  const importar = CONTORNOS[`./zonas/${provincia}.json`];
  return importar === undefined
    ? Effect.fail(new ZonasNoCargadas({ motivo: `no hay contornos de ${provincia}` }))
    : Effect.tryPromise({ try: importar, catch: noHaLlegado }).pipe(
        Effect.flatMap(decodificarContorno),
        Effect.mapError(noEsElEsperado),
        Effect.map(indexarMunicipios),
      );
};

/** Los polígonos de un municipio en los contornos de su provincia, o nada si no está. */
export const poligonosDelMunicipio = (
  contornos: IndiceDeMunicipios,
  codigo: string,
): ReadonlyArray<Poligono> | undefined => {
  const posicion = contornos.territorios.findIndex((t) => t.codigo === codigo);
  return posicion === -1 ? undefined : contornos.poligonosDe(posicion);
};
