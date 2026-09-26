import type { Compania } from "@celda/dominio/compania";
import type { Estado } from "@celda/dominio/emplazamiento";
import { type JSX, Portal } from "@solidjs/web";
import { cva } from "class-variance-authority";
import { Show } from "solid-js";

import { variantesDiana } from "../Boton.tsx";
import { cn } from "../cn.ts";
import { idDeLogo, SimbolosDeLogos } from "./LogoCompanias.tsx";

/** Hexágono pequeño en la esquina para lo que no está verificado, como en los prototipos. */
const variantesSenal = cva("hexagono absolute -top-1 -right-1 h-3.5 w-3", {
  variants: {
    estado: {
      verificado: "hidden",
      corregido: "bg-corregido",
      nuevo: "bg-nuevo",
    },
  },
});

export interface MarcadorEmplazamientoProps {
  /** Posición del emplazamiento en la pantalla, en píxeles desde la esquina del mapa. */
  readonly x: number;
  readonly y: number;
  readonly companias: ReadonlyArray<Compania>;
  readonly estado: Estado;
  /** Nombre accesible: qué compañías emiten allí y, si no está verificado, su estado. */
  readonly nombre: string;
  /** El emplazamiento cuya ficha está abierta: se resalta y se anuncia como el actual. */
  readonly seleccionado?: boolean;
  readonly onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
}

/**
 * Marcador de un emplazamiento en el mapa: un botón con los logos de sus compañías, centrado
 * en su posición. El logo mide 34 px y la diana 44 px. Solo funciona dentro de
 * `CapaDeMarcadores`, que dibuja los logos que usa.
 */
export function MarcadorEmplazamiento(props: MarcadorEmplazamientoProps) {
  return (
    <button
      type="button"
      aria-label={props.nombre}
      data-estado={props.estado}
      aria-current={props.seleccionado === true ? "true" : undefined}
      // `cn` resuelve el choque entre el `relative` de la diana y el `absolute` del marcador.
      class={cn(
        variantesDiana(),
        "pointer-events-auto absolute top-0 left-0 -mt-[22px] -ml-[22px] will-change-transform",
        props.seleccionado === true && "z-10",
      )}
      style={{ transform: `translate(${props.x.toFixed(1)}px, ${props.y.toFixed(1)}px)` }}
      onClick={(evento) => props.onClick?.(evento)}
    >
      <span
        class={cn(
          "relative rounded-full drop-shadow-marcador transition-transform duration-150 ease-out",
          "group-hover:scale-110 group-active:scale-95 motion-reduce:transition-none",
          props.seleccionado === true &&
            "scale-125 ring-3 ring-primario ring-offset-2 ring-offset-superficie group-hover:scale-125",
        )}
      >
        <svg width="34" height="34" aria-hidden="true" class="block">
          <use href={`#${idDeLogo(props.companias)}`} />
        </svg>
        <Show when={props.estado !== "verificado"}>
          <span aria-hidden="true" class={variantesSenal({ estado: props.estado })} />
        </Show>
      </span>
    </button>
  );
}

export interface CapaDeMarcadoresProps {
  /** Nombre accesible del grupo de marcadores. */
  readonly nombre: string;
  /**
   * El elemento del mapa que recibe los gestos (en MapLibre, `getCanvasContainer()`). La lámina
   * va dentro, así que la rueda y los arrastres que empiezan sobre un marcador mueven el mapa.
   */
  readonly contenedor: HTMLElement;
  /** Las combinaciones de compañías que pueden aparecer: se dibuja un logo de cada una. */
  readonly combinaciones: ReadonlyArray<ReadonlyArray<Compania>>;
  readonly children: JSX.Element;
}

/**
 * La lámina donde van los marcadores, encima del mapa y dentro de su contenedor. No recoge los
 * gestos: solo los marcadores son pulsables.
 */
export function CapaDeMarcadores(props: CapaDeMarcadoresProps) {
  return (
    <Portal mount={props.contenedor}>
      <section
        aria-label={props.nombre}
        class="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <SimbolosDeLogos combinaciones={props.combinaciones} />
        {props.children}
      </section>
    </Portal>
  );
}
