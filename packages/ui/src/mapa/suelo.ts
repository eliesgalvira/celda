import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

import { conFoto, deClase, porZoom } from "./expresiones.ts";
import type { ColorDeToken } from "./tokens.ts";

/** Los usos del suelo que se tiñen de cerca, encima de las zonas urbanas. */
const USOS = ["hospital", "school", "university", "college", "cemetery"];

/** Las subclases de `landcover` que se pintan como parque. */
const PARQUES = ["park", "garden", "golf_course", "playground"];

/** Si un verde es un parque o un jardín: va como parque sea cual sea su clase. */
const ES_PARQUE: ExpressionSpecification = ["in", ["get", "subclass"], ["literal", PARQUES]];

/** Un verde de `landcover` de estas clases que no es un parque. */
const verdeDeClase = (...clases: ReadonlyArray<string>): ExpressionSpecification => [
  "all",
  ["!", ES_PARQUE],
  deClase(...clases),
];

/** Una capa de verdes de `landcover`: los de `filtro`, de un color y una opacidad. */
const verde = (
  id: string,
  fuente: string,
  filtro: ExpressionSpecification,
  relleno: string,
  opacidad: number | ExpressionSpecification,
): LayerSpecification => ({
  id,
  type: "fill",
  source: fuente,
  "source-layer": "landcover",
  filter: filtro,
  paint: { "fill-color": relleno, "fill-opacity": opacidad },
});

/** Los edificios de OpenStreetMap, que también busca «Ver el edificio». */
export const CAPA_EDIFICIOS = "edificios";

/**
 * El suelo del mapa base, de abajo arriba: la tierra, las zonas urbanas y los usos que se
 * reconocen de cerca, los verdes, el agua y los edificios. Todo de las capas `landuse`,
 * `landcover`, `park`, `water`, `waterway` y `building` de OpenMapTiles.
 *
 * `bajoElAgua` va entre la tierra y el agua: la foto aérea, que tapa la tierra. El agua va encima,
 * porque el mar del PNOA es casi negro (ADR 0022), y los edificios se apagan sobre la foto.
 */
export const capasSuelo = (
  fuente: string,
  color: ColorDeToken,
  bajoElAgua: ReadonlyArray<LayerSpecification> = [],
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
  // La arena, el bosque, la hierba y, encima, los parques y jardines. Cada uno en su capa, con su
  // color y su opacidad fijos o por zoom: en una sola capa con el color y la opacidad por clase,
  // MapLibre los guardaba en cada vértice, el doble que los propios polígonos (#67).
  verde("verdes-arena", fuente, verdeDeClase("sand"), color("mapa-arena"), 1),
  verde(
    "verdes-bosque",
    fuente,
    verdeDeClase("wood"),
    color("mapa-bosque"),
    porZoom(5, 0.6, 10, 0.8, 14, 0.88, 15, 0.9),
  ),
  verde(
    "verdes-hierba",
    fuente,
    verdeDeClase("grass", "wetland", "scrub"),
    color("mapa-hierba"),
    porZoom(5, 0.4, 10, 0.6, 14, 0.8),
  ),
  verde("verdes-parques", fuente, ES_PARQUE, color("mapa-parque"), 1),
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
  ...bajoElAgua,
  {
    id: "agua",
    type: "fill",
    source: fuente,
    "source-layer": "water",
    filter: ["!=", ["get", "brunnel"], "tunnel"],
    // Sobre la foto deja ver algo de la costa y los puertos.
    paint: { "fill-color": color("mapa-agua"), "fill-opacity": conFoto(1, 0.88) },
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
    // Sobre la foto no se pintan, pero siguen en el mapa: «Ver el edificio» los busca aquí.
    id: CAPA_EDIFICIOS,
    type: "fill",
    source: fuente,
    "source-layer": "building",
    minzoom: 14,
    paint: {
      "fill-color": color("mapa-edificio"),
      "fill-outline-color": color("mapa-edificio-borde"),
      "fill-opacity": porZoom(14, 0, 15, conFoto(1, 0)),
    },
  },
];
