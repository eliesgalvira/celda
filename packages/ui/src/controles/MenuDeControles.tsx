import type { JSX } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";
import { createSignal, createUniqueId, onSettled, Show } from "solid-js";

import { BotonHexagonal } from "../BotonHexagonal.tsx";
import { AspectoDeControl } from "./aspecto.ts";

const variantesPanelMenu = cva(
  "chaflan absolute z-20 flex w-72 flex-col gap-0.5 bg-superficie p-1.5 drop-shadow-panel [--corte:10px]",
  {
    variants: {
      posicion: {
        /** Encima del botón, alineado a su derecha: los botones de abajo a la derecha. */
        arriba: "right-0 bottom-full mb-2",
        /** A la izquierda del botón: la columna o el riel de la derecha. */
        izquierda: "right-full bottom-0 mr-2",
        /** Encima en la barra del móvil y a la izquierda en el riel de escritorio. */
        barra: "right-0 bottom-full mb-2 md:right-full md:bottom-0 md:mr-2 md:mb-0",
      },
    },
    defaultVariants: { posicion: "izquierda" },
  },
);

export type MenuDeControlesProps = VariantProps<typeof variantesPanelMenu> & {
  readonly etiqueta: string;
  readonly icono: JSX.Element;
  /** Título del menú para el lector de pantalla. */
  readonly titulo: string;
  /** Los controles del menú; se dibujan como filas con su explicación. */
  readonly children: JSX.Element;
};

/**
 * PROTOTIPO (controles): un botón que despliega otros controles, como «Más» en la barra o
 * «Funciones». Es un desplegable, no un menú de aplicación: el botón lleva `aria-expanded` y
 * el panel es un grupo de botones normales. Se cierra al usar uno, con Escape o tocando fuera.
 */
export function MenuDeControles(props: MenuDeControlesProps) {
  const id = createUniqueId();
  const [abierto, setAbierto] = createSignal(false);
  let caja: HTMLDivElement | undefined;

  onSettled(() => {
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
      class={props.posicion === "barra" ? "relative flex max-md:flex-1 md:w-full" : "relative"}
    >
      <BotonHexagonal
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
          class={variantesPanelMenu({ posicion: props.posicion })}
        >
          <legend class="sr-only">{props.titulo}</legend>
          <AspectoDeControl value="fila">{props.children}</AspectoDeControl>
        </fieldset>
      </Show>
    </div>
  );
}
