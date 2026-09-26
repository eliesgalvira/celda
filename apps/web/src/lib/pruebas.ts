import { GLOSARIO, type Termino } from "@celda/dominio/glosario";

/**
 * Busca por el texto entero de un elemento aunque un término subrayado lo parta en varios
 * nodos: `getByText(textoEntero("Datos del mapa: 26 sept 2026"))`. Devuelve el elemento más
 * interior que lo contiene entero.
 */
export const textoEntero =
  (texto: string) =>
  (_contenido: string, elemento: Element | null): boolean =>
    elemento?.textContent === texto &&
    Array.from(elemento.children).every((hijo) => hijo.textContent !== texto);

/** Los términos subrayados dentro de un elemento, en orden de lectura. */
export const terminosSubrayados = (dentro: Element): ReadonlyArray<string> =>
  Array.from(
    dentro.querySelectorAll("[data-termino]"),
    (e) => e.getAttribute("data-termino") ?? "",
  );

/** Si un término subrayado en la interfaz tiene entrada en el glosario. */
export const estaEnElGlosario = (termino: string): termino is Termino =>
  Object.hasOwn(GLOSARIO, termino);
