import { NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { enumerar } from "@celda/dominio/enumerar";
import {
  type FiltroDeCompanias,
  hayFiltro,
  nombresDelFiltro,
  redesUsadas,
} from "@celda/dominio/filtro";

/**
 * Los textos del filtro de compañías (ADR 0026). Lo que ya dicen los chips pulsados no se repite;
 * solo se escribe lo que sorprendería: lo que sale más claro y que de lejos aún se cuentan todas.
 */

/** El chip que quita el filtro. */
export const ETIQUETA_TODAS = "Todas";

/** Lo que se ve, en una frase: el lector de pantalla la oye al cambiar. */
export const estadoDelFiltro = (filtro: FiltroDeCompanias): string =>
  hayFiltro(filtro)
    ? `Se ven solo los emplazamientos de ${nombresDelFiltro(filtro)}.`
    : "Se ven los emplazamientos de todas las compañías.";

/** El aviso de filtro puesto: «Solo Movistar», «Solo Movistar y Vodafone». */
export const textoDelAviso = (filtro: FiltroDeCompanias): string =>
  `Solo ${nombresDelFiltro(filtro)}`;

/**
 * Lo que sale aparte con las compañías del filtro que usan otra red, en una línea: «La red de
 * Movistar que usa Digi sale más clara.» Sin ninguna, `undefined`.
 */
const textoDeLaRedUsada = (filtro: FiltroDeCompanias): string | undefined => {
  const redes = redesUsadas(filtro);
  if (redes.length === 0) return undefined;
  const de = enumerar(redes.map((r) => NOMBRE_COMPANIA[r.red]));
  const quienes = enumerar(redes.map((r) => NOMBRE_COMPANIA[r.compania]));
  return redes.length === 1
    ? `La red de ${de} que usa ${quienes} sale más clara.`
    : `Las redes de ${de} que usan ${quienes} salen más claras.`;
};

/** Con el mapa alejado y unos datos de antes, los números aún son de todas las compañías. */
const DE_LEJOS_SIN_FILTRAR = "Los números de lejos incluyen todas las compañías.";

/**
 * La línea de debajo del aviso, solo si algo sorprendería: que de lejos los números aún cuentan
 * todas (unos datos publicados antes de que se pudiera filtrar) o lo que sale más claro.
 */
export const detalleDelAviso = (
  filtro: FiltroDeCompanias,
  deLejosSinFiltrar: boolean,
): string | undefined => (deLejosSinFiltrar ? DE_LEJOS_SIN_FILTRAR : textoDeLaRedUsada(filtro));
