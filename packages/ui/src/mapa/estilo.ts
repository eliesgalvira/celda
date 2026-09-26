import type { ExpressionSpecification, FilterSpecification, StyleSpecification } from "maplibre-gl";

import { capasCeldas, FUENTE_CELDAS } from "./celdas.ts";
import { capasZona, FUENTE_ZONA } from "./zona.ts";
import { comoRgb, leerOklch } from "./color.ts";
import { capasInterferencia, FUENTE_INTERFERENCIA } from "./interferencia.ts";
import {
  capasServicioDebajo,
  capasServicioEncima,
  FUENTE_SERVICIO,
  FUENTE_SERVICIO_LINEA,
} from "./servicio.ts";

/** Los tokens del tema que pinta el mapa base. Cada uno es una variable `--mapa-*` de tema.css. */
export const TOKENS_MAPA = [
  "mapa-fondo",
  "mapa-parque",
  "mapa-agua",
  "mapa-edificio",
  "mapa-edificio-borde",
  "mapa-tren",
  "mapa-camino",
  "mapa-calle-borde",
  "mapa-calle",
  "mapa-avenida",
  "mapa-rotulo",
  "mapa-halo",
  "mapa-lugar",
  "mapa-celda",
  "mapa-sinr-1",
  "mapa-sinr-2",
  "mapa-sinr-3",
  "mapa-sinr-4",
  "mapa-sinr-5",
  "mapa-sinr-6",
  "mapa-referencia",
] as const;

export type TokenMapa = (typeof TOKENS_MAPA)[number];

/** Devuelve el color de un token en una sintaxis que MapLibre entienda. */
export type ColorDeToken = (token: TokenMapa) => string;

const OPENFREEMAP = "https://tiles.openfreemap.org";

/** El nombre de la fuente del callejero dentro del estilo. */
export const FUENTE_MAPA_BASE = "openmaptiles";

const deClase = (clases: ReadonlyArray<string>): FilterSpecification => [
  "in",
  ["get", "class"],
  ["literal", clases],
];

/** Grosor de una vía en píxeles a zoom 12, 16 y 18,5. */
const grosor = (z12: number, z16: number, z18: number): ExpressionSpecification => [
  "interpolate",
  ["exponential", 1.5],
  ["zoom"],
  12,
  z12,
  16,
  z16,
  18.5,
  z18,
];

const CALLES = ["minor", "service", "tertiary", "secondary"];
const AVENIDAS = ["motorway", "trunk", "primary"];

/**
 * El estilo del mapa base de OpenFreeMap (esquema OpenMapTiles) con los
 * colores del tema. No lleva ningún color escrito: todos salen de `color`.
 * Lleva también las capas de las celdas, del sector que da servicio, de la
 * vista de interferencia y de la zona del ejercicio, con sus fuentes vacías
 * hasta que la web las llena (`FUENTE_CELDAS`, `FUENTE_SERVICIO`,
 * `FUENTE_SERVICIO_LINEA`, `FUENTE_INTERFERENCIA` y `FUENTE_ZONA`).
 */
export const estiloMapa = (color: ColorDeToken): StyleSpecification => ({
  version: 8,
  glyphs: `${OPENFREEMAP}/fonts/{fontstack}/{range}.pbf`,
  sources: {
    [FUENTE_MAPA_BASE]: { type: "vector", url: `${OPENFREEMAP}/planet` },
    [FUENTE_CELDAS]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    [FUENTE_SERVICIO]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    [FUENTE_SERVICIO_LINEA]: {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    },
    [FUENTE_INTERFERENCIA]: {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    },
    [FUENTE_ZONA]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  },
  layers: [
    { id: "fondo", type: "background", paint: { "background-color": color("mapa-fondo") } },
    {
      id: "vegetacion",
      type: "fill",
      source: FUENTE_MAPA_BASE,
      "source-layer": "landcover",
      filter: deClase(["wood", "grass", "scrub", "farmland"]),
      paint: { "fill-color": color("mapa-parque"), "fill-opacity": 0.7 },
    },
    {
      id: "parques",
      type: "fill",
      source: FUENTE_MAPA_BASE,
      "source-layer": "park",
      paint: { "fill-color": color("mapa-parque") },
    },
    {
      id: "agua",
      type: "fill",
      source: FUENTE_MAPA_BASE,
      "source-layer": "water",
      paint: { "fill-color": color("mapa-agua") },
    },
    {
      id: "edificios",
      type: "fill",
      source: FUENTE_MAPA_BASE,
      "source-layer": "building",
      minzoom: 14,
      paint: {
        "fill-color": color("mapa-edificio"),
        "fill-outline-color": color("mapa-edificio-borde"),
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 1],
      },
    },
    {
      id: "tren",
      type: "line",
      source: FUENTE_MAPA_BASE,
      "source-layer": "transportation",
      filter: ["==", ["get", "class"], "rail"],
      paint: { "line-color": color("mapa-tren"), "line-width": 1.2, "line-dasharray": [4, 3] },
    },
    {
      id: "calles-borde",
      type: "line",
      source: FUENTE_MAPA_BASE,
      "source-layer": "transportation",
      filter: deClase(CALLES),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": color("mapa-calle-borde"), "line-width": grosor(0.5, 5, 15) },
    },
    {
      id: "avenidas-borde",
      type: "line",
      source: FUENTE_MAPA_BASE,
      "source-layer": "transportation",
      filter: deClase(AVENIDAS),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": color("mapa-calle-borde"), "line-width": grosor(2, 9, 22) },
    },
    {
      id: "caminos",
      type: "line",
      source: FUENTE_MAPA_BASE,
      "source-layer": "transportation",
      minzoom: 15,
      filter: deClase(["path", "track"]),
      paint: { "line-color": color("mapa-camino"), "line-width": 1, "line-dasharray": [2, 2] },
    },
    {
      id: "calles",
      type: "line",
      source: FUENTE_MAPA_BASE,
      "source-layer": "transportation",
      filter: deClase(CALLES),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": color("mapa-calle"), "line-width": grosor(0.3, 3.5, 12) },
    },
    {
      id: "avenidas",
      type: "line",
      source: FUENTE_MAPA_BASE,
      "source-layer": "transportation",
      filter: deClase(AVENIDAS),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": color("mapa-avenida"), "line-width": grosor(1.2, 7, 18) },
    },
    ...capasInterferencia([
      color("mapa-sinr-1"),
      color("mapa-sinr-2"),
      color("mapa-sinr-3"),
      color("mapa-sinr-4"),
      color("mapa-sinr-5"),
      color("mapa-sinr-6"),
    ]),
    ...capasServicioDebajo(color("mapa-celda")),
    ...capasCeldas(color("mapa-celda")),
    ...capasServicioEncima(color("mapa-celda"), color("mapa-referencia")),
    {
      id: "nombres-de-calles",
      type: "symbol",
      source: FUENTE_MAPA_BASE,
      "source-layer": "transportation_name",
      minzoom: 15,
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Italic"],
        "text-size": 11,
      },
      paint: {
        "text-color": color("mapa-rotulo"),
        "text-halo-color": color("mapa-halo"),
        "text-halo-width": 1.4,
      },
    },
    {
      id: "barrios",
      type: "symbol",
      source: FUENTE_MAPA_BASE,
      "source-layer": "place",
      // Del 13 al 14 los barrios de Barcelona llevan la etiqueta de Celda (`MarcadorBarrio`), con
      // su número y sus ausencias; los rótulos del mapa base se pisarían con ella.
      minzoom: 14,
      filter: deClase(["suburb", "quarter", "neighbourhood"]),
      layout: {
        "text-field": ["upcase", ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-letter-spacing": 0.25,
      },
      paint: {
        "text-color": color("mapa-lugar"),
        "text-halo-color": color("mapa-halo"),
        "text-halo-width": 1.5,
      },
    },
    {
      id: "municipios",
      type: "symbol",
      source: FUENTE_MAPA_BASE,
      "source-layer": "place",
      maxzoom: 13,
      filter: deClase(["city", "town"]),
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 13,
        "text-letter-spacing": 0.08,
      },
      paint: {
        "text-color": color("mapa-lugar"),
        "text-halo-color": color("mapa-halo"),
        "text-halo-width": 1.5,
      },
    },
  ],
});

/**
 * Lee los tokens del mapa de los estilos calculados de `elemento`, de modo que
 * el mapa sigue al tema activo. Falla si tema.css no está cargado.
 */
export const coloresDelTema =
  (elemento: Element): ColorDeToken =>
  (token) => {
    const valor = getComputedStyle(elemento).getPropertyValue(`--${token}`).trim();
    if (valor === "") {
      throw new Error(`Falta el token --${token}: ¿se ha cargado @celda/ui/tema.css?`);
    }
    const rgb = leerOklch(valor);
    return rgb === null ? valor : comoRgb(rgb);
  };
