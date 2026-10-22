import type { Compania } from "@celda/dominio/compania";
import { For, Show } from "solid-js";

import { LogoCompanias } from "../marcadores/LogoCompanias.tsx";

/** Una medida de exposición del ministerio, ya escrita. */
export interface FilaDeExposicion {
  /** «55 m». */
  readonly distancia: string;
  /** Hacia dónde queda el punto de medida visto desde la antena: «suroeste». */
  readonly direccion: string;
  /** En µW/cm², sin la unidad, que va en la cabecera: «2,15». */
  readonly valor: string;
  /** Cómo queda frente a las de su zona, si se compara. */
  readonly comparacion:
    | {
        /** La típica de la zona a su distancia, en µW/cm²: «0,202». */
        readonly tipica: string;
        /** «94 de cada 100». */
        readonly masAltaQue: string;
      }
    | undefined;
}

/** Las medidas de exposición de una compañía del emplazamiento, o por qué no las hay. */
export interface EstacionExpuesta {
  readonly compania: Compania;
  readonly nombre: string;
  readonly filas: ReadonlyArray<FilaDeExposicion>;
  /** Qué decir si no tiene ninguna. */
  readonly sinMedidas: string;
}

export interface MedidasDeExposicionProps {
  readonly estaciones: ReadonlyArray<EstacionExpuesta>;
}

const comparada = (estacion: EstacionExpuesta): boolean =>
  estacion.filas.some((fila) => fila.comparacion !== undefined);

const CELDA = "py-1 pr-3 align-top";
const NUMERO = `${CELDA} text-right whitespace-nowrap`;
const CABECERA = "py-1 pr-3 align-bottom font-normal";

/**
 * Las medidas de exposición del ministerio de un emplazamiento, por compañía: una tabla con la
 * distancia, la dirección y el valor de cada medida y, si se comparan con su zona, la típica allí
 * y cuántas de cada 100 quedan por debajo.
 */
export function MedidasDeExposicion(props: MedidasDeExposicionProps) {
  return (
    <div class="flex flex-col gap-3">
      <For each={props.estaciones}>
        {(estacion) => (
          <section class="flex flex-col gap-1.5 border-t border-linea pt-3 first:border-t-0 first:pt-0">
            <div class="flex items-center gap-2">
              <LogoCompanias companias={[estacion.compania]} tamano={20} />
              <p class="text-sm font-semibold">{estacion.nombre}</p>
            </div>
            <Show
              when={estacion.filas.length > 0}
              fallback={
                <p class="text-sm leading-relaxed text-tinta-suave">{estacion.sinMedidas}</p>
              }
            >
              <table class="w-full border-collapse text-sm leading-5 tabular-nums">
                <caption class="sr-only">{`Medidas de exposición de ${estacion.nombre}`}</caption>
                <thead class="text-left font-mono text-[11px] leading-4 text-tinta-suave">
                  <tr>
                    <th scope="col" class={CABECERA}>
                      Distancia
                    </th>
                    <th scope="col" class={CABECERA}>
                      Dirección
                    </th>
                    <th scope="col" class={`${CABECERA} text-right`}>
                      µW/cm²
                    </th>
                    <Show when={comparada(estacion)}>
                      <th scope="col" class={`${CABECERA} text-right`}>
                        Típica
                      </th>
                      <th scope="col" class="py-1 align-bottom font-normal">
                        Más alta que
                      </th>
                    </Show>
                  </tr>
                </thead>
                <tbody>
                  <For each={estacion.filas}>
                    {(fila) => (
                      <tr class="border-t border-linea">
                        <td class={`${CELDA} whitespace-nowrap`}>{fila.distancia}</td>
                        <td class={CELDA}>{fila.direccion}</td>
                        <td class={`${NUMERO} font-semibold`}>{fila.valor}</td>
                        <Show when={comparada(estacion)}>
                          <td class={NUMERO}>{fila.comparacion?.tipica}</td>
                          <td class="py-1 align-top">{fila.comparacion?.masAltaQue}</td>
                        </Show>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </section>
        )}
      </For>
    </div>
  );
}
