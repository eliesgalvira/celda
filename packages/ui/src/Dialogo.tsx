import type { JSX } from "@solidjs/web";
import { createEffect, createUniqueId, onSettled, Show } from "solid-js";

import { Boton } from "./Boton.tsx";

/** Lo que puede recibir el foco dentro del diálogo. */
const ENFOCABLES =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), " +
  "textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

const enfocables = (dentro: HTMLElement): ReadonlyArray<HTMLElement> =>
  Array.from(dentro.querySelectorAll<HTMLElement>(ENFOCABLES)).filter(
    (elemento) => elemento.closest("[inert]") === null,
  );

export interface DialogoProps {
  /** Título visible, que es también el nombre accesible del diálogo. */
  readonly titulo: string;
  /** Texto corto sobre el título, como «TU SEÑAL». */
  readonly antetitulo?: string;
  readonly alCerrar: () => void;
  readonly children: JSX.Element;
}

/**
 * Diálogo modal del tema Hexágono. En el móvil sube desde abajo a todo el ancho y en escritorio
 * queda centrado. Al abrirse lleva el foco a su título, el tabulador no sale de él, Escape y el
 * botón «Cerrar» lo cierran, y al cerrarse devuelve el foco a donde estaba.
 *
 * Si cambia el título, es otra vista: vuelve arriba y el foco pasa al título nuevo.
 *
 * El padre lo monta para abrirlo y lo desmonta para cerrarlo: `alCerrar` solo lo pide.
 */
export function Dialogo(props: DialogoProps) {
  const idTitulo = createUniqueId();
  let dialogo: HTMLDialogElement | undefined;
  let titulo: HTMLHeadingElement | undefined;
  let cuerpo: HTMLDivElement | undefined;

  onSettled(() => {
    const previo = document.activeElement;
    if (dialogo !== undefined && !dialogo.open) dialogo.showModal();
    titulo?.focus({ preventScroll: true });
    return () => {
      dialogo?.close();
      if (previo instanceof HTMLElement && previo.isConnected)
        previo.focus({ preventScroll: true });
    };
  });

  // Un título nuevo es otra vista dentro del mismo diálogo: empieza arriba y con el foco en el
  // título, porque el control que la abrió ya no está.
  createEffect(
    () => props.titulo,
    () => {
      if (cuerpo !== undefined) cuerpo.scrollTop = 0;
      titulo?.focus({ preventScroll: true });
    },
    { defer: true },
  );

  const alPulsarTecla = (evento: KeyboardEvent) => {
    if (evento.key === "Escape") {
      // El navegador también cerraría el <dialog> por su cuenta; lo cierra el padre.
      evento.preventDefault();
      evento.stopPropagation();
      props.alCerrar();
      return;
    }
    if (evento.key !== "Tab" || dialogo === undefined) return;
    const lista = enfocables(dialogo);
    const primero = lista[0];
    const ultimo = lista.at(-1);
    if (primero === undefined || ultimo === undefined) return;
    const actual = document.activeElement;
    const fuera = !(actual instanceof Node) || !dialogo.contains(actual) || actual === titulo;
    if (evento.shiftKey && (actual === primero || fuera)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && (actual === ultimo || (fuera && actual !== titulo))) {
      evento.preventDefault();
      primero.focus();
    }
  };

  return (
    <dialog
      ref={(elemento) => {
        dialogo = elemento;
        // Con escuchadores y no con `onKeyDown`: el diálogo no es un control, recoge las teclas
        // de los controles que tiene dentro.
        elemento.addEventListener("keydown", alPulsarTecla);
        elemento.addEventListener("cancel", (evento) => {
          evento.preventDefault();
          props.alCerrar();
        });
        // Un clic en el velo, fuera del panel, también cierra.
        elemento.addEventListener("click", (evento) => {
          if (evento.target === elemento) props.alCerrar();
        });
      }}
      aria-labelledby={idTitulo}
      class={
        "m-0 size-full max-h-none max-w-none bg-transparent p-0 font-texto text-tinta " +
        "backdrop:bg-velo open:flex open:items-end open:justify-center md:open:items-center md:open:p-6"
      }
    >
      <div class="w-full drop-shadow-panel md:w-[34rem]">
        <div
          class={
            "chaflan flex max-h-[92dvh] w-full flex-col bg-superficie [--corte:18px] " +
            "max-md:[clip-path:polygon(var(--corte)_0,100%_0,100%_100%,0_100%,0_var(--corte))] md:max-h-[88dvh]"
          }
        >
          <header class="flex shrink-0 items-start gap-3 border-b border-linea px-5 pt-4 pb-3">
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <Show when={props.antetitulo}>
                <p class="font-mono text-xs font-semibold tracking-[0.2em] text-primario-texto">
                  {props.antetitulo}
                </p>
              </Show>
              <h2
                id={idTitulo}
                ref={(elemento) => {
                  titulo = elemento;
                }}
                tabindex="-1"
                class="font-titulo text-2xl leading-tight tracking-wide outline-none"
              >
                {props.titulo}
              </h2>
            </div>
            <Boton variante="secundario" onClick={() => props.alCerrar()}>
              Cerrar
            </Boton>
          </header>
          <div
            ref={(elemento) => {
              cuerpo = elemento;
            }}
            class="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pt-4 pb-6 text-sm leading-relaxed"
          >
            {props.children}
          </div>
        </div>
      </div>
    </dialog>
  );
}
