import type { FilterSpecification, LayerSpecification } from "maplibre-gl";

/**
 * La zona del ejercicio de emplazamientos en el mapa: el límite del barrio con un relleno muy
 * suave y, encima, una línea de cada estación base a su vecina más cercana de la misma compañía,
 * las distancias con que se calcula el radio de cobertura.
 */

/** La fuente GeoJSON de la zona. Los polígonos son la zona; las líneas, las vecinas. */
export const FUENTE_ZONA = "zona";

const ES_ZONA: FilterSpecification = ["==", ["geometry-type"], "Polygon"];
const ES_VECINA: FilterSpecification = ["==", ["geometry-type"], "LineString"];

/** Las capas de la zona, con el color que les da el tema. */
export const capasZona = (color: string): ReadonlyArray<LayerSpecification> => [
  {
    id: "zona-relleno",
    type: "fill",
    source: FUENTE_ZONA,
    filter: ES_ZONA,
    paint: { "fill-color": color, "fill-opacity": 0.08 },
  },
  {
    id: "zona-borde",
    type: "line",
    source: FUENTE_ZONA,
    filter: ES_ZONA,
    layout: { "line-join": "round" },
    paint: { "line-color": color, "line-width": 2.5, "line-dasharray": [3, 1.5] },
  },
  {
    id: "zona-vecinas",
    type: "line",
    source: FUENTE_ZONA,
    filter: ES_VECINA,
    layout: { "line-cap": "round" },
    paint: { "line-color": color, "line-width": 2.5, "line-opacity": 0.9 },
  },
];
