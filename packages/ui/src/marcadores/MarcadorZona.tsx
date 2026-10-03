import type { JSX } from "@solidjs/web";
import { cva } from "class-variance-authority";
import { Show } from "solid-js";

import { variantesDiana } from "../Boton.tsx";
import { cn } from "../cn.ts";
import { Deslizable, type Movimiento } from "./Deslizable.tsx";

/** Qué zona es: se ven igual, pero las pruebas y el DOM las distinguen (`data-zona`). */
export type TipoDeZona = "provincia" | "municipio" | "barrio";

/**
 * - `completa`: el hexágono con el número y el nombre debajo.
 * - `compacta`: solo el hexágono. Es para cuando la completa pisaría otra zona o un marcador.
 */
export type FormaDeZona = "completa" | "compacta";

/**
 * Cuánto sabe Celda de una provincia (ADR 0016). Los municipios y los barrios van siempre
 * `entera`.
 *
 * - `entera`: una zona de barrido la cubre de punta a punta; su número es el de la provincia.
 * - `parcial`: solo se ha barrido una parte; su número es el de esa parte.
 * - `ninguna`: no se ha barrido nada; no tiene número.
 */
export type CoberturaDeProvincia = "entera" | "parcial" | "ninguna";

/** Si la capa de una provincia se está pidiendo o no ha llegado. Sin él, se ve solo el resumen. */
export type CargaDelMarcador = "resumen" | "cargando" | "fallo";

/** «17 emplazamientos», «1 emplazamiento», «ningún emplazamiento». */
export const textoDeEmplazamientos = (cuantos: number): string =>
  cuantos === 0
    ? "ningún emplazamiento"
    : cuantos === 1
      ? "1 emplazamiento"
      : `${cuantos} emplazamientos`;

/** Lo que se dice bajo el nombre de una provincia, según lo que se sabe de ella y su carga. */
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

/**
 * El hexágono, como el de las agrupaciones. Claro si la zona no tiene nada que contar: una
 * provincia sin barrer o un barrio sin emplazamientos.
 */
const variantesHexagono = cva("transition-[fill] duration-150", {
  variants: {
    relleno: {
      oscuro: "fill-superficie-invertida group-hover:fill-primario-activo",
      claro: "fill-superficie group-hover:fill-superficie-alta",
    },
  },
});

const variantesBorde = cva("fill-none", {
  variants: {
    borde: {
      continuo: "stroke-primario",
      // Discontinuo: lo que cuenta es solo una parte de la provincia.
      parcial: "stroke-primario [stroke-dasharray:4_3]",
      // Una zona que se sabe vacía.
      vacio: "stroke-tinta-suave",
      // Una provincia de la que aún no se sabe nada.
      desconocido: "stroke-tinta-suave [stroke-dasharray:4_3]",
    },
  },
});

const variantesNumero = cva("relative font-mono font-semibold", {
  variants: {
    cifras: {
      pocas: "text-base",
      muchas: "text-xs",
      demasiadas: "text-[10px]",
    },
    relleno: {
      oscuro: "text-tinta-invertida",
      claro: "text-tinta",
    },
  },
});

const cifras = (cuantos: number) =>
  cuantos >= 10_000 ? "demasiadas" : cuantos >= 1000 ? "muchas" : "pocas";

/** Una caja respecto al centro del hexágono, en píxeles. */
export interface CajaDeZona {
  readonly izquierda: number;
  readonly arriba: number;
  readonly derecha: number;
  readonly abajo: number;
}

/** El hexágono: 50 × 56 px, centrado en el punto de la zona. */
const HEXAGONO: CajaDeZona = { izquierda: -25, arriba: -28, derecha: 25, abajo: 28 };
/** Ancho máximo del nombre: `max-w-38`. */
const ANCHO_NOMBRE = 152;
/** Lo que ocupa de media una letra del nombre con `text-xs` y `tracking-wider` en monoespaciada. */
const LETRA = 7.8;
/** Relleno de la cinta del nombre a los dos lados: `pl-2.5` y `pr-2.5`. */
const RELLENO_NOMBRE = 20;
/** Alto de una línea del nombre, `leading-4`, y el relleno de arriba y abajo de la cinta. */
const LINEA = 16;
const RELLENO_VERTICAL = 4;
/** Separación entre el hexágono y lo que va debajo. */
const HUECO = 2;

/**
 * Lo que ocupa una zona en la pantalla respecto al centro de su hexágono, para decidir si cabe
 * entera sin pisar otra. Es una estimación por arriba con las clases de este fichero: el hexágono,
 * el nombre en una o dos líneas debajo y lo que se sabe de una provincia.
 */
export const cajaDeZona = (forma: FormaDeZona, nombre: string, conEstado = false): CajaDeZona => {
  if (forma === "compacta") return HEXAGONO;
  const largo = nombre.length * LETRA + RELLENO_NOMBRE;
  const lineas = largo > ANCHO_NOMBRE ? 2 : 1;
  const ancho = Math.min(ANCHO_NOMBRE, largo);
  const alto = lineas * LINEA + RELLENO_VERTICAL + (conEstado ? LINEA : 0);
  return {
    izquierda: Math.min(HEXAGONO.izquierda, -ancho / 2),
    arriba: HEXAGONO.arriba,
    derecha: Math.max(HEXAGONO.derecha, ancho / 2),
    abajo: HEXAGONO.abajo + HUECO + alto,
  };
};

export interface MarcadorZonaProps {
  /** Posición del centro del hexágono en la pantalla, en píxeles desde la esquina del mapa. */
  readonly x: number;
  readonly y: number;
  readonly zona: TipoDeZona;
  readonly forma: FormaDeZona;
  /** El nombre de la zona, que se ve debajo del hexágono. */
  readonly nombreDeZona: string;
  /** Cuántos emplazamientos tiene. Una provincia sin cubrir no lo enseña. */
  readonly emplazamientos: number;
  /** Solo en una provincia; el resto va siempre `entera`. */
  readonly cobertura?: CoberturaDeProvincia;
  /** Solo en una provincia: si su capa se está pidiendo o no ha llegado. */
  readonly carga?: CargaDelMarcador;
  /** Nombre accesible: la zona, su número y qué hace al pulsarla. */
  readonly nombre: string;
  /** Cómo aparece o se va al cambiar de nivel. Sin él, aparece sin transición. */
  readonly movimiento?: Movimiento;
  readonly onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
}

const QUIETO: Movimiento = { tipo: "quieto" };

/**
 * Una zona en el mapa (una provincia, un municipio o un barrio): el mismo hexágono oscuro con su
 * número que las agrupaciones, para que al cambiar de nivel un hexágono se deslice a otro y nunca
 * queden solo letras. En la forma completa lleva debajo el nombre en una cinta, con la letra de
 * las etiquetas (monoespaciada), que no se confunde con los rótulos del mapa base. No dice qué
 * compañías faltan: que una no tenga emplazamientos en la zona no quiere decir que no dé servicio
 * en ella (ADR 0024). Una provincia a medias lleva el borde discontinuo y lo dice; una sin cubrir y un
 * barrio vacío van en claro. Es un botón del tamaño del hexágono que acerca el mapa a la zona.
 */
export function MarcadorZona(props: MarcadorZonaProps) {
  const saliendo = () => props.movimiento?.tipo === "sale";
  const cobertura = () => props.cobertura ?? "entera";
  const carga = () => props.carga ?? "resumen";
  const conNumero = () => cobertura() !== "ninguna";
  const relleno = () => (conNumero() && props.emplazamientos > 0 ? "oscuro" : "claro");
  const borde = () =>
    cobertura() === "parcial"
      ? "parcial"
      : cobertura() === "ninguna"
        ? "desconocido"
        : relleno() === "claro"
          ? "vacio"
          : "continuo";
  const estado = () => textoDeProvincia(cobertura(), carga());
  const completa = () => props.forma === "completa";
  return (
    <button
      type="button"
      aria-label={props.nombre}
      aria-busy={carga() === "cargando" ? "true" : undefined}
      inert={saliendo()}
      data-zona={props.zona}
      data-forma={props.forma}
      data-cobertura={props.zona === "provincia" ? cobertura() : undefined}
      data-carga={props.zona === "provincia" ? carga() : undefined}
      class={cn(
        variantesDiana(),
        "absolute top-0 left-0 z-10 -mt-7 -ml-[25px] w-[50px] cursor-zoom-in will-change-transform",
        saliendo() ? "pointer-events-none" : "pointer-events-auto",
      )}
      style={{ transform: `translate(${props.x.toFixed(1)}px, ${props.y.toFixed(1)}px)` }}
      onClick={(evento) => props.onClick?.(evento)}
    >
      <Deslizable forma="agrupacion" movimiento={props.movimiento ?? QUIETO}>
        <span class="relative block">
          <span
            class={cn(
              "relative grid h-14 w-[50px] place-items-center drop-shadow-marcador transition-transform duration-150 ease-out group-hover:scale-110 group-active:scale-95 motion-reduce:transition-none",
              carga() === "cargando" && "animate-pulse motion-reduce:animate-none",
            )}
          >
            <svg viewBox="0 0 50 56" aria-hidden="true" class="absolute inset-0 size-full">
              <polygon
                data-hexagono=""
                points="25,2 48,15 48,41 25,54 2,41 2,15"
                class={variantesHexagono({ relleno: relleno() })}
              />
              <polygon
                points="25,7 43.5,17.5 43.5,38.5 25,49 6.5,38.5 6.5,17.5"
                stroke-width="1.4"
                class={variantesBorde({ borde: borde() })}
              />
            </svg>
            <Show when={conNumero()}>
              <span
                aria-hidden="true"
                class={variantesNumero({
                  cifras: cifras(props.emplazamientos),
                  relleno: relleno(),
                })}
              >
                {/* Como texto: Solid no pinta un 0 suelto. */}
                {String(props.emplazamientos)}
              </span>
            </Show>
          </span>
          <Show when={completa()}>
            <span
              aria-hidden="true"
              class="absolute top-full left-1/2 mt-0.5 flex w-max max-w-38 -translate-x-1/2 flex-col items-center drop-shadow-marcador"
            >
              <span class="cinta line-clamp-2 bg-superficie-alta px-2.5 py-0.5 text-center font-mono text-xs leading-4 font-semibold tracking-wider text-tinta [--pico:6px] group-hover:text-primario-texto">
                {props.nombreDeZona}
              </span>
              <Show when={estado() !== ""}>
                <span class="halo font-mono text-[11px] leading-4 text-tinta-suave">
                  {estado()}
                </span>
              </Show>
            </span>
          </Show>
        </span>
      </Deslizable>
    </button>
  );
}
