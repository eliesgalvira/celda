import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

export interface PistaProps {
  readonly texto: string;
  /** Un botón junto a la pista, como «Reintentar». Es lo único de la pista que recibe el puntero. */
  readonly accion?: JSX.Element | undefined;
}

/**
 * Una indicación breve sobre el mapa, que no tapa los gestos: «acércate para ver…». Si no cabe en
 * una línea, pasa a la siguiente en vez de llegar a los controles.
 */
export function Pista(props: PistaProps) {
  return (
    <div class="flex flex-wrap items-center justify-center gap-2">
      <output class="cinta inline-flex max-w-[min(32rem,100%)] animate-aparecer flex-wrap items-center justify-center gap-x-2 bg-superficie-invertida px-4 py-1 text-center font-mono text-xs leading-5 text-tinta-invertida [--pico:8px]">
        <span>{props.texto}</span>
      </output>
      <Show when={props.accion}>
        <div class="pointer-events-auto">{props.accion}</div>
      </Show>
    </div>
  );
}
