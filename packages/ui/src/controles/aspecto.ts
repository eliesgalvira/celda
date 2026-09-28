import { createContext } from "solid-js";

/**
 * PROTOTIPO (controles): cómo se dibuja un control del mapa según dónde lo coloca
 * `DisposicionMapa`. Sin el prototipo todos son `hexagono`, el de hoy.
 *
 * - `hexagono`: el hexágono oscuro con la etiqueta debajo.
 * - `piedra`: una losa clara con borde de tinta y la etiqueta dentro (variante A).
 * - `zoom`: una losa clara pequeña, sin etiqueta a la vista (Acercar y Alejar en A, B y C).
 * - `barra`: una casilla de la barra de funciones (variante B).
 * - `pastilla`: una cinta clara con el icono y la etiqueta en línea (variante C).
 * - `fila`: una fila de un menú desplegado, con su explicación (el «Más» de B y el menú de C).
 */
export type AspectoControl = "hexagono" | "piedra" | "zoom" | "barra" | "pastilla" | "fila";

export const AspectoDeControl = createContext<AspectoControl>("hexagono");

/** La disposición de los controles que se prueba: la de hoy o una de las tres variantes. */
export type DisposicionControles = "actual" | "A" | "B" | "C";
