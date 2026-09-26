import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId } from "solid-js";

export interface DesplegableProps {
  /** Etiqueta visible del botón, que es también su nombre accesible. */
  readonly titulo: string;
  readonly children: JSX.Element;
}

/**
 * Un bloque plegado que se abre con un botón: con el dedo, con Intro o con Espacio. Empieza
 * cerrado. El contenido está en el DOM pero oculto, así que el botón apunta a él con
 * `aria-controls` y abrirlo no lo vuelve a construir.
 */
export function Desplegable(props: DesplegableProps) {
  const [abierto, setAbierto] = createSignal(false);
  const id = createUniqueId();
  return (
    <div class="border-t border-linea">
      <button
        type="button"
        aria-expanded={abierto() ? "true" : "false"}
        aria-controls={id}
        onClick={() => setAbierto((antes) => !antes)}
        class="group flex min-h-12 w-full items-center gap-2.5 px-5 text-left font-mono text-[11px] font-semibold tracking-[0.14em] text-primario-texto uppercase hover:bg-superficie-alta hover:text-tinta active:bg-linea md:px-6"
      >
        <span
          aria-hidden="true"
          class="inline-block text-sm leading-none transition-transform group-aria-expanded:rotate-90 motion-reduce:transition-none"
        >
          ▸
        </span>
        {props.titulo}
      </button>
      <div id={id} hidden={!abierto()} class="px-5 pb-5 md:px-6">
        {props.children}
      </div>
    </div>
  );
}
