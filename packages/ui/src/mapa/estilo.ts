import type { StyleSpecification } from "maplibre-gl";

import { capasCeldas, FUENTE_CELDAS } from "./celdas.ts";
import { comoRgb, leerOklch } from "./color.ts";
import { capasInterferencia, FUENTE_INTERFERENCIA } from "./interferencia.ts";
import { capasRotulos, type ContornoDeEspana, LETRAS_DE_LEJOS } from "./rotulos.ts";
import {
  capasServicioDebajo,
  capasServicioEncima,
  FUENTE_SERVICIO,
  FUENTE_SERVICIO_LINEA,
} from "./servicio.ts";
import { capasSuelo } from "./suelo.ts";
import type { ColorDeToken } from "./tokens.ts";
import { capasVias } from "./vias.ts";
import { capasZona, FUENTE_ZONA } from "./zona.ts";

export { type ColorDeToken, TOKENS_MAPA, type TokenMapa } from "./tokens.ts";
export {
  type ContornoDeEspana,
  type MapaConRotulos,
  quitarRotulosDeMunicipios,
} from "./rotulos.ts";

const OPENFREEMAP = "https://tiles.openfreemap.org";
const TILEJSON = `${OPENFREEMAP}/planet`;
const GLIFOS = `${OPENFREEMAP}/fonts/{fontstack}/{range}.pbf`;

/**
 * Lo que el mapa base pide en cadena antes de pintar la vista inicial: el TileJSON del callejero
 * y los glifos de los rótulos que se ven de lejos, del rango 0-255, que cubre el castellano y el
 * catalán. La web los pide por adelantado para no esperarlos después (`apps/web/src/mapa/precarga.ts`).
 */
export const RECURSOS_INICIALES_MAPA_BASE: ReadonlyArray<string> = [
  TILEJSON,
  ...LETRAS_DE_LEJOS.map((letra) =>
    GLIFOS.replace("{fontstack}", encodeURIComponent(letra)).replace("{range}", "0-255"),
  ),
];

/** El nombre de la fuente del callejero dentro del estilo. */
export const FUENTE_MAPA_BASE = "openmaptiles";

/**
 * El estilo del mapa base de OpenFreeMap (esquema OpenMapTiles) con la paleta A del tema (ADR
 * 0022): el suelo, las vías por clase y los rótulos por importancia. No lleva ningún color
 * escrito: todos salen de `color`. Lleva también las capas de las celdas, del sector que da
 * servicio, de la vista de interferencia y de la zona del ejercicio, con sus fuentes vacías hasta
 * que la web las llena (`FUENTE_CELDAS`, `FUENTE_SERVICIO`, `FUENTE_SERVICIO_LINEA`,
 * `FUENTE_INTERFERENCIA` y `FUENTE_ZONA`), entre las vías y los rótulos.
 *
 * `espana` es el contorno con que los rótulos de lugar de fuera de España no salen de lejos. Llega
 * de fuera, y no de un `import` de este módulo, para que sus 24 KB vayan con el código del mapa y
 * no con el de la primera pantalla, que también usa este módulo.
 */
export const estiloMapa = (color: ColorDeToken, espana: ContornoDeEspana): StyleSpecification => ({
  version: 8,
  glyphs: GLIFOS,
  sources: {
    [FUENTE_MAPA_BASE]: { type: "vector", url: TILEJSON },
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
    ...capasSuelo(FUENTE_MAPA_BASE, color),
    ...capasVias(FUENTE_MAPA_BASE, color),
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
    ...capasZona(color("mapa-referencia")),
    ...capasRotulos(FUENTE_MAPA_BASE, color, espana),
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
