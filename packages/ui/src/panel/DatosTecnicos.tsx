import type { Compania } from "@celda/dominio/compania";
import type { Termino as CualTermino } from "@celda/dominio/glosario";
import type { JSX } from "@solidjs/web";
import { createMemo, For, Show } from "solid-js";

import { LogoCompanias } from "../marcadores/LogoCompanias.tsx";
import { Termino } from "../termino/Termino.tsx";

/** Un expediente tal como lo publica la fuente, ya escrito. */
export interface ExpedienteTecnico {
  /** Referencia del expediente, como «B B -2300445». */
  readonly referencia: string;
  /** Tramo publicado, exacto: «778–788 MHz». */
  readonly tramo: string;
  /** Banda nominal deducida del tramo: «700 MHz». */
  readonly banda: string;
  /** Tecnología deducida de la banda. */
  readonly tecnologia: string;
}

/** De dónde sale una estación base: la fuente, su clave y su fecha, ya escritas. */
export interface OrigenTecnico {
  readonly fuente: string;
  readonly clave: string;
  readonly fecha: string;
}

export interface EstacionTecnica {
  readonly compania: Compania;
  readonly nombre: string;
  readonly codigos: string;
  readonly expedientes: ReadonlyArray<ExpedienteTecnico>;
  /** Qué decir si no se conoce ningún expediente. */
  readonly sinExpedientes: string;
  readonly origenes: ReadonlyArray<OrigenTecnico>;
}

export interface DatosTecnicosProps {
  readonly estaciones: ReadonlyArray<EstacionTecnica>;
  /** Qué no publica ninguna fuente y qué es deducción. Puede llevar términos. */
  readonly nota: JSX.Element;
}

const CELDA = "py-1 pr-2 align-top";

/** Las columnas de cada tabla de expedientes, con el término que explica cada una. */
const COLUMNAS: ReadonlyArray<{ readonly texto: string; readonly termino: CualTermino }> = [
  { texto: "Expediente", termino: "expediente" },
  { texto: "Tramo publicado", termino: "tramo" },
  { texto: "Banda", termino: "banda" },
  { texto: "Tecnología probable", termino: "tecnologia" },
];

/**
 * Los datos técnicos de la ficha (historia 19), para quien quiera comprobarlos: cada expediente
 * con su tramo exacto, y de dónde sale cada estación base. Va dentro de un `Desplegable`.
 */
export function DatosTecnicos(props: DatosTecnicosProps) {
  /** Los términos de las columnas se subrayan una vez, en la primera tabla. */
  const primeraTabla = createMemo(() =>
    props.estaciones.findIndex((estacion) => estacion.expedientes.length > 0),
  );
  return (
    <div class="flex flex-col gap-4">
      <For each={props.estaciones}>
        {(estacion, indice) => (
          <section class="flex flex-col gap-1.5">
            <div class="flex items-center gap-2">
              <LogoCompanias companias={[estacion.compania]} tamano={20} />
              <h4 class="text-sm font-semibold">{estacion.nombre}</h4>
              <span class="ml-auto font-mono text-[11px] text-tinta-suave">{estacion.codigos}</span>
            </div>
            <Show
              when={estacion.expedientes.length > 0}
              fallback={<p class="text-sm text-tinta-suave">{estacion.sinExpedientes}</p>}
            >
              <table class="w-full border-collapse font-mono text-[11px] leading-4">
                <caption class="sr-only">{`Expedientes de ${estacion.nombre}`}</caption>
                <thead class="text-left text-tinta-suave">
                  <tr>
                    <For each={COLUMNAS}>
                      {(columna, i) => (
                        <th
                          scope="col"
                          class={
                            i() === COLUMNAS.length - 1
                              ? "py-1 align-top font-normal"
                              : `${CELDA} font-normal`
                          }
                        >
                          {indice() === primeraTabla() ? (
                            <Termino termino={columna.termino}>{columna.texto}</Termino>
                          ) : (
                            columna.texto
                          )}
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={estacion.expedientes}>
                    {(expediente) => (
                      <tr class="border-t border-linea">
                        <td class={`${CELDA} whitespace-nowrap`}>{expediente.referencia}</td>
                        <td class={CELDA}>{expediente.tramo}</td>
                        <td class={`${CELDA} font-semibold whitespace-nowrap`}>
                          {expediente.banda}
                        </td>
                        <td class="py-1 align-top">{expediente.tecnologia}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
            <ul class="flex flex-col gap-0.5 font-mono text-[11px] leading-4 text-tinta-suave">
              <For each={estacion.origenes}>
                {(origen) => (
                  <li>
                    <span class="font-semibold text-tinta">{origen.fuente}</span>
                    {` · ${origen.clave} · ${origen.fecha}`}
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
      <p class="text-sm leading-relaxed text-tinta-suave">{props.nota}</p>
    </div>
  );
}
