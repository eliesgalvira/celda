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
      },
    },
    defaultVariants: { tono: "verificado" },
  },
);

export type EtiquetaProps = VariantProps<typeof variantesEtiqueta> & {
  readonly children: JSX.Element;
};

/** Etiqueta de estado del tema Hexágono: estado de un emplazamiento o marca de modelo. */
export function Etiqueta(props: EtiquetaProps) {
  return (
    <span data-tono={props.tono ?? "verificado"} class={variantesEtiqueta({ tono: props.tono })}>
      <span aria-hidden="true" class="hexagono size-2 bg-current opacity-80" />
      {props.children}
    </span>
  );
}
