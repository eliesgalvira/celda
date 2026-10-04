import { BILINGUES_DEL_IGN, FORMAS_QUE_NO_SE_VEN } from "@celda/dominio/nombreDeLugar";
import type { ExpressionSpecification } from "maplibre-gl";

/**
 * Los nombres de lugar en los rótulos del mapa base de reserva (ADR 0025). Las teselas del IGN
 * escriben los oficiales y no traen `name:es`: de lejos, los bilingües con barra
 * («Donostia/San Sebastián»), y de cerca cada forma en su propio rótulo, en el mismo punto. Es la
 * regla de `nombreDelIgn` (`@celda/dominio/nombreDeLugar`) como expresión, y `nombres.test.ts`
 * comprueba que dan lo mismo.
 */

/** El nombre que trae el IGN, en el atributo `nombre`. */
const NOMBRE: ExpressionSpecification = ["to-string", ["get", "nombre"]];

/** Dónde acaba la primera forma de «A/B» o de «A / B». */
const FIN_DE_LA_PRIMERA: ExpressionSpecification = [
  "case",
  ["in", " /", NOMBRE],
  ["index-of", " /", NOMBRE],
  ["index-of", "/", NOMBRE],
];

const [PRIMER_BILINGUE, ...OTROS_BILINGUES] = BILINGUES_DEL_IGN;

/**
 * Lo que escribe un rótulo de lugar: el nombre de lugar de un oficial con barra según la tabla del
 * INE o, si no está, su primera forma; con algo entre paréntesis (el exónimo de lo de fuera, «Porto
 * (Oporto)», o el país, «Ceuta (ESP)»), lo de antes; si no, el mismo.
 */
export const NOMBRE_DEL_IGN: ExpressionSpecification =
  PRIMER_BILINGUE === undefined
    ? NOMBRE
    : [
        "match",
        NOMBRE,
        ...PRIMER_BILINGUE,
        ...OTROS_BILINGUES.flat(),
        [
          "case",
          ["in", "/", NOMBRE],
          ["slice", NOMBRE, 0, FIN_DE_LA_PRIMERA],
          ["in", " (", NOMBRE],
          ["slice", NOMBRE, 0, ["index-of", " (", NOMBRE]],
          NOMBRE,
        ],
      ];

/** Si el lugar se rotula: no, si su nombre es la forma que no se ve de un bilingüe. */
export const SE_ROTULA: ExpressionSpecification = [
  "!",
  ["in", NOMBRE, ["literal", FORMAS_QUE_NO_SE_VEN]],
];
