import type { JSX } from "@solidjs/web";
import { cva } from "class-variance-authority";
import { createUniqueId, For, Show } from "solid-js";

import { Boton } from "../Boton.tsx";
import { cn } from "../cn.ts";
import { CORTES_SINR } from "../mapa/interferencia.ts";

/**
 * Piezas del panel de la vista de interferencia, como en el prototipo v8: la marca de simulación
 * orientativa, la frase clave, la compañía y la banda, la ocupación, la escala de
 * colores y el valor en el punto de referencia.
 */

/** El botón del mapa que enciende la vista: dos ondas. */
export function IconoOndas() {
  return (
    <svg
      width="22"
      height="18"
      viewBox="0 0 22 18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
    >
      <path d="M1 9c2-5 4-5 6 0s4 5 6 0 4-5 6 0" />
      <path d="M1 13c2-5 4-5 6 0s4 5 6 0 4-5 6 0" opacity=".5" />
    </svg>
  );
}

export interface PanelInterferenciaProps {
  readonly titulo: string;
  readonly alCerrar: () => void;
  readonly children: JSX.Element;
}

/**
 * El panel de la vista. En escritorio flota abajo a la derecha, junto a los controles del mapa;
 * en el móvil es una hoja de alto fijo sobre los créditos. `DisposicionMapa` lo coloca.
 */
export function PanelInterferencia(props: PanelInterferenciaProps) {
  const titulo = createUniqueId();
  return (
    <section
      aria-labelledby={titulo}
      class={
        "chaflan flex h-full flex-col gap-2 overflow-y-auto overscroll-contain bg-superficie px-4 pt-2.5 pb-3 " +
        "drop-shadow-panel [--corte:14px]"
      }
    >
      <div class="flex items-start justify-between gap-2">
        <div class="flex min-w-0 flex-col gap-1">
          <p class="font-mono text-[11px] tracking-[0.12em] text-aviso-tinta uppercase">
            Simulación orientativa
          </p>
          {/* En el móvil el título solo se lee con el lector: el botón «Interferencia» ya lo dice. */}
          <h2 id={titulo} class="font-titulo text-xl leading-6 max-md:sr-only">
            {props.titulo}
          </h2>
        </div>
        <Boton variante="secundario" onClick={() => props.alCerrar()}>
          Cerrar
        </Boton>
      </div>
      {props.children}
    </section>
  );
}

/** Un párrafo del panel. `clave` es la frase que hay que leer sí o sí; `nota`, la letra pequeña. */
const variantesTextoVista = cva("leading-snug", {
  variants: {
    tono: {
      clave: "text-sm font-semibold text-tinta",
      normal: "text-sm text-tinta",
      nota: "text-xs text-tinta-suave",
    },
  },
  defaultVariants: { tono: "normal" },
});

export function TextoVista(props: {
  readonly tono?: "clave" | "normal" | "nota";
  readonly children: JSX.Element;
}) {
  return <p class={variantesTextoVista({ tono: props.tono })}>{props.children}</p>;
}

/** Dos controles lado a lado, como la compañía y la banda. */
export function ParDeControles(props: { readonly children: JSX.Element }) {
  return <div class="grid grid-cols-2 gap-2">{props.children}</div>;
}

/** El color de cada tramo de la escala, del peor al mejor. */
export const variantesTramo = cva("", {
  variants: {
    tramo: {
      1: "bg-sinr-1",
      2: "bg-sinr-2",
      3: "bg-sinr-3",
      4: "bg-sinr-4",
      5: "bg-sinr-5",
      6: "bg-sinr-6",
    },
  },
});

export type Tramo = 1 | 2 | 3 | 4 | 5 | 6;

const TRAMOS: ReadonlyArray<Tramo> = [1, 2, 3, 4, 5, 6];

/** El tramo de la escala en que cae un valor en dB: uno más que los cortes que supera. */
export const tramoDe = (db: number): Tramo =>
  TRAMOS[CORTES_SINR.filter((corte) => db >= corte).length] ?? 1;

/** Dónde va cada corte bajo la barra: en el borde entre dos tramos. */
const POSICION_CORTE = ["left-1/6", "left-2/6", "left-3/6", "left-4/6", "left-5/6"] as const;

/**
 * La leyenda: seis tramos del naranja oscuro al verde azulado con los cortes en dB, y qué quiere
 * decir cada extremo.
 */
export function EscalaSinr(props: { readonly peor: string; readonly mejor: string }) {
  return (
    <figure class="flex flex-col gap-1">
      <div aria-hidden="true" class="flex h-2.5">
        <For each={TRAMOS}>
          {(tramo) => <span class={variantesTramo({ tramo, class: "flex-1" })} />}
        </For>
      </div>
      <div aria-hidden="true" class="relative h-4 font-mono text-[11px] text-tinta-suave">
        <For each={CORTES_SINR}>
          {(corte, i) => (
            <span class={cn("absolute top-0 -translate-x-1/2", POSICION_CORTE[i()])}>{corte}</span>
          )}
        </For>
      </div>
      <figcaption class="flex justify-between gap-2 font-mono text-[11px] text-tinta-suave">
        <span>{props.peor}</span>
        <span class="sr-only">Escala en dB con cortes en {CORTES_SINR.join(", ")}.</span>
        <span>{props.mejor}</span>
      </figcaption>
    </figure>
  );
}

export interface ValorEnPuntoProps {
  /** Desde dónde: «En el punto» o «En tu ubicación». Puede llevar términos. */
  readonly desde: JSX.Element;
  /** El valor, como «3 dB», o nada si no hay. */
  readonly valor: string | undefined;
  /** La palabra que lo interpreta, como «regular». */
  readonly palabra: string | undefined;
  readonly tramo: Tramo | undefined;
  /** Lo que se lee en el mismo sitio sin valor: cómo tener uno, o que se está calculando. */
  readonly vacio: JSX.Element;
}

/**
 * El valor en el punto de referencia con su palabra (historia 42). Ocupa lo mismo con valor o
 * sin él, así que llegar el valor no mueve nada.
 */
export function ValorEnPunto(props: ValorEnPuntoProps) {
  return (
    <div class="flex min-h-11 items-center gap-2.5 bg-superficie-alta px-3 py-1.5">
      <Show
        when={props.valor !== undefined && props.tramo !== undefined}
        fallback={<p class="text-xs leading-snug text-tinta-suave">{props.vacio}</p>}
      >
        <span
          aria-hidden="true"
          class={variantesTramo({ tramo: props.tramo, class: "hexagono h-5 w-4.5 shrink-0" })}
        />
        <p class="text-sm leading-snug">
          {props.desde}:{" "}
          <strong class="font-mono font-semibold">
            <span class="whitespace-nowrap">{props.valor}</span> · {props.palabra}
          </strong>
        </p>
      </Show>
    </div>
  );
}

/** Cómo va el cálculo, en una línea que siempre ocupa su sitio. */
export function EstadoVista(props: {
  readonly texto: string | undefined;
  readonly accion?: JSX.Element | undefined;
}) {
  return (
    <div class="flex min-h-5 flex-wrap items-center gap-2">
      <Show when={props.texto}>
        {(texto) => (
          <output class="flex animate-aparecer items-center gap-2 font-mono text-xs text-tinta-suave">
            <span aria-hidden="true" class="hexagono size-2.5 bg-primario" />
            {texto()}
          </output>
        )}
      </Show>
      {props.accion}
    </div>
  );
}
