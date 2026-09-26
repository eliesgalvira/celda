import type { Compania } from "@celda/dominio/compania";
import type { JSX } from "@solidjs/web";
import { createUniqueId, For, Show } from "solid-js";

import { LogoCompanias } from "../marcadores/LogoCompanias.tsx";

/**
 * Piezas del ejercicio de emplazamientos del modo estudiante: la cadena del cálculo, paso a paso
 * y con la fuente de cada eslabón, y la tabla final con la fuente y la fecha de cada fila.
 */

export interface PasoDeCadena {
  /** Lo que se hace con el anterior para llegar a este, como «× 128,3 líneas por cada 100». */
  readonly operacion?: string;
  readonly etiqueta: JSX.Element;
  readonly valor: string;
  /** De dónde sale, en pocas palabras. */
  readonly fuente: string;
}

/** Una cadena de cálculo de arriba abajo: cada eslabón con su valor y su fuente a la vista. */
export function CadenaDelCalculo(props: { readonly pasos: ReadonlyArray<PasoDeCadena> }) {
  return (
    <ol class="flex flex-col">
      <For each={props.pasos}>
        {(paso) => (
          <li class="flex flex-col">
            <Show when={paso.operacion}>
              {(operacion) => (
                <p class="py-1 pl-4 font-mono text-xs text-primario-texto">{operacion()}</p>
              )}
            </Show>
            <div class="grid grid-cols-[1fr_auto] items-baseline gap-x-3 bg-superficie-alta px-3 py-2 shadow-[inset_3px_0_0_var(--primario)]">
              <span class="font-semibold">{paso.etiqueta}</span>
              <span class="font-mono text-base font-semibold whitespace-nowrap">{paso.valor}</span>
              <span class="col-span-2 text-xs text-tinta-suave">{paso.fuente}</span>
            </div>
          </li>
        )}
      </For>
    </ol>
  );
}

/** Cómo se marca un valor de la tabla que no es un número. */
export type MarcaDeValor = "si" | "no" | "probable" | "posible" | "sin-datos";

export interface ValorDeTabla {
  readonly texto: string;
  readonly marca?: MarcaDeValor;
}

export interface FilaDeTabla {
  readonly magnitud: string;
  readonly unidad?: string;
  /** Un valor por columna, o uno solo que ocupa todas. */
  readonly valores: ReadonlyArray<ValorDeTabla>;
  readonly fuente: string;
  /** Fecha del dato, ya escrita. */
  readonly fecha: string;
}

export interface SeccionDeTabla {
  readonly titulo: string;
  readonly filas: ReadonlyArray<FilaDeTabla>;
}

export interface TablaDelEjercicioProps {
  /** El título de la tabla, que es también su nombre accesible. */
  readonly titulo: string;
  readonly columnas: ReadonlyArray<{ readonly compania: Compania; readonly nombre: string }>;
  readonly secciones: ReadonlyArray<SeccionDeTabla>;
}

const MARCA_CLASE: Readonly<Record<MarcaDeValor | "ninguna", string>> = {
  ninguna: "",
  si: "font-semibold text-tinta",
  probable: "font-semibold text-tinta",
  posible: "text-tinta",
  no: "text-tinta-suave",
  "sin-datos": "text-tinta-suave italic",
};

/**
 * La tabla del ejercicio: una fila por magnitud, una columna por compañía y, al final, de dónde
 * sale y de qué fecha es cada fila. La fuente se ve siempre en su columna y también al pasar el
 * cursor por cada valor. En pantallas estrechas la tabla se desplaza de lado dentro de su marco;
 * los navegadores actuales dejan recorrerlo con el teclado.
 */
export function TablaDelEjercicio(props: TablaDelEjercicioProps) {
  const id = createUniqueId();
  return (
    <section
      aria-labelledby={id}
      class="overflow-x-auto overscroll-x-contain shadow-[inset_0_0_0_1px_var(--linea)] focus-visible:outline-3 focus-visible:outline-foco"
    >
      <table class="w-full min-w-[40rem] border-collapse text-left text-sm">
        <caption id={id} class="sr-only">
          {props.titulo}
        </caption>
        <thead>
          <tr class="border-b border-linea-fuerte bg-superficie-alta">
            <th scope="col" class="px-3 py-2 font-mono text-xs font-semibold text-tinta-suave">
              Magnitud
            </th>
            <For each={props.columnas}>
              {(columna) => (
                <th scope="col" class="px-2 py-2 text-center font-mono text-xs font-semibold">
                  <span class="inline-flex flex-col items-center gap-1">
                    <LogoCompanias companias={[columna.compania]} tamano={22} />
                    {columna.nombre}
                  </span>
                </th>
              )}
            </For>
            <th scope="col" class="px-3 py-2 font-mono text-xs font-semibold text-tinta-suave">
              Fuente y fecha
            </th>
          </tr>
        </thead>
        <For each={props.secciones}>
          {(seccion) => (
            <tbody>
              <tr class="bg-superficie-invertida text-tinta-invertida">
                <th
                  scope="colgroup"
                  colspan={props.columnas.length + 2}
                  class="px-3 py-1 font-mono text-[11px] font-semibold tracking-[0.14em] uppercase"
                >
                  {seccion.titulo}
                </th>
              </tr>
              <For each={seccion.filas}>
                {(fila) => (
                  <tr class="border-b border-linea align-top">
                    <th scope="row" class="px-3 py-2 font-semibold">
                      {fila.magnitud}
                      <Show when={fila.unidad}>
                        {(unidad) => (
                          <span class="block font-mono text-[11px] font-normal text-tinta-suave">
                            {unidad()}
                          </span>
                        )}
                      </Show>
                    </th>
                    <For each={fila.valores} keyed={false}>
                      {(valor) => (
                        <td
                          colspan={fila.valores.length === 1 ? props.columnas.length : undefined}
                          title={`${fila.fuente} (${fila.fecha})`}
                          data-marca={valor().marca}
                          class={
                            (fila.valores.length === 1 ? "px-2 py-2 " : "px-2 py-2 text-center ") +
                            "font-mono whitespace-nowrap " +
                            MARCA_CLASE[valor().marca ?? "ninguna"]
                          }
                        >
                          {valor().texto}
                        </td>
                      )}
                    </For>
                    <td class="min-w-48 px-3 py-2 text-xs leading-snug text-tinta-suave">
                      {fila.fuente}
                      <span class="block font-mono">{fila.fecha}</span>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          )}
        </For>
      </table>
    </section>
  );
}

/**
 * El cuerpo del ejercicio mientras llegan los habitantes: el sitio de cada sección reservado. Lo
 * que dura poco no se ve.
 */
export function EsqueletoEjercicio() {
  return (
    <div aria-busy="true" class="flex flex-col gap-3 px-5 py-4 md:px-6">
      <output class="block animate-aparecer text-sm text-tinta-suave">
        Cargando los habitantes por barrio…
      </output>
      <span aria-hidden="true" class="block h-11 bg-linea" />
      <span aria-hidden="true" class="block h-40 bg-linea" />
      <span aria-hidden="true" class="block h-40 bg-linea" />
    </div>
  );
}

/** Una fila de botones o de avisos al final de una sección. */
export function AccionesEjercicio(props: { readonly children: JSX.Element }) {
  return <div class="flex flex-wrap items-center gap-2">{props.children}</div>;
}

/** Los campos de los parámetros, en dos columnas desde que caben. */
export function RejillaDeCampos(props: { readonly children: JSX.Element }) {
  return <div class="grid grid-cols-2 gap-x-4 gap-y-3">{props.children}</div>;
}

/** Un párrafo del ejercicio. */
export function TextoEjercicio(props: { readonly children: JSX.Element }) {
  return <p class="text-sm leading-relaxed">{props.children}</p>;
}

/** Tres líneas de tabla con un lápiz: el icono del ejercicio en los controles del mapa. */
export function IconoEjercicio() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M2 4h11M2 10h8M2 16h5" />
      <path d="M11 17l1-3 6-6 2 2-6 6z" stroke-width="1.6" stroke-linejoin="round" />
    </svg>
  );
}

/** Tres deslizadores: el icono de los ajustes en los controles del mapa. */
export function IconoAjustes() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M2 4h16M2 10h16M2 16h16" />
      <path d="M6 1.5v5M13 7.5v5M8 13.5v5" stroke-width="2.4" />
    </svg>
  );
}
