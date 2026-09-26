import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

export interface PistaProps {
  readonly texto: string;
  /**
   * Lo que se ve sale de una simulación: `id@version`. Se escribe delante del texto, como
   * «Modelo celdas@1», para que no se tome por un dato.
   */
  readonly modelo?: string | undefined;
  /** Un botón junto a la pista, como «Reintentar». Es lo único de la pista que recibe el puntero. */
  readonly accion?: JSX.Element | undefined;
}

/** Una indicación breve sobre el mapa, que no tapa los gestos: «acércate para ver…». */
export function Pista(props: PistaProps) {
  return (
    <div class="flex flex-wrap items-center justify-center gap-2">
      <output class="cinta inline-flex animate-aparecer flex-wrap items-center justify-center gap-x-2 bg-superficie-invertida px-4 py-1 text-center font-mono text-xs leading-5 text-tinta-invertida [--pico:8px]">
        <Show when={props.modelo}>
          {(modelo) => (
            <span class="px-1.5 font-semibold tracking-wider whitespace-nowrap shadow-[inset_0_0_0_1px_var(--tinta-invertida)]">
              Modelo {modelo()}
            </span>
          )}
        </Show>
        <span>{props.texto}</span>
      </output>
      <Show when={props.accion}>
        <div class="pointer-events-auto">{props.accion}</div>
      </Show>
    </div>
  );
}
