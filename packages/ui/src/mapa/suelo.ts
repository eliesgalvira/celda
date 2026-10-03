import type { LayerSpecification } from "maplibre-gl";

import { deClase, porZoom } from "./expresiones.ts";
import type { ColorDeToken } from "./tokens.ts";

/**
 * El suelo del mapa base, de abajo arriba: la tierra, las zonas urbanas y los usos que se
 * reconocen de cerca, los verdes, el agua y los edificios. Todo de las capas `landuse`,
 * `landcover`, `park`, `water`, `waterway` y `building` de OpenMapTiles.
 */
export const capasSuelo = (
  fuente: string,
  color: ColorDeToken,
): ReadonlyArray<LayerSpecification> => [
  { id: "fondo", type: "background", paint: { "background-color": color("mapa-fondo") } },
  {
    id: "urbano",
    type: "fill",
    source: fuente,
    "source-layer": "landuse",
    filter: deClase(
      "residential",
      "suburb",
      "quarter",
      "neighbourhood",
      "commercial",
      "retail",
      "industrial",
    ),
    paint: { "fill-color": color("mapa-urbano"), "fill-opacity": porZoom(5, 0.7, 10, 1, 15, 0.7) },
  },
  {
    id: "usos",
    type: "fill",
    source: fuente,
    "source-layer": "landuse",
    minzoom: 12,
    filter: deClase("hospital", "school", "university", "college", "cemetery"),
    paint: {
      "fill-color": [
        "match",
        ["get", "class"],
        "hospital",
        color("mapa-hospital"),
        "cemetery",
        color("mapa-cementerio"),
        color("mapa-educacion"),
      ],
      "fill-opacity": porZoom(12, 0, 13, 1),
    },
  },
  {
    id: "arena",
    type: "fill",
    source: fuente,
    "source-layer": "landcover",
    filter: deClase("sand"),
    paint: { "fill-color": color("mapa-arena") },
  },
  {
    id: "bosque",
    type: "fill",
    source: fuente,
    "source-layer": "landcover",
    filter: deClase("wood"),
    paint: {
      "fill-color": color("mapa-bosque"),
      "fill-opacity": porZoom(5, 0.6, 10, 0.8, 15, 0.9),
    },
  },
  {
    id: "hierba",
    type: "fill",
    source: fuente,
    "source-layer": "landcover",
    filter: ["all", deClase("grass", "wetland", "scrub"), ["!=", ["get", "subclass"], "park"]],
    paint: {
      "fill-color": color("mapa-hierba"),
      "fill-opacity": porZoom(5, 0.4, 10, 0.6, 14, 0.8),
    },
  },
  {
    id: "parques",
    type: "fill",
    source: fuente,
    "source-layer": "landcover",
    filter: [
      "in",
      ["get", "subclass"],
      ["literal", ["park", "garden", "golf_course", "playground"]],
    ],
    paint: { "fill-color": color("mapa-parque") },
  },
  {
    // Parques naturales y nacionales: grandes, así que apenas se tiñen y se apagan al acercar.
    id: "espacios-naturales",
    type: "fill",
    source: fuente,
    "source-layer": "park",
    paint: {
      "fill-color": color("mapa-parque"),
      "fill-opacity": porZoom(5, 0.35, 10, 0.3, 13, 0.15),
    },
  },
  {
    id: "agua",
    type: "fill",
    source: fuente,
    "source-layer": "water",
    filter: ["!=", ["get", "brunnel"], "tunnel"],
    paint: { "fill-color": color("mapa-agua") },
  },
  {
    id: "rios",
    type: "line",
    source: fuente,
    "source-layer": "waterway",
    minzoom: 8,
    filter: ["all", ["!=", ["get", "brunnel"], "tunnel"], deClase("river")],
    paint: { "line-color": color("mapa-agua"), "line-width": porZoom(8, 0.6, 12, 1.4, 16, 4) },
  },
  {
    id: "arroyos",
    type: "line",
    source: fuente,
    "source-layer": "waterway",
    minzoom: 12,
    filter: ["all", ["!=", ["get", "brunnel"], "tunnel"], deClase("canal", "stream")],
    paint: {
      "line-color": color("mapa-agua"),
      "line-width": porZoom(12, 0.3, 16, 1.6),
      "line-opacity": porZoom(12, 0, 13, 1),
    },
  },
  {
    id: "edificios",
    type: "fill",
    source: fuente,
    "source-layer": "building",
    minzoom: 14,
    paint: {
      "fill-color": color("mapa-edificio"),
      "fill-outline-color": color("mapa-edificio-borde"),
      "fill-opacity": porZoom(14, 0, 15, 1),
    },
  },
];
