import type { JSX } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";

export const variantesEtiqueta = cva(
  // Un término dentro, como el estado (#18), se subraya del color del texto: el primario no se
  // vería sobre el fondo de «Verificado».
  "cinta inline-flex items-center gap-1.5 py-1 pr-3.5 pl-2.5 font-mono text-xs font-semibold tracking-wider whitespace-nowrap [&_[data-termino]]:decoration-current",
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
        pronto:
          "bg-superficie-alta text-tinta-suave shadow-[inset_0_0_0_1.5px_var(--linea-fuerte)]",
        /** Una aportación que el buzón de Celda ya ha recibido. */
        compartida: "bg-primario text-primario-fg",
        /** Una aportación que solo está en este dispositivo. */
        local: "bg-superficie-alta text-tinta shadow-[inset_0_0_0_1.5px_var(--linea-fuerte)]",
      },
    },
    defaultVariants: { tono: "verificado" },
  },
);

export type EtiquetaProps = VariantProps<typeof variantesEtiqueta> & {
  readonly children: JSX.Element;
};

/**
 * Etiqueta del tema Hexágono: estado de un emplazamiento, marca de modelo o de ejemplo, algo que
 * llega pronto o si una aportación se ha compartido.
 */
export function Etiqueta(props: EtiquetaProps) {
  return (
    <span data-tono={props.tono ?? "verificado"} class={variantesEtiqueta({ tono: props.tono })}>
      <span aria-hidden="true" class="hexagono size-2 bg-current opacity-80" />
      {props.children}
    </span>
  );
}
