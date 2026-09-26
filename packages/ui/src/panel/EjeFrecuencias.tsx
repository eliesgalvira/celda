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

export const variantesCasilla = cva("hexagono inline-block h-[22px] w-5 align-middle", {
  variants: {
    emite: {
      true: "bg-tinta",
      false: "bg-linea",
    },
  },
  defaultVariants: { emite: false },
});

/**
 * Qué frecuencia usa cada compañía (historia 14): una fila por compañía, una columna por banda y
 * un hexágono relleno donde emite. Debajo, una barra dice que las bandas de la izquierda llegan
 * más lejos y las de la derecha dan más velocidad.
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
                    {(banda) => (
                      <td class="py-1 text-center">
                        <span
                          aria-hidden="true"
                          data-emite={fila.bandas.includes(banda) ? "si" : "no"}
                          class={variantesCasilla({ emite: fila.bandas.includes(banda) })}
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
              class="block h-1.5 bg-linear-to-r from-eje-lejos via-fondo to-primario"
            />
            <span class="float-left mt-1 font-mono text-[10.5px] text-tinta-suave before:mr-1 before:content-['←']">
              Llega más lejos
            </span>
            <span class="float-right mt-1 font-mono text-[10.5px] text-tinta-suave after:ml-1 after:content-['→']">
              Más velocidad
            </span>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
