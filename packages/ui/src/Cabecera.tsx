import { For, Match, Switch } from "solid-js";

import { cn } from "./cn.ts";
import { CAJA_MARCA, MARCAS, type Tono, trayecto, type VarianteMarca } from "./marca/geometria.ts";

/** El color de cada tono de la marca en la cabecera, que va sobre la superficie clara. */
const RELLENO: Readonly<Record<Tono, string>> = {
  tinta: "fill-tinta",
  acento: "fill-primario",
  claro: "fill-superficie",
};

/**
 * La marca de Celda. Sin variante, la de hoy: un hexágono dentro de otro. Con una variante del
 * prototipo del logo, la figura sale de `marca/geometria.ts`, la misma que el favicon.
 */
export function MarcaCelda(props: { readonly variante?: VarianteMarca | undefined }) {
  return (
    <Switch>
      <Match when={props.variante === undefined || props.variante === "actual"}>
        <svg
          width="26"
          height="28"
          viewBox="0 0 26 28"
          aria-hidden="true"
          class="shrink-0 text-primario"
        >
          <polygon
            points="13,1 25,7.5 25,20.5 13,27 1,20.5 1,7.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
          />
          <polygon points="13,8 19,11.5 19,16.5 13,20 7,16.5 7,11.5" fill="currentColor" />
        </svg>
      </Match>
      <Match when={props.variante}>
        {(variante) => (
          <svg
            width="30"
            height="30"
            viewBox={`0 0 ${CAJA_MARCA} ${CAJA_MARCA}`}
            aria-hidden="true"
            data-marca={variante()}
            class="shrink-0 md:size-8"
          >
            <For each={MARCAS[variante()].piezas}>
              {(pieza) =>
                pieza.tipo === "poligono" ? (
                  <path
                    fill-rule="evenodd"
                    d={trayecto(pieza.contornos)}
                    class={RELLENO[pieza.tono]}
                  />
                ) : (
                  <circle
                    cx={pieza.centro[0]}
                    cy={pieza.centro[1]}
                    r={pieza.radio}
                    class={RELLENO[pieza.tono]}
                  />
                )
              }
            </For>
          </svg>
        )}
      </Match>
    </Switch>
  );
}

export interface CabeceraProps {
  /** El sitio que enseña el mapa, como «Barcelona» o el nombre de un barrio. */
  readonly lugar: string;
  /** PROTOTIPO: la variante del logo que se prueba. Sin ella, la marca de hoy. */
  readonly marca?: VarianteMarca | undefined;
}

/** La cinta de arriba del mapa con la marca y el lugar. No tapa los gestos del mapa. */
export function Cabecera(props: CabeceraProps) {
  return (
    <header class="cinta pointer-events-none flex items-center gap-3.5 bg-superficie py-1.5 pr-4 pl-2.5 [--pico:14px] md:py-2 md:pr-[22px] md:pl-3">
      <MarcaCelda variante={props.marca} />
      {/* Con una variante del logo, el nombre se ve también en el móvil, junto a la marca. */}
      <h1
        class={cn(
          "font-mono text-[13px] font-semibold tracking-[0.3em] text-primario-texto",
          (props.marca === undefined || props.marca === "actual") && "max-md:sr-only",
        )}
      >
        CELDA
      </h1>
      <p class="font-titulo text-base tracking-[0.08em] text-tinta md:text-xl">{props.lugar}</p>
    </header>
  );
}
