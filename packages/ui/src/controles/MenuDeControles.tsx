import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, Show } from "solid-js";

import { ControlDelMapa } from "../ControlDelMapa.tsx";
import { recursoFijo } from "../recurso.ts";
import { AspectoDeControl } from "./aspecto.ts";

export interface MenuDeControlesProps {
  readonly etiqueta: string;
  readonly icono: JSX.Element;
  /** Título del grupo para el lector de pantalla. */
  readonly titulo: string;
  /** Los controles del menú; se dibujan como filas con su explicación. */
  readonly children: JSX.Element;
}

/**
 * El botón «Funciones», que despliega encima el resto de controles del mapa. Es un desplegable,
 * no un menú de aplicación: el botón lleva `aria-expanded` y el panel es un grupo de botones
 * normales. Se cierra al usar uno, con Escape o tocando fuera.
 */
export function MenuDeControles(props: MenuDeControlesProps) {
  const id = createUniqueId();
  const [abierto, setAbierto] = createSignal(false);
  let caja: HTMLDivElement | undefined;

  recursoFijo("menu-de-controles:fuera", () => {
    const fuera = (evento: PointerEvent) => {
      if (evento.target instanceof Node && caja?.contains(evento.target) !== true) {
        setAbierto(false);
      }
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  });

  return (
    <div
      ref={(elemento) => {
        caja = elemento;
        elemento.addEventListener("keydown", (evento) => {
          if (evento.key === "Escape" && abierto()) {
            evento.stopPropagation();
            setAbierto(false);
            elemento.querySelector<HTMLButtonElement>("[aria-controls]")?.focus();
          }
        });
      }}
      class="relative"
    >
      <ControlDelMapa
        etiqueta={props.etiqueta}
        icono={props.icono}
        aria-expanded={abierto() ? "true" : "false"}
        aria-controls={id}
        onClick={() => setAbierto(!abierto())}
      />
      <Show when={abierto()}>
        <fieldset
          id={id}
          ref={(elemento) => {
            queueMicrotask(() =>
              elemento.querySelector<HTMLButtonElement>("button:enabled")?.focus(),
            );
            // Después del clic del propio control, que Solid atiende en el documento.
            elemento.addEventListener("click", (evento) => {
              if (evento.target instanceof Element && evento.target.closest("button") !== null) {
                queueMicrotask(() => setAbierto(false));
              }
            });
          }}
          class="chaflan absolute right-0 bottom-full z-20 mb-2 flex w-72 flex-col gap-0.5 bg-superficie p-1.5 drop-shadow-panel [--corte:10px]"
        >
          <legend class="sr-only">{props.titulo}</legend>
          <AspectoDeControl value="fila">{props.children}</AspectoDeControl>
        </fieldset>
      </Show>
    </div>
  );
}
