import type { JSX } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";
import { Show } from "solid-js";

export const variantesAviso = cva("chaflan flex w-full flex-col gap-2 px-5 py-4 [--corte:16px]", {
  variants: {
    tono: {
      /** Algo está en marcha: se dice qué, sin alarmar. */
      espera: "animate-aparecer bg-superficie text-tinta",
      /** Algo no ha funcionado: se dice qué, por qué si se sabe y qué hacer. */
      fallo: "bg-aviso-fondo text-aviso-tinta",
    },
  },
  defaultVariants: { tono: "espera" },
});

export type AvisoProps = VariantProps<typeof variantesAviso> & {
  readonly titulo: string;
  readonly children?: JSX.Element;
  /** Botones o enlaces para salir del aviso. */
  readonly acciones?: JSX.Element;
};

/**
 * Un aviso honesto: lo que pasa, en frases claras, en lugar de un hueco vacío.
 * Los fallos se anuncian a los lectores de pantalla en cuanto aparecen.
 */
export function Aviso(props: AvisoProps) {
  return (
    <div class="w-[min(26rem,calc(100vw-2rem))] drop-shadow-panel">
      <section
        role={props.tono === "fallo" ? "alert" : "status"}
        data-tono={props.tono ?? "espera"}
        class={variantesAviso({ tono: props.tono })}
      >
        <h2 class="flex items-center gap-2 font-titulo text-lg tracking-wide">
          <span
            aria-hidden="true"
            class={
              props.tono === "fallo"
                ? "hexagono size-3 shrink-0 bg-aviso"
                : "hexagono size-3 shrink-0 animate-pulse bg-primario motion-reduce:animate-none"
            }
          />
          {props.titulo}
        </h2>
        <Show when={props.children}>
          <div class="text-sm leading-relaxed">{props.children}</div>
        </Show>
        <Show when={props.acciones}>
          <div class="mt-1 flex flex-wrap gap-2">{props.acciones}</div>
        </Show>
      </section>
    </div>
  );
}
