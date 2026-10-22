import { NOMBRE_COMPANIA, type Compania } from "@celda/dominio/compania";
import { type FiltroDeCompanias, redesUsadas } from "@celda/dominio/filtro";

import { enumerar } from "@celda/dominio/enumerar";
import { nombreRumbo, textoDistancia } from "../ubicacion/textos.ts";
import type { ListaDePuntos, PuntoDeLaLista } from "./puntos.ts";

/** Los textos de la vista de puntos (ADR 0028), en castellano llano y lo más cortos posible. */

/** El control de «Funciones» que cambia de vista, y su línea. */
export const VISTA_AGRUPADA = "Vista agrupada";
export const DETALLE_VISTA_AGRUPADA = "Junta los emplazamientos en hexágonos con su número.";

/** El control de «Funciones» que abre la lista, su línea y el título de su diálogo. */
export const LISTA_DE_EMPLAZAMIENTOS = "Lista de emplazamientos";
export const DETALLE_LISTA = "Los que se ven, para elegir uno.";
export const TITULO_DE_LA_LISTA = "Emplazamientos a la vista";

const NUMERO = new Intl.NumberFormat("es-ES", { useGrouping: "always" });

/** Lo que dice la lista de cuántos se ven y cuáles van en ella. */
export const resumenDeLaLista = (lista: ListaDePuntos): string => {
  if (lista.total === 0) return "No se ve ninguno. Mueve o aleja el mapa.";
  if (lista.total === 1) return "Se ve uno.";
  if (lista.total <= lista.primeros.length) {
    return `Se ven ${NUMERO.format(lista.total)}, del más cercano al centro del mapa al más lejano.`;
  }
  return `Se ven ${NUMERO.format(lista.total)}. Aquí van los ${NUMERO.format(lista.primeros.length)} más cercanos al centro del mapa.`;
};

/** Las compañías de un emplazamiento, escritas: «Movistar y Orange». */
export const nombreDeCompanias = (companias: ReadonlyArray<Compania>): string =>
  enumerar(companias.map((c) => NOMBRE_COMPANIA[c]));

/** Dónde queda un emplazamiento de la lista: «a 230 m al noreste del centro». */
export const dondeQueda = (punto: PuntoDeLaLista): string =>
  punto.distancia < 10
    ? "en el centro del mapa"
    : `a ${textoDistancia(punto.distancia)} al ${nombreRumbo(punto.rumbo)} del centro`;

/** Lo que dice un emplazamiento de la red usada: «red de Movistar que usa Digi». */
export const deLaRedUsada = (
  punto: PuntoDeLaLista,
  filtro: FiltroDeCompanias,
): string | undefined => {
  if (!punto.redUsada) return undefined;
  const suyas = redesUsadas(filtro).filter((r) => punto.companias.includes(r.red));
  const de = enumerar([...new Set(suyas.map((r) => NOMBRE_COMPANIA[r.red]))]);
  const quienes = enumerar(suyas.map((r) => NOMBRE_COMPANIA[r.compania]));
  return `red de ${de} que usa ${quienes}`;
};
