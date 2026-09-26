import type { Compania } from "@celda/dominio/compania";
import type { JSX } from "@solidjs/web";
import { Match, Show, Switch } from "solid-js";

import { variantesDiana } from "../Boton.tsx";
import { cn } from "../cn.ts";
import { Ausencias, MarcaDeAusencia } from "./Ausencias.tsx";
import { Deslizable, type Movimiento } from "./Deslizable.tsx";

/**
 * - `completa`: el nombre del barrio, su número de emplazamientos y sus ausencias.
 * - `compacta`: un hexágono pequeño con el número, y la marca de ausencia si falta alguna
 *   compañía. Es para cuando la completa pisaría la etiqueta de un barrio vecino.
 */
export type FormaDeBarrio = "completa" | "compacta";

export interface Medida {
  readonly ancho: number;
  readonly alto: number;
}

/** Ancho de la etiqueta completa, en píxeles: `w-38`. */
const ANCHO_COMPLETA = 152;
/** Lo que ocupa de media una letra del nombre, en mayúsculas espaciadas. */
const LETRA = 10;
const LINEA = 16;
/** Alto de la cinta de ausencias con logos de 20 px. */
const ALTO_AUSENCIAS = 32;

/**
 * Lo que ocupa la etiqueta de un barrio en la pantalla, para decidir si cabe entera sin pisar
 * otra. Es una estimación por arriba a partir de las medidas de las clases de este fichero: el
 * nombre ocupa como mucho tres líneas.
 */
export const medidaDeBarrio = (forma: FormaDeBarrio, nombre: string, ausentes: number): Medida => {
  if (forma === "compacta") return { ancho: 44, alto: 44 };
  const lineas = Math.min(3, Math.max(1, Math.ceil((nombre.length * LETRA) / ANCHO_COMPLETA)));
  const cinta = ausentes === 0 ? 0 : 4 + ALTO_AUSENCIAS;
  return {
    ancho: Math.max(ANCHO_COMPLETA, 45 + 30 * ausentes),
    alto: 4 + lineas * LINEA + 2 + LINEA + cinta,
  };
};

export interface MarcadorBarrioProps {
  /** Posición de la etiqueta en la pantalla, en píxeles desde la esquina del mapa. */
  readonly x: number;
  readonly y: number;
  readonly forma: FormaDeBarrio;
  /** Nombre del barrio, que se ve en mayúsculas. */
  readonly barrio: string;
  /** Cuántos emplazamientos tiene. */
  readonly emplazamientos: number;
  /** Compañías sin ningún emplazamiento en el barrio. */
  readonly ausentes: ReadonlyArray<Compania>;
  /** Nombre accesible: el barrio, su número, sus ausencias y qué hace al pulsarlo. */
  readonly nombre: string;
  /** Cómo aparece o se va al cambiar de nivel. Sin él, aparece sin transición. */
  readonly movimiento?: Movimiento;
  readonly onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
}

const QUIETO: Movimiento = { tipo: "quieto" };

/** «17 emplazamientos», «1 emplazamiento», «ningún emplazamiento». */
export const textoDeEmplazamientos = (cuantos: number): string =>
  cuantos === 0
    ? "ningún emplazamiento"
    : cuantos === 1
      ? "1 emplazamiento"
      : `${cuantos} emplazamientos`;

/**
 * Un barrio en el mapa, centrado en su etiqueta (historia 7). Completo, como en el prototipo v8:
 * el nombre en mayúsculas espaciadas, «N emplazamientos» y «sin» con el logo de cada compañía
 * ausente. Compacto, un hexágono claro con el número. Es un botón que acerca el mapa al barrio.
 */
export function MarcadorBarrio(props: MarcadorBarrioProps) {
  const saliendo = () => props.movimiento?.tipo === "sale";
  return (
    <button
      type="button"
      aria-label={props.nombre}
      inert={saliendo()}
      data-forma={props.forma}
      class={cn(
        variantesDiana(),
        "absolute top-0 left-0 z-10 -translate-1/2 cursor-zoom-in will-change-transform",
        props.forma === "completa" ? "w-38" : "size-11",
        saliendo() ? "pointer-events-none" : "pointer-events-auto",
      )}
      style={{ transform: `translate(${props.x.toFixed(1)}px, ${props.y.toFixed(1)}px)` }}
      onClick={(evento) => props.onClick?.(evento)}
    >
      <Deslizable forma="agrupacion" movimiento={props.movimiento ?? QUIETO}>
        <Switch>
          <Match when={props.forma === "completa"}>
            <span class="flex flex-col items-center gap-0.5 py-0.5 text-center">
              <span class="halo line-clamp-3 font-titulo text-sm leading-4 tracking-[0.08em] text-tinta uppercase group-hover:text-primario-texto">
                {props.barrio}
              </span>
              <span class="halo font-mono text-[11.5px] leading-4 text-primario-texto">
                {textoDeEmplazamientos(props.emplazamientos)}
              </span>
              <Show when={props.ausentes.length > 0}>
                <span class="mt-1">
                  <Ausencias companias={props.ausentes} />
                </span>
              </Show>
            </span>
          </Match>
          <Match when={props.forma === "compacta"}>
            <span class="relative grid h-[38px] w-[34px] place-items-center drop-shadow-marcador transition-transform duration-150 ease-out group-hover:scale-110 group-active:scale-95 motion-reduce:transition-none">
              <svg viewBox="0 0 34 38" aria-hidden="true" class="absolute inset-0 size-full">
                <polygon
                  points="17,1 33,10 33,28 17,37 1,28 1,10"
                  stroke-width="1.5"
                  class="fill-superficie stroke-primario transition-[fill] duration-150 group-hover:fill-superficie-alta"
                />
              </svg>
              <span class="relative font-mono text-xs font-semibold text-tinta">
                {props.emplazamientos}
              </span>
              <Show when={props.ausentes.length > 0}>
                <MarcaDeAusencia />
              </Show>
            </span>
          </Match>
        </Switch>
      </Deslizable>
    </button>
  );
}
