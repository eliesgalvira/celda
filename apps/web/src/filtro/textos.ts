import { NOMBRE_COMPANIA } from "@celda/dominio/compania";
import {
  type FiltroDeCompanias,
  hayFiltro,
  nombresDelFiltro,
  redesUsadas,
} from "@celda/dominio/filtro";

/**
 * Los textos del filtro de compañías (ADR 0026). En castellano llano: dicen qué se ve y por qué
 * salen aparte los de otra compañía, sin hablar de cómo se calcula.
 */

/** El chip que quita el filtro. */
export const ETIQUETA_TODAS = "Todas";

const enumerar = (nombres: ReadonlyArray<string>): string =>
  nombres.length <= 1
    ? (nombres[0] ?? "")
    : `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1) ?? ""}`;

/** Lo que se ve, en una frase: lo dice el panel y se anuncia al cambiar. */
export const estadoDelFiltro = (filtro: FiltroDeCompanias): string =>
  hayFiltro(filtro)
    ? `Se ven solo los emplazamientos de ${nombresDelFiltro(filtro)}.`
    : "Se ven los emplazamientos de todas las compañías.";

/**
 * Lo que sale aparte, más claro, con las compañías del filtro que usan otra red, y por qué sus
 * celdas son solo una aproximación: «Los emplazamientos de Movistar salen más claros, con sus
 * celdas, porque Digi usa su red donde no tiene la suya. Cerca de uno de Digi, el móvil suele
 * conectarse a él aunque haya otro de Movistar más cerca.» Sin ninguna, `undefined`.
 */
export const textoDeLaRedUsada = (filtro: FiltroDeCompanias): string | undefined => {
  const redes = redesUsadas(filtro);
  const [una] = redes;
  if (una === undefined) return undefined;
  const de = enumerar(redes.map((r) => NOMBRE_COMPANIA[r.red]));
  return redes.length === 1
    ? `Los emplazamientos de ${de} salen más claros, con sus celdas, porque ${NOMBRE_COMPANIA[una.compania]} usa su red donde no tiene la suya. Cerca de uno de ${NOMBRE_COMPANIA[una.compania]}, el móvil suele conectarse a él aunque haya otro de ${de} más cerca.`
    : `Los emplazamientos de ${de} salen más claros, con sus celdas, porque ${enumerar(
        redes.map((r) => `${NOMBRE_COMPANIA[r.compania]} usa la de ${NOMBRE_COMPANIA[r.red]}`),
      )} donde no tienen la suya. Cerca de un emplazamiento propio, el móvil suele conectarse a él aunque haya otro más cerca.`;
};

/** La nota del panel: cómo se usa o, con un filtro, qué sale aparte. */
export const notaDelFiltro = (filtro: FiltroDeCompanias): string =>
  textoDeLaRedUsada(filtro) ??
  (hayFiltro(filtro)
    ? "Toca otra para compararlas, o «Todas» para volver a verlas todas. Las celdas se calculan solo con los emplazamientos que se ven."
    : "Toca una compañía para ver solo sus emplazamientos, y otra para compararlas.");

/** El aviso de filtro puesto: «Solo Movistar», «Solo Movistar y Vodafone». */
export const textoDelAviso = (filtro: FiltroDeCompanias): string =>
  `Solo ${nombresDelFiltro(filtro)}`;

/**
 * Lo que sale aparte, en corto, para el aviso: «La red de Movistar que usa Digi sale más clara.»
 * El panel lo explica entero (`textoDeLaRedUsada`).
 */
const redUsadaEnCorto = (filtro: FiltroDeCompanias): string | undefined => {
  const redes = redesUsadas(filtro);
  if (redes.length === 0) return undefined;
  const de = enumerar(redes.map((r) => NOMBRE_COMPANIA[r.red]));
  const quienes = enumerar(redes.map((r) => NOMBRE_COMPANIA[r.compania]));
  return redes.length === 1
    ? `La red de ${de} que usa ${quienes} sale más clara.`
    : `Las redes de ${de} que usan ${quienes} salen más claras.`;
};

/**
 * La línea de debajo del aviso: lo que sale aparte o, si de lejos los números aún no pueden
 * contar solo lo del filtro (unos datos publicados antes de que se pudiera), que lo diga.
 */
export const detalleDelAviso = (
  filtro: FiltroDeCompanias,
  deLejosSinFiltrar: boolean,
): string | undefined =>
  deLejosSinFiltrar
    ? `Con el mapa alejado, los números aún cuentan todas las compañías. Acerca el mapa para ver solo ${nombresDelFiltro(filtro)}.`
    : redUsadaEnCorto(filtro);
