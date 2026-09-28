import { createSignal, For, onSettled, Show } from "solid-js";

import { variantesDiana } from "../Boton.tsx";

export interface OpcionPrototipo {
  readonly clave: string;
  readonly nombre: string;
}

export interface FilaPrototipo {
  readonly titulo: string;
  readonly opciones: ReadonlyArray<OpcionPrototipo>;
  readonly actual: string;
  readonly alElegir: (clave: string) => void;
}

export interface BarraDePrototipoProps {
  /** Una fila por cosa que se prueba, como el logo o los controles. */
  readonly filas: ReadonlyArray<FilaPrototipo>;
}

const vecina = (fila: FilaPrototipo, paso: number): string => {
  const indice = fila.opciones.findIndex((opcion) => opcion.clave === fila.actual);
  const total = fila.opciones.length;
  return fila.opciones[(indice + paso + total) % total]?.clave ?? fila.actual;
};

const FLECHA =
  "grid size-9 place-items-center bg-prototipo-fg font-mono text-base font-bold text-prototipo group-hover:opacity-80";

/**
 * PROTOTIPO: la barra que cambia de variante. A propósito no se parece a nada de Celda (magenta,
 * borde discontinuo), para que no se juzgue con el diseño. Las flechas del teclado cambian la
 * última fila y, con Mayúsculas, la primera, salvo si el foco está en un control. Se puede
 * encoger para ver la pantalla limpia.
 */
export function BarraDePrototipo(props: BarraDePrototipoProps) {
  const [encogida, setEncogida] = createSignal(false);

  onSettled(() => {
    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key !== "ArrowLeft" && evento.key !== "ArrowRight") return;
      if (document.activeElement !== document.body) return;
      const fila = evento.shiftKey ? props.filas[0] : props.filas.at(-1);
      if (fila === undefined) return;
      evento.preventDefault();
      fila.alElegir(vecina(fila, evento.key === "ArrowLeft" ? -1 : 1));
    };
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  });

  return (
    <aside
      aria-label="Prototipo: variantes"
      class="fixed top-[6.25rem] left-0 z-40 border-2 border-l-0 border-dashed border-prototipo-fg bg-prototipo font-mono text-[11px] text-prototipo-fg drop-shadow-panel"
    >
      <Show
        when={!encogida()}
        fallback={
          <button
            type="button"
            aria-label="Abrir la barra del prototipo"
            class={variantesDiana({ class: "w-8 font-bold" })}
            onClick={() => setEncogida(false)}
          >
            P›
          </button>
        }
      >
        <div class="flex flex-col gap-1 py-1 pr-1 pl-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold tracking-[0.2em]">PROTOTIPO</span>
            <button
              type="button"
              aria-label="Encoger la barra del prototipo"
              class={variantesDiana({ class: "font-bold" })}
              onClick={() => setEncogida(true)}
            >
              ‹
            </button>
          </div>
          <For each={props.filas}>
            {(fila) => (
              <fieldset class="flex flex-col">
                <legend class="pl-0.5 opacity-90">{fila.titulo}</legend>
                <div class="flex items-center">
                  <button
                    type="button"
                    aria-label={`${fila.titulo}: variante anterior`}
                    class={variantesDiana()}
                    onClick={() => fila.alElegir(vecina(fila, -1))}
                  >
                    <span aria-hidden="true" class={FLECHA}>
                      ‹
                    </span>
                  </button>
                  <output aria-live="polite" class="w-[6.5rem] text-center leading-tight font-bold">
                    {fila.opciones.find((opcion) => opcion.clave === fila.actual)?.nombre ??
                      fila.actual}
                  </output>
                  <button
                    type="button"
                    aria-label={`${fila.titulo}: variante siguiente`}
                    class={variantesDiana()}
                    onClick={() => fila.alElegir(vecina(fila, 1))}
                  >
                    <span aria-hidden="true" class={FLECHA}>
                      ›
                    </span>
                  </button>
                </div>
              </fieldset>
            )}
          </For>
        </div>
      </Show>
    </aside>
  );
}
