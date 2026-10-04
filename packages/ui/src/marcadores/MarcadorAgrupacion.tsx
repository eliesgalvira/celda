import type { JSX } from "@solidjs/web";
import { cva } from "class-variance-authority";

import { variantesDiana } from "../Boton.tsx";
import { cn } from "../cn.ts";
import { Deslizable, type Movimiento } from "./Deslizable.tsx";
import { type TamanoDeMarcador, variantesDibujo, variantesTamano } from "./tamano.ts";

/** Con cuatro cifras el número se achica para caber en el hexágono. */
const variantesNumero = cva("relative font-mono font-semibold text-tinta-invertida", {
  variants: {
    cifras: {
      pocas: "text-base",
      muchas: "text-xs",
    },
  },
});

export interface MarcadorAgrupacionProps {
  /** Posición de la agrupación en la pantalla, en píxeles desde la esquina del mapa. */
  readonly x: number;
  readonly y: number;
  /** Cuántos emplazamientos recoge. Es la etiqueta visible. */
  readonly cuantos: number;
  /** Nombre accesible; empieza por el número, como la etiqueta visible. */
  readonly nombre: string;
  /** Cómo aparece o se va al agrupar y separar. Sin él, aparece sin transición. */
  readonly movimiento?: Movimiento;
  /** Lo grande que va el hexágono según lo lejos que está el mapa. Sin él, `normal`. */
  readonly tamano?: TamanoDeMarcador;
  readonly onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
}

const QUIETO: Movimiento = { tipo: "quieto" };

/**
 * Agrupación en el mapa: un hexágono oscuro con borde del color primario y el número de
 * emplazamientos que recoge, centrado en su posición. Es un botón de 50 × 56 px que acerca el
 * mapa a su zona. Va por encima de los marcadores sueltos. De lejos encoge y se vuelve algo
 * translúcido (`tamano`, ADR 0024). Mientras sale ya no se puede pulsar ni enfocar.
 */
export function MarcadorAgrupacion(props: MarcadorAgrupacionProps) {
  const saliendo = () => props.movimiento?.tipo === "sale";
  return (
    <button
      type="button"
      aria-label={props.nombre}
      inert={saliendo()}
      data-tamano={props.tamano ?? "normal"}
      class={cn(
        variantesDiana(),
        "absolute top-0 left-0 z-10 -mt-7 -ml-[25px] cursor-zoom-in will-change-transform",
        saliendo() ? "pointer-events-none" : "pointer-events-auto",
      )}
      style={{ transform: `translate(${props.x.toFixed(1)}px, ${props.y.toFixed(1)}px)` }}
      onClick={(evento) => props.onClick?.(evento)}
    >
      <Deslizable forma="agrupacion" movimiento={props.movimiento ?? QUIETO}>
        <span class={variantesTamano({ tamano: props.tamano ?? "normal" })}>
          <span class="relative grid h-14 w-[50px] place-items-center drop-shadow-marcador transition-transform duration-150 ease-out group-hover:scale-110 group-active:scale-95 motion-reduce:transition-none">
            <svg
              viewBox="0 0 50 56"
              aria-hidden="true"
              class={variantesDibujo({ tamano: props.tamano ?? "normal" })}
            >
              <polygon
                points="25,2 48,15 48,41 25,54 2,41 2,15"
                class="fill-superficie-invertida transition-[fill] duration-150 group-hover:fill-primario-activo"
              />
              <polygon
                points="25,7 43.5,17.5 43.5,38.5 25,49 6.5,38.5 6.5,17.5"
                fill="none"
                stroke-width="1.4"
                class="stroke-primario"
              />
            </svg>
            <span
              aria-hidden="true"
              class={variantesNumero({ cifras: props.cuantos >= 1000 ? "muchas" : "pocas" })}
            >
              {props.cuantos}
            </span>
          </span>
        </span>
      </Deslizable>
    </button>
  );
}
