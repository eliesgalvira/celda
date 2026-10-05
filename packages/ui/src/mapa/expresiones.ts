import type { ExpressionSpecification } from "maplibre-gl";

/** Piezas de expresión que comparten las capas del mapa base. */

/** El esquema de OpenMapTiles clasifica cada elemento en `class`: de alguna de estas. */
export const deClase = (...clases: ReadonlyArray<string>): ExpressionSpecification => [
  "in",
  ["get", "class"],
  ["literal", clases],
];

/**
 * El `text-field` de unos rótulos cuyo texto sale de una expresión grande, como el nombre de lugar
 * (`nombreDelRotulo`). En cada fotograma en que cambia el zoom, MapLibre recorre entera la
 * expresión del `text-field` de cada capa de símbolos, buscando tramos de `format` con su propio
 * color (`_setPaintOverrides`): con las seis capas de lugares y los barrios eran unos 0,7 ms por
 * fotograma con la CPU a ×4 (#67). Dentro de un `format` de un solo tramo sin color, MapLibre se
 * para en el `format`. El texto, la letra y la colocación son los mismos.
 */
export const textoDeRotulo = (texto: ExpressionSpecification): ExpressionSpecification => [
  "format",
  texto,
  {},
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

/**
 * Un filtro que solo deja pasar los rasgos con la foto aérea encendida, para una capa del estilo
 * que es la única que lee su capa de la tesela, como los números de portal. Escondida con
 * `visibility`, MapLibre deja esa capa fuera de las teselas que parte por encima de su zoom máximo
 * y guarda lo partido: al encender la foto, las teselas pedidas con ella apagada (durante un vuelo,
 * por ejemplo) seguían sin números. Con el filtro la capa de la tesela siempre llega.
 */
export const soloConFoto: ExpressionSpecification = conFoto(false, true);
