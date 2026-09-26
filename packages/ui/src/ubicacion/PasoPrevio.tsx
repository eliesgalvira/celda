import type { JSX } from "@solidjs/web";

/**
 * Las piezas del paso previo a pedir la ubicación, dentro de un `Dialogo`: la lista de lo que
 * hay que saber y los botones del final.
 */

/** Una lista de puntos cortos. */
export function ListaPasoPrevio(props: { readonly children: JSX.Element }) {
  return <ul class="flex list-disc flex-col gap-1.5 pl-5">{props.children}</ul>;
}

/** Los botones del final, alineados a la derecha; el último es la acción principal. */
export function AccionesPasoPrevio(props: { readonly children: JSX.Element }) {
  return <div class="flex flex-wrap justify-end gap-2 pt-1">{props.children}</div>;
}
