import { createContext } from "solid-js";

/**
 * Cómo se dibuja un control del mapa según dónde lo coloca `DisposicionMapa`:
 *
 * - `pastilla`: una cinta clara con el icono y la etiqueta en línea, abajo a la derecha.
 * - `zoom`: una losa clara pequeña, sin etiqueta a la vista (Acercar y Alejar en escritorio).
 * - `fila`: una fila del menú «Funciones», con su explicación.
 */
export type AspectoControl = "pastilla" | "zoom" | "fila";

export const AspectoDeControl = createContext<AspectoControl>("pastilla");
