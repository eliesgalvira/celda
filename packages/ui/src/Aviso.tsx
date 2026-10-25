import type { JSX } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";
import { Show } from "solid-js";

import { BotonCerrar } from "./Boton.tsx";

export const variantesAviso = cva("chaflan flex w-full flex-col gap-2 px-5 py-4 [--corte:16px]", {
  variants: {
    tono: {
      /** Algo está en marcha: se dice qué, sin alarmar. */
      espera: "animate-aparecer bg-superficie text-tinta",
      /** Algo no ha funcionado: se dice qué, por qué si se sabe y qué hacer. */
      fallo: "bg-aviso-fondo text-aviso-tinta",
      /** Algo que Celda aún no tiene: se dice qué falta, sin alarmar y sin fingir que no existe. */
      limite: "animate-aparecer bg-superficie text-tinta",
      /** Algo que se ha hecho bien, como un envío recibido. */
      hecho: "bg-superficie-alta text-tinta shadow-[inset_3px_0_0_var(--primario)]",
    },
  },
  defaultVariants: { tono: "espera" },
});

/** El hexágono delante del título, del color de su tono. */
const variantesHexagonoAviso = cva("hexagono size-3 shrink-0", {
  variants: {
    tono: {
      espera: "animate-pulse bg-primario motion-reduce:animate-none",
      fallo: "bg-aviso",
      limite: "bg-aviso",
      hecho: "bg-primario",
    },
  },
  defaultVariants: { tono: "espera" },
});

/** Dónde va el aviso: flotando sobre el mapa o dentro de un panel, a todo su ancho. */
export const variantesEncajeAviso = cva("", {
  variants: {
    encaje: {
      flotante: "w-[min(26rem,calc(100vw-2rem))] drop-shadow-panel",
      panel: "w-full",
    },
  },
  defaultVariants: { encaje: "flotante" },
});

export type AvisoProps = VariantProps<typeof variantesAviso> &
  VariantProps<typeof variantesEncajeAviso> & {
    readonly titulo: string;
    readonly children?: JSX.Element;
    /** Botones o enlaces con lo que se puede hacer. */
    readonly acciones?: JSX.Element;
    /** Con él, el aviso lleva la ✕ arriba a la derecha. */
    readonly alCerrar?: () => void;
  };

/**
 * Un aviso honesto: lo que pasa, en frases claras, en lugar de un hueco vacío.
 * Los fallos se anuncian a los lectores de pantalla en cuanto aparecen.
 */
export function Aviso(props: AvisoProps) {
  return (
    <div class={variantesEncajeAviso({ encaje: props.encaje })}>
      <section
        role={props.tono === "fallo" ? "alert" : "status"}
        data-tono={props.tono ?? "espera"}
        class={variantesAviso({ tono: props.tono })}
      >
        <div class="flex items-start gap-2">
          <h2 class="flex flex-1 items-center gap-2 font-titulo text-lg tracking-wide">
            <span aria-hidden="true" class={variantesHexagonoAviso({ tono: props.tono })} />
            {props.titulo}
          </h2>
          <Show when={props.alCerrar}>
            {(alCerrar) => (
              <div class="-my-2 -mr-3">
                <BotonCerrar alCerrar={alCerrar()} />
              </div>
            )}
          </Show>
        </div>
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
