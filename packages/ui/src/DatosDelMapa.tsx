import type { JSX } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";
import { Show } from "solid-js";

export const variantesDatosDelMapa = cva(
  "cinta inline-flex w-60 items-center justify-center gap-1.5 bg-superficie/90 px-3 py-0.5 font-mono text-[11px] leading-5 [--pico:6px]",
  {
    variants: {
      tono: {
        /** La fecha de la capa que se ve. */
        fecha: "text-tinta",
        /** La capa aún no ha llegado: se dice, para que el mapa no parezca vacío. */
        espera: "text-tinta-suave",
        /** La capa no ha cargado. */
        fallo: "text-aviso-tinta",
      },
    },
    defaultVariants: { tono: "fecha" },
  },
);

export type DatosDelMapaProps = VariantProps<typeof variantesDatosDelMapa> & {
  /** Qué se ve. Puede llevar un `Termino`. */
  readonly texto: JSX.Element;
  /** Detalle para quien pasa el puntero, como la versión exacta de la capa. */
  readonly detalle?: string;
};

/**
 * La marca de agua del mapa: de qué fecha son los datos que se ven (historia 56). Tiene un ancho
 * fijo, así que cambiar de «cargando» a la fecha no mueve nada.
 */
export function DatosDelMapa(props: DatosDelMapaProps) {
  return (
    <output
      title={props.detalle}
      data-tono={props.tono ?? "fecha"}
      class={variantesDatosDelMapa({ tono: props.tono })}
    >
      <Show when={props.tono === "espera"}>
        <span
          aria-hidden="true"
          class="hexagono size-2 shrink-0 animate-pulse bg-primario motion-reduce:animate-none"
        />
      </Show>
      <span class="truncate">{props.texto}</span>
    </output>
  );
}
