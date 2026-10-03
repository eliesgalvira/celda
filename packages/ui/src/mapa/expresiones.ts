import type { ExpressionSpecification } from "maplibre-gl";

/** Piezas de expresión que comparten las capas del mapa base. */

/** El esquema de OpenMapTiles clasifica cada elemento en `class`: de alguna de estas. */
export const deClase = (...clases: ReadonlyArray<string>): ExpressionSpecification => [
  "in",
  ["get", "class"],
  ["literal", clases],
];

/** Un valor que pasa en línea recta de una parada a otra: pares de zoom y valor. */
export const porZoom = (
  ...pares: ReadonlyArray<number | ExpressionSpecification>
): ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], ...pares];

/**
 * El estado del estilo que dice si la foto aérea está encendida (ADR 0022). Lo cambia
 * `ponerFotoAerea`; las capas que se ven distintas sobre la foto lo leen con `conFoto`.
 */
export const FOTO_AEREA = "fotoAerea";

/** Lo que se pinta sin la foto aérea y lo que se pinta con ella encendida. */
type Salida = string | number | boolean | ExpressionSpecification;

/**
 * Un valor que cambia con la foto aérea: `sinFoto` con ella apagada y `conFotoEncendida` con ella
 * encendida. Encender la foto cambia el estado del estilo y MapLibre vuelve a evaluar estas
 * expresiones, sin `setStyle`. Una expresión de zoom no puede ir dentro: va fuera, con esto en
 * cada parada.
 */
export const conFoto = (sinFoto: Salida, conFotoEncendida: Salida): ExpressionSpecification => [
  "case",
  ["global-state", FOTO_AEREA],
  conFotoEncendida,
  sinFoto,
];

/** Una capa que solo se ve con la foto aérea encendida. */
export const visibleConFoto: ExpressionSpecification = conFoto("none", "visible");

/** Una capa que se esconde con la foto aérea encendida. */
export const ocultaConFoto: ExpressionSpecification = conFoto("visible", "none");
