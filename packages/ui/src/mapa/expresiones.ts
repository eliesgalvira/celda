import type { ExpressionSpecification } from "maplibre-gl";

/** Piezas de expresión que comparten las capas del mapa base. */

/** El esquema de OpenMapTiles clasifica cada elemento en `class`: de alguna de estas. */
export const deClase = (...clases: ReadonlyArray<string>): ExpressionSpecification => [
  "in",
  ["get", "class"],
  ["literal", clases],
];

/** Un valor que pasa en línea recta de una parada a otra: pares de zoom y valor. */
export const porZoom = (...pares: ReadonlyArray<number>): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["zoom"],
  ...pares,
];
