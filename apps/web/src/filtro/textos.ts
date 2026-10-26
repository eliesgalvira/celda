import { NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { enumerar } from "@celda/dominio/enumerar";
import {
  type FiltroDeCompanias,
  hayFiltro,
  mismoFiltro,
  nombresDelFiltro,
  redesUsadas,
  type SinRedPropia,
} from "@celda/dominio/filtro";

/**
 * Los textos del filtro de compañías (ADR 0026). Lo que ya dicen los chips pulsados no se repite;
 * solo se escribe lo que sorprendería: lo que sale más claro y por qué se ve otra compañía que la
 * sin red propia que se ha tocado.
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

/** «Simyo usa la red de Orange.», mientras el filtro sea solo el de esa red. */
const textoSinRedPropia = (
  filtro: FiltroDeCompanias,
  sinRedPropia: SinRedPropia | undefined,
): string | undefined =>
  sinRedPropia !== undefined && mismoFiltro(filtro, [sinRedPropia.red])
    ? `${sinRedPropia.compania} usa la red de ${NOMBRE_COMPANIA[sinRedPropia.red]}.`
    : undefined;

/**
 * La línea de debajo del aviso, solo si algo sorprendería: la red que usa la compañía sin red
 * propia que se ha tocado o lo que sale más claro.
 */
export const detalleDelAviso = (
  filtro: FiltroDeCompanias,
  sinRedPropia?: SinRedPropia,
): string | undefined => textoSinRedPropia(filtro, sinRedPropia) ?? textoDeLaRedUsada(filtro);
