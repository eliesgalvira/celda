import type { JSX } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";

export const variantesEtiqueta = cva(
  "cinta inline-flex items-center gap-1.5 py-1 pr-3.5 pl-2.5 font-mono text-xs font-semibold tracking-wider whitespace-nowrap",
  {
    variants: {
      tono: {
        verificado: "bg-verificado text-verificado-fg",
        corregido: "bg-corregido text-corregido-fg",
        nuevo: "bg-nuevo text-nuevo-fg",
        /** Una simulación: siempre se marca como modelo, nunca como dato. */
        modelo: "bg-superficie-alta text-tinta shadow-[inset_0_0_0_1.5px_var(--tinta)]",
        /** Una medida de ejemplo: nunca se confunde con una propia (historia 49). */
        ejemplo: "bg-ejemplo text-ejemplo-fg",
        /** Algo que se enseña pero todavía no funciona. */
        pronto: "bg-superficie-alta text-tinta-suave shadow-[inset_0_0_0_1.5px_var(--linea-fuerte)]",
      },
    },
    defaultVariants: { tono: "verificado" },
  },
);

export type EtiquetaProps = VariantProps<typeof variantesEtiqueta> & {
  readonly children: JSX.Element;
};

/**
 * Etiqueta del tema Hexágono: estado de un emplazamiento, marca de modelo o de ejemplo, o algo que
 * llega pronto.
 */
export function Etiqueta(props: EtiquetaProps) {
  return (
    <span data-tono={props.tono ?? "verificado"} class={variantesEtiqueta({ tono: props.tono })}>
      <span aria-hidden="true" class="hexagono size-2 bg-current opacity-80" />
      {props.children}
    </span>
  );
}
