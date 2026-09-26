import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { Etiqueta } from "../Etiqueta.tsx";

/**
 * El sector que da servicio en la ficha, bajo «Desde: …», como el prototipo v8: tres casillas
 * (qué sector, cuánto se pierde respecto a su eje y la distancia con el rumbo), la frase que lo
 * explica y la marca de modelo con lo que se ha supuesto.
 */

/** Una casilla: el valor en grande y qué es debajo. */
export interface DatoServicio {
  readonly valor: string;
  readonly etiqueta: string;
}

export interface LecturaServicioProps {
  /** Tres casillas, o ninguna mientras se calculan: su sitio queda reservado. */
  readonly datos: ReadonlyArray<DatoServicio> | undefined;
  /** La frase que dice qué quiere decir. Puede llevar términos. */
  readonly veredicto: JSX.Element | undefined;
  /** Qué modelo es y su versión, como «sector-servicio v1». */
  readonly modelo: string;
  /** De dónde sale la orientación. Puede llevar términos. */
  readonly nota: JSX.Element;
}

const CASILLA =
  "chaflan flex min-h-[4.25rem] flex-col items-center justify-center gap-0.5 bg-superficie px-1.5 py-2 text-center [--corte:8px]";

/** El sector que da servicio al punto de referencia (historia 30). */
export function LecturaServicio(props: LecturaServicioProps) {
  return (
    <div class="flex flex-col gap-2">
      <Show
        when={props.datos}
        fallback={
          <div aria-busy="true" class="grid grid-cols-3 gap-1.5">
            <For each={[0, 1, 2]}>
              {() => (
                <span class={CASILLA}>
                  <span class="animate-aparecer font-mono text-[10px] text-tinta-suave">
                    Calculando…
                  </span>
                </span>
              )}
            </For>
          </div>
        }
      >
        {(datos) => (
          <dl class="grid grid-cols-3 gap-1.5">
            <For each={datos()}>
              {(dato) => (
                <div class={CASILLA}>
                  <dt class="font-mono text-[10px] leading-3 tracking-wider text-tinta-suave uppercase">
                    {dato.etiqueta}
                  </dt>
                  <dd class="order-first font-titulo text-lg leading-6 font-semibold tabular-nums">
                    {dato.valor}
                  </dd>
                </div>
              )}
            </For>
          </dl>
        )}
      </Show>
      <p class="min-h-10 text-sm leading-relaxed">{props.veredicto}</p>
      <div class="flex flex-col gap-1">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Etiqueta tono="modelo">Modelo</Etiqueta>
          <span class="font-mono text-[11px] text-tinta-suave">{props.modelo}</span>
        </div>
        <p class="text-xs leading-snug text-tinta-suave">{props.nota}</p>
      </div>
    </div>
  );
}
