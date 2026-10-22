import type { Compania } from "@celda/dominio/compania";
import { cva } from "class-variance-authority";
import { For, Show } from "solid-js";

import { LogoCompanias } from "../marcadores/LogoCompanias.tsx";

/** Una compañía en el eje: las bandas en las que emite, en MHz. */
export interface FilaEje {
  readonly compania: Compania;
  readonly nombre: string;
  readonly bandas: ReadonlyArray<number>;
  /** Qué decir en lugar de las casillas cuando no se conoce ninguna banda. */
  readonly nota?: string | undefined;
}

export interface EjeFrecuenciasProps {
  /** Nombre accesible de la tabla. */
  readonly titulo: string;
  /** Las columnas, de la banda más baja a la más alta, en MHz. */
  readonly bandas: ReadonlyArray<number>;
  readonly filas: ReadonlyArray<FilaEje>;
}

/**
 * Donde emite, el hexágono toma el color de la barra bajo su columna (`--en-el-eje`), así que la
 * barra es su leyenda. La mezcla es en OKLab, como el degradado.
 */
const variantesCasilla = cva("hexagono inline-block h-[22px] w-5 align-middle", {
  variants: {
    emite: {
      true: "bg-[color-mix(in_oklab,var(--primario)_var(--en-el-eje),var(--eje-lejos))]",
      false: "bg-linea",
    },
  },
  defaultVariants: { emite: false },
});

/** El centro de la columna `indice` de `total`, en tanto por ciento del ancho de la barra. */
const enElEje = (indice: number, total: number) => `${(((indice + 0.5) / total) * 100).toFixed(1)}%`;

/** Una flecha de la leyenda, en la tinta del texto. */
function Flecha(props: { readonly hacia: "izquierda" | "derecha" }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="10"
      viewBox="0 0 16 10"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="shrink-0 text-tinta"
    >
      <path d={props.hacia === "izquierda" ? "M15 5H1.5M5.5 1 1.5 5l4 4" : "M1 5h13.5M10.5 1l4 4-4 4"} />
    </svg>
  );
}

/**
 * Qué frecuencia usa cada compañía (historia 14): una fila por compañía, una columna por banda y
 * un hexágono relleno donde emite. Debajo, una barra dice que las bandas de la izquierda llegan
 * más lejos y las de la derecha dan más velocidad, y da su color a los hexágonos.
 */
export function EjeFrecuencias(props: EjeFrecuenciasProps) {
  return (
    <table class="w-full border-collapse">
      <caption class="sr-only">{props.titulo}</caption>
      <thead>
        <tr>
          <th scope="col" class="w-px pr-2.5">
            <span class="sr-only">Compañía</span>
          </th>
          <For each={props.bandas}>
            {(banda) => (
              <th
                scope="col"
                class="pb-1 text-center font-mono text-[11px] font-semibold text-tinta-suave"
              >
                {banda}
                <span class="sr-only"> MHz</span>
              </th>
            )}
          </For>
        </tr>
      </thead>
      <tbody>
        <For each={props.filas}>
          {(fila) => (
            <tr data-compania={fila.compania}>
              <th scope="row" class="w-px py-1 pr-2.5 text-left text-sm font-semibold">
                <span class="flex items-center gap-2 whitespace-nowrap">
                  <LogoCompanias companias={[fila.compania]} tamano={22} />
                  {fila.nombre}
                </span>
              </th>
              <Show
                when={fila.nota}
                fallback={
                  <For each={props.bandas}>
                    {(banda, indice) => (
                      <td class="py-1 text-center">
                        <span
                          aria-hidden="true"
                          data-emite={fila.bandas.includes(banda) ? "si" : "no"}
                          class={variantesCasilla({ emite: fila.bandas.includes(banda) })}
                          style={{ "--en-el-eje": enElEje(indice(), props.bandas.length) }}
                        />
                        <span class="sr-only">{fila.bandas.includes(banda) ? "Sí" : "No"}</span>
                      </td>
                    )}
                  </For>
                }
              >
                {(nota) => (
                  <td colspan={props.bandas.length} class="py-1 text-xs text-tinta-suave">
                    {nota()}
                  </td>
                )}
              </Show>
            </tr>
          )}
        </For>
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" class="pt-2 text-left">
            <span class="sr-only">Escala</span>
          </th>
          <td colspan={props.bandas.length} class="pt-2">
            <span
              aria-hidden="true"
              class="block h-1.5 bg-linear-to-r from-eje-lejos to-primario"
            />
            <span class="float-left mt-1.5 flex items-center gap-1.5 font-mono text-[10.5px] text-tinta-suave">
              <Flecha hacia="izquierda" />
              Llega más lejos
            </span>
            <span class="float-right mt-1.5 flex items-center gap-1.5 font-mono text-[10.5px] text-tinta-suave">
              Más velocidad
              <Flecha hacia="derecha" />
            </span>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
