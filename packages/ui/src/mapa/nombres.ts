import type { Contorno } from "@celda/dominio/comunitatValenciana";
import { EXCEPCIONES_DE_OPENSTREETMAP } from "@celda/dominio/nombreDeLugar";
import type { ExpressionSpecification } from "maplibre-gl";

/**
 * El nombre que escribe un rótulo de lugar del mapa base, de la capa `place` (ADR 0025): el `name`
 * de OpenStreetMap, que suele ser el local, en una sola forma. Las vías, el agua y los puntos de
 * interés no pasan por aquí: escriben su `name` entero. Es la misma regla que `nombreDelMapaBase` de
 * `@celda/dominio/nombreDeLugar`, y `nombres.test.ts` comprueba que dan lo mismo:
 *
 * 1. las excepciones, por su `name` tal cual («Peñacerrada / Urizaharra»);
 * 2. con «/», una sola parte según dónde esté el lugar: dentro de la Comunitat Valenciana
 *    (`within` con su contorno), la que no es `name:es` (Alacant, Elx, Sagunt); fuera, `name:es` si
 *    es una de las dos (San Sebastián, Pamplona) y, si no, la primera;
 * 3. en letra no latina (Marruecos, Argelia: «Tanger ⵟⴰⵏⵊⴰ طنجة»), `name:es` o `name:latin`;
 * 4. si no, `name`.
 *
 * `within` solo se evalúa para los nombres con «/»: `case` se queda en la primera rama que vale.
 */

const NAME: ExpressionSpecification = ["to-string", ["get", "name"]];
const ES: ExpressionSpecification = ["coalesce", ["get", "name:es"], ""];

/** Dónde acaba la primera parte de «A / B»: en « /» o, si no lo hay, en «/». */
const FIN_DE_LA_PRIMERA: ExpressionSpecification = [
  "case",
  ["in", " /", NAME],
  ["index-of", " /", NAME],
  ["index-of", "/", NAME],
];

/** Dónde empieza la segunda parte de «A / B»: tras «/ » o, si no lo hay, tras «/». */
const INICIO_DE_LA_SEGUNDA: ExpressionSpecification = [
  "case",
  ["in", "/ ", NAME],
  ["+", ["index-of", "/ ", NAME], 2],
  ["+", ["index-of", "/", NAME], 1],
];

const PRIMERA: ExpressionSpecification = ["slice", NAME, 0, FIN_DE_LA_PRIMERA];
const SEGUNDA: ExpressionSpecification = ["slice", NAME, INICIO_DE_LA_SEGUNDA];

/** La regla sin las excepciones. */
const regla = (comunitatValenciana: Contorno): ExpressionSpecification => [
  "case",
  ["in", "/", NAME],
  [
    "case",
    ["within", comunitatValenciana],
    ["case", ["==", ES, PRIMERA], SEGUNDA, PRIMERA],
    ["case", ["==", ES, SEGUNDA], SEGUNDA, PRIMERA],
  ],
  ["all", ["has", "name:latin"], ["!=", ["get", "name:latin"], NAME]],
  ["coalesce", ["get", "name:es"], ["get", "name:latin"]],
  NAME,
];

/** La expresión del nombre de un rótulo, con el contorno de la Comunitat Valenciana. */
export const nombreDelRotulo = (comunitatValenciana: Contorno): ExpressionSpecification => {
  const [primera, ...demas] = EXCEPCIONES_DE_OPENSTREETMAP;
  return primera === undefined
    ? regla(comunitatValenciana)
    : ["match", NAME, primera[0], primera[1], ...demas.flat(), regla(comunitatValenciana)];
};
