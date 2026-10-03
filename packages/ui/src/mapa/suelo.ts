import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

import { deClase, porZoom } from "./expresiones.ts";
import type { ColorDeToken } from "./tokens.ts";

/** Los usos del suelo que se tiñen de cerca, encima de las zonas urbanas. */
const USOS = ["hospital", "school", "university", "college", "cemetery"];

/** Las subclases de `landcover` que se pintan como parque. */
const PARQUES = ["park", "garden", "golf_course", "playground"];

/** La opacidad de un verde en una parada: los parques y la arena, enteros. */
const opacidadDeVerde = (bosque: number, hierba: number): ExpressionSpecification => [
  "case",
  ["in", ["get", "subclass"], ["literal", PARQUES]],
  1,
  ["match", ["get", "class"], "sand", 1, "wood", bosque, hierba],
];

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
    // Las zonas urbanas y, desde el zoom 12, los hospitales, los centros de enseñanza y los
    // cementerios, encima. Una sola capa: cada capa de más cuesta JavaScript en cada fotograma.
    id: "usos",
    type: "fill",
    source: fuente,
    "source-layer": "landuse",
    filter: [
      "match",
      ["get", "class"],
      ["residential", "suburb", "quarter", "neighbourhood", "commercial", "retail", "industrial"],
      true,
      ["hospital", "school", "university", "college", "cemetery"],
      [">=", ["zoom"], 12],
      false,
    ],
    layout: { "fill-sort-key": ["match", ["get", "class"], USOS, 1, 0] },
    paint: {
      "fill-color": [
        "match",
        ["get", "class"],
        "hospital",
        color("mapa-hospital"),
        "cemetery",
        color("mapa-cementerio"),
        ["school", "university", "college"],
        color("mapa-educacion"),
        color("mapa-urbano"),
      ],
      "fill-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5,
        ["match", ["get", "class"], USOS, 0, 0.7],
        10,
        ["match", ["get", "class"], USOS, 0, 1],
        12,
        ["match", ["get", "class"], USOS, 0, 0.88],
        13,
        ["match", ["get", "class"], USOS, 1, 0.82],
        15,
        ["match", ["get", "class"], USOS, 1, 0.7],
      ],
    },
  },
  {
    // La arena, el bosque, la hierba y, encima, los parques y jardines.
    id: "verdes",
    type: "fill",
    source: fuente,
    "source-layer": "landcover",
    filter: [
      "any",
      ["in", ["get", "subclass"], ["literal", PARQUES]],
      deClase("sand", "wood", "grass", "wetland", "scrub"),
    ],
    layout: {
      "fill-sort-key": [
        "case",
        ["in", ["get", "subclass"], ["literal", PARQUES]],
        3,
        ["match", ["get", "class"], "sand", 0, "wood", 1, 2],
      ],
    },
    paint: {
      "fill-color": [
        "case",
        ["in", ["get", "subclass"], ["literal", PARQUES]],
        color("mapa-parque"),
        [
          "match",
          ["get", "class"],
          "sand",
          color("mapa-arena"),
          "wood",
          color("mapa-bosque"),
          color("mapa-hierba"),
        ],
      ],
      "fill-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5,
        opacidadDeVerde(0.6, 0.4),
        10,
        opacidadDeVerde(0.8, 0.6),
        14,
        opacidadDeVerde(0.88, 0.8),
        15,
        opacidadDeVerde(0.9, 0.8),
      ],
    },
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
