import type { Coordenada, Rectangulo } from "@celda/dominio/area";
import type { Poligono } from "@celda/dominio/barrio";
import type { EmplazamientoDelEjercicio, Vecina } from "@celda/dominio/ejercicio";
import { PoblacionDeBarrios } from "@celda/dominio/poblacion";
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
 * La zona para el mapa: un polígono por parte del barrio y una línea de cada estación base a su
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

const decodificar = Schema.decodeUnknownEffect(PoblacionDeBarrios);

/** Los habitantes por barrio no se han podido cargar. */
export class PoblacionNoCargada extends Schema.TaggedError<PoblacionNoCargada>()(
  "PoblacionNoCargada",
  { motivo: Schema.String },
) {}

/**
 * Los habitantes por barrio. Van en un trozo aparte de la web que solo se descarga al abrir el
 * ejercicio: quien no usa el modo estudiante no lo descarga nunca.
 */
export const cargarPoblacion: Effect.Effect<PoblacionDeBarrios, PoblacionNoCargada> =
  Effect.tryPromise({
    try: () => import("./poblacion.json"),
    catch: () => new PoblacionNoCargada({ motivo: "no ha llegado" }),
  }).pipe(
    Effect.flatMap((modulo) => decodificar(modulo.default)),
    Effect.mapError((error) =>
      error._tag === "PoblacionNoCargada"
        ? error
        : new PoblacionNoCargada({ motivo: "el fichero no es el que se esperaba" }),
    ),
  );
