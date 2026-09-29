import { For } from "solid-js";

import { CAJA_MARCA, MARCA, type Tono, trayecto } from "./marca/geometria.ts";

/** El color de cada tono de la marca en la cabecera, que va sobre la superficie clara. */
const RELLENO: Readonly<Record<Tono, string>> = {
  tinta: "fill-tinta",
  acento: "fill-primario",
  claro: "fill-superficie",
};

/** La marca de Celda, la misma figura que el favicon (`marca/geometria.ts`). */
export function MarcaCelda() {
  return (
    <svg
      width="30"
      height="30"
      viewBox={`0 0 ${CAJA_MARCA} ${CAJA_MARCA}`}
      aria-hidden="true"
      class="shrink-0 md:size-8"
    >
      <For each={MARCA}>
        {(pieza) => (
          <path fill-rule="evenodd" d={trayecto(pieza.contornos)} class={RELLENO[pieza.tono]} />
        )}
      </For>
    </svg>
  );
}

export interface CabeceraProps {
  /** El sitio que enseña el mapa: «España», una provincia o un municipio. */
  readonly lugar: string;
}

/**
 * La cinta de arriba del mapa con la marca, el nombre y el lugar. No tapa los gestos del mapa. El
 * lugar tiene un ancho fijo y va en una sola línea, cortado con puntos suspensivos si no cabe: al
 * mover el mapa cambia de nombre, pero ni la cinta ni la marca se mueven.
 */
export function Cabecera(props: CabeceraProps) {
  return (
    <header class="cinta pointer-events-none flex items-center gap-3.5 bg-superficie py-1.5 pr-4 pl-2.5 [--pico:14px] md:py-2 md:pr-[22px] md:pl-3">
      <MarcaCelda />
      <h1 class="font-mono text-[13px] font-semibold tracking-[0.3em] text-primario-texto">
        CELDA
      </h1>
      <p
        data-lugar
        class="w-48 truncate font-titulo text-base tracking-[0.08em] text-tinta md:w-64 md:text-xl"
      >
        {props.lugar}
      </p>
    </header>
  );
}
