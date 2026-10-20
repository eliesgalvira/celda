import type { Coordenada } from "@celda/dominio/area";

/** La línea del emplazamiento al punto de referencia, como la lee la fuente del mapa. */
export interface LineaAlPunto {
  readonly type: "FeatureCollection";
  readonly features: Array<{
    readonly type: "Feature";
    readonly properties: Record<string, never>;
    readonly geometry: {
      readonly type: "LineString";
      readonly coordinates: Array<[number, number]>;
    };
  }>;
}

/** La línea del emplazamiento seleccionado al punto de referencia, o ninguna si falta uno. */
export const lineaAlPunto = (
  emplazamiento: Coordenada | undefined,
  punto: Coordenada | undefined,
): LineaAlPunto =>
  emplazamiento === undefined || punto === undefined
    ? { type: "FeatureCollection", features: [] }
    : {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [emplazamiento.longitud, emplazamiento.latitud],
                [punto.longitud, punto.latitud],
              ],
            },
          },
        ],
      };
