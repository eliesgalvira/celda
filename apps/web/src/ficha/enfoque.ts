import { ALTO_RESUMEN } from "@celda/ui/panel/hoja.ts";

/** Ancho del panel en escritorio (`md:w-[27rem]` de `PanelEmplazamiento`). */
const ANCHO_PANEL = 432;
/** Aire que se deja entre el marcador y el borde del panel. */
const MARGEN = 56;

export interface Pantalla {
  readonly ancho: number;
  readonly alto: number;
  /** En escritorio el panel va a la izquierda; en el móvil, abajo. */
  readonly escritorio: boolean;
}

/**
 * Cuánto hay que mover el mapa (en píxeles, como `panBy`) para que un marcador que se acaba de
 * seleccionar no quede debajo del panel. Nada si ya se ve: seleccionar no mueve el mapa sin
 * necesidad, y cerrar el panel nunca lo mueve (historia 22).
 */
export const desplazamientoParaVer = (
  punto: { readonly x: number; readonly y: number },
  pantalla: Pantalla,
): readonly [number, number] | undefined => {
  if (pantalla.escritorio) {
    const limite = Math.min(ANCHO_PANEL + MARGEN, pantalla.ancho / 2);
    return punto.x < limite ? [punto.x - limite, 0] : undefined;
  }
  const limite = Math.max(pantalla.alto / 2, pantalla.alto - ALTO_RESUMEN - MARGEN);
  return punto.y > limite ? [0, punto.y - limite] : undefined;
};

/**
 * Dónde queda, respecto al centro de la pantalla, el centro de lo que deja libre el panel abierto
 * (en píxeles, como el `offset` de `flyTo`): a la derecha de la columna en escritorio y encima del
 * resumen de la hoja en el móvil.
 */
export const centroLibre = (escritorio: boolean): readonly [number, number] =>
  escritorio ? [ANCHO_PANEL / 2, 0] : [0, -ALTO_RESUMEN / 2];
