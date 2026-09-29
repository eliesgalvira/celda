import type { Compania } from "@celda/dominio/compania";
import type { JSX } from "@solidjs/web";
import { cva } from "class-variance-authority";
import { Match, Show, Switch } from "solid-js";

import { variantesDiana } from "../Boton.tsx";
import { cn } from "../cn.ts";
import { Ausencias } from "./Ausencias.tsx";
import { Deslizable, type Movimiento } from "./Deslizable.tsx";
import type { FormaDeBarrio, Medida } from "./MarcadorBarrio.tsx";

/**
 * Cuánto sabe Celda de una provincia (ADR 0016):
 *
 * - `entera`: una zona de barrido la cubre de punta a punta; su número es el de la provincia.
 * - `parcial`: solo se ha barrido una parte; su número es el de esa parte.
 * - `ninguna`: no se ha barrido nada; no tiene número.
 */
export type CoberturaDeProvincia = "entera" | "parcial" | "ninguna";

/** Si su capa se está pidiendo o no ha llegado. Sin él, se ve solo el resumen. */
export type CargaDelMarcador = "resumen" | "cargando" | "fallo";

const variantesHexagono = cva("transition-[fill] duration-150", {
  variants: {
    cobertura: {
      entera: "fill-superficie-invertida group-hover:fill-primario-activo",
      parcial: "fill-superficie-invertida group-hover:fill-primario-activo",
      ninguna: "fill-superficie group-hover:fill-superficie-alta",
    },
  },
});

const variantesBorde = cva("fill-none", {
  variants: {
    cobertura: {
      entera: "stroke-primario",
      // Discontinuo: lo que cuenta es solo una parte de la provincia.
      parcial: "stroke-primario [stroke-dasharray:4_3]",
      ninguna: "stroke-tinta-suave [stroke-dasharray:4_3]",
    },
  },
});

const variantesNumero = cva("relative font-mono font-semibold text-tinta-invertida", {
  variants: {
    cifras: {
      pocas: "text-base",
      muchas: "text-xs",
      demasiadas: "text-[10px]",
    },
  },
});

const cifras = (cuantos: number) =>
  cuantos >= 10_000 ? "demasiadas" : cuantos >= 1000 ? "muchas" : "pocas";

/** Ancho de la etiqueta completa, en píxeles: `w-38`. */
const ANCHO_COMPLETA = 152;
const LINEA = 16;
/** Alto de la cinta de ausencias con logos de 20 px. */
const ALTO_AUSENCIAS = 32;
/** El hexágono: 50 × 56 px. */
const HEXAGONO: Medida = { ancho: 50, alto: 56 };

/**
 * Lo que ocupa una provincia en la pantalla, para decidir si cabe entera sin pisar otra. Es una
 * estimación por arriba con las clases de este fichero: el hexágono, el nombre en una línea, lo
 * que se sabe de ella y, si las hay, sus ausencias.
 */
export const medidaDeProvincia = (forma: FormaDeBarrio, ausentes: number): Medida =>
  forma === "compacta"
    ? HEXAGONO
    : {
        ancho: Math.max(ANCHO_COMPLETA, 45 + 30 * ausentes),
        alto: HEXAGONO.alto + 2 + 2 * LINEA + (ausentes === 0 ? 0 : 4 + ALTO_AUSENCIAS),
      };

/** Lo que se dice bajo el nombre, según lo que se sabe de la provincia y su carga. */
export const textoDeProvincia = (
  cobertura: CoberturaDeProvincia,
  carga: CargaDelMarcador,
): string => {
  if (carga === "cargando") return "cargando…";
  if (carga === "fallo") return "no ha llegado";
  if (cobertura === "parcial") return "solo una parte";
  if (cobertura === "ninguna") return "aún no está";
  return "";
};

export interface MarcadorProvinciaProps {
  /** Posición del hexágono en la pantalla, en píxeles desde la esquina del mapa. */
  readonly x: number;
  readonly y: number;
  readonly forma: FormaDeBarrio;
  /** Nombre de la provincia, que se ve en mayúsculas. */
  readonly provincia: string;
  /** Cuántos emplazamientos tiene en el resumen. Sin cubrir no se enseña. */
  readonly emplazamientos: number;
  readonly cobertura: CoberturaDeProvincia;
  readonly carga: CargaDelMarcador;
  /** Compañías sin ningún emplazamiento en la provincia; solo en una cubierta entera. */
  readonly ausentes: ReadonlyArray<Compania>;
  /** Nombre accesible: la provincia, su número, lo que se sabe de ella y qué hace al pulsarla. */
  readonly nombre: string;
  /** Cómo aparece o se va al cambiar de nivel. Sin él, aparece sin transición. */
  readonly movimiento?: Movimiento;
  readonly onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
}

const QUIETO: Movimiento = { tipo: "quieto" };

/**
 * Una provincia del resumen nacional en el mapa: un hexágono con su número y, en la forma
 * completa, su nombre, lo que Celda sabe de ella y sus ausencias. Una provincia a medias lleva el
 * borde discontinuo y lo dice; una sin cubrir va en claro, sin número. Mientras su capa llega,
 * el hexágono late. Es un botón que acerca el mapa a la provincia.
 */
export function MarcadorProvincia(props: MarcadorProvinciaProps) {
  const saliendo = () => props.movimiento?.tipo === "sale";
  const conNumero = () => props.cobertura !== "ninguna";
  const estado = () => textoDeProvincia(props.cobertura, props.carga);
  return (
    <button
      type="button"
      aria-label={props.nombre}
      aria-busy={props.carga === "cargando" ? "true" : undefined}
      inert={saliendo()}
      data-forma={props.forma}
      data-cobertura={props.cobertura}
      data-carga={props.carga}
      class={cn(
        variantesDiana(),
        "absolute top-0 left-0 z-10 -mt-7 cursor-zoom-in will-change-transform",
        props.forma === "completa" ? "-ml-19 w-38" : "-ml-[25px] w-[50px]",
        saliendo() ? "pointer-events-none" : "pointer-events-auto",
      )}
      style={{ transform: `translate(${props.x.toFixed(1)}px, ${props.y.toFixed(1)}px)` }}
      onClick={(evento) => props.onClick?.(evento)}
    >
      <Deslizable forma="agrupacion" movimiento={props.movimiento ?? QUIETO}>
        <span class="flex flex-col items-center gap-0.5 text-center">
          <span
            class={cn(
              "relative grid h-14 w-[50px] place-items-center drop-shadow-marcador transition-transform duration-150 ease-out group-hover:scale-110 group-active:scale-95 motion-reduce:transition-none",
              props.carga === "cargando" && "animate-pulse motion-reduce:animate-none",
            )}
          >
            <svg viewBox="0 0 50 56" aria-hidden="true" class="absolute inset-0 size-full">
              <polygon
                points="25,2 48,15 48,41 25,54 2,41 2,15"
                class={variantesHexagono({ cobertura: props.cobertura })}
              />
              <polygon
                points="25,7 43.5,17.5 43.5,38.5 25,49 6.5,38.5 6.5,17.5"
                stroke-width="1.4"
                class={variantesBorde({ cobertura: props.cobertura })}
              />
            </svg>
            <Show when={conNumero()}>
              <span
                aria-hidden="true"
                class={variantesNumero({ cifras: cifras(props.emplazamientos) })}
              >
                {props.emplazamientos}
              </span>
            </Show>
          </span>
          <Show when={props.forma === "completa"}>
            <span class="halo truncate font-titulo text-xs leading-4 tracking-[0.08em] text-tinta uppercase group-hover:text-primario-texto">
              {props.provincia}
            </span>
            <Switch>
              <Match when={estado() !== ""}>
                <span class="halo font-mono text-[11px] leading-4 text-tinta-suave">
                  {estado()}
                </span>
              </Match>
              <Match when={props.ausentes.length > 0}>
                <span class="mt-1">
                  <Ausencias companias={props.ausentes} />
                </span>
              </Match>
            </Switch>
          </Show>
        </span>
      </Deslizable>
    </button>
  );
}
