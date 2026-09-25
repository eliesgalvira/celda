import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";

import { variantesDiana } from "./Boton.tsx";

export type BotonHexagonalProps = Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  "class" | "style" | "children" | "aria-pressed"
> & {
  /** Texto visible bajo el hexágono; es también el nombre accesible del botón. */
  readonly etiqueta: string;
  /** El dibujo del hexágono (un signo o un icono SVG con `currentColor`). */
  readonly icono: JSX.Element;
  /** Para los botones que se encienden y apagan (una vista, un modo). */
  readonly activo?: boolean;
};

/**
 * El control del mapa del tema Hexágono. La etiqueta siempre se ve: los
 * controles no se adivinan por el icono (historia 65).
 */
export function BotonHexagonal(props: BotonHexagonalProps) {
  const resto = omit(props, "etiqueta", "icono", "activo", "type");
  return (
    <button
      type={props.type ?? "button"}
      aria-pressed={props.activo === undefined ? undefined : props.activo ? "true" : "false"}
      class={variantesDiana({ class: "flex-col gap-1" })}
      {...resto}
    >
      <span
        aria-hidden="true"
        class={
          "hexagono grid h-[45px] w-10 place-items-center bg-superficie-invertida font-mono text-xl text-tinta-invertida " +
          "transition-[background-color,transform] duration-150 ease-out md:h-[52px] md:w-[46px] " +
          "group-hover:bg-primario group-hover:text-primario-fg group-active:translate-y-px group-active:bg-primario-activo " +
          "group-aria-pressed:bg-primario group-aria-pressed:text-primario-fg group-disabled:opacity-50"
        }
      >
        {props.icono}
      </span>
      <span class="cinta bg-superficie px-2 font-mono text-[11px] leading-5 text-tinta [--pico:6px] group-disabled:text-tinta-suave">
        {props.etiqueta}
      </span>
    </button>
  );
}
