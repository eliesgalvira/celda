import type { JSX } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";
import { createUniqueId, onSettled, Show, useContext } from "solid-js";

import { BotonHexagonal } from "../BotonHexagonal.tsx";
import { AspectoDeControl } from "../controles/aspecto.ts";
import { IconoMirilla } from "./MarcadorReferencia.tsx";

export interface MenuUbicacionProps {
  /** Hay un punto de referencia: el botón se ve encendido. */
  readonly activo: boolean;
  readonly abierto: boolean;
  readonly alAbrir: () => void;
  readonly alCerrar: () => void;
  /** Las `OpcionUbicacion` del menú. */
  readonly children: JSX.Element;
}

/**
 * El botón de ubicación del mapa, un hexágono con una mirilla, y su menú: usar la ubicación,
 * elegir un punto, centrar el mapa o quitarlo. Escape o un clic fuera lo cierran.
 */
export function MenuUbicacion(props: MenuUbicacionProps) {
  const id = createUniqueId();
  // PROTOTIPO (controles): en la barra y con las pastillas, el menú sale hacia arriba.
  const aspecto = useContext(AspectoDeControl);
  let caja: HTMLDivElement | undefined;

  onSettled(() => {
    const fuera = (evento: PointerEvent) => {
      if (
        props.abierto &&
        evento.target instanceof Node &&
        caja?.contains(evento.target) !== true
      ) {
        props.alCerrar();
      }
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  });

  return (
    <div
      ref={(elemento) => {
        caja = elemento;
        // Con un escuchador y no con `onKeyDown`: la caja no es un control, solo recoge el
        // Escape de los botones que tiene dentro.
        elemento.addEventListener("keydown", (evento) => {
          if (evento.key === "Escape" && props.abierto) {
            evento.stopPropagation();
            props.alCerrar();
            elemento.querySelector<HTMLButtonElement>("[aria-controls]")?.focus();
          }
        });
      }}
      class={aspecto === "barra" ? "relative flex max-md:flex-1 md:w-full" : "relative"}
    >
      <BotonHexagonal
        etiqueta="Ubicación"
        icono={<IconoMirilla />}
        activo={props.activo}
        aria-expanded={props.abierto ? "true" : "false"}
        aria-controls={id}
        onClick={() => (props.abierto ? props.alCerrar() : props.alAbrir())}
      />
      <Show when={props.abierto}>
        <fieldset
          id={id}
          ref={(elemento) => {
            queueMicrotask(() =>
              elemento.querySelector<HTMLButtonElement>("button:enabled")?.focus(),
            );
          }}
          class={variantesMenuUbicacion({
            posicion:
              aspecto === "barra" ? "barra" : aspecto === "pastilla" ? "arriba" : "izquierda",
          })}
        >
          <legend class="sr-only">Punto de referencia</legend>
          {props.children}
        </fieldset>
      </Show>
    </div>
  );
}

const variantesMenuUbicacion = cva(
  "chaflan absolute z-20 flex w-72 flex-col bg-superficie p-1.5 drop-shadow-panel [--corte:10px]",
  {
    variants: {
      posicion: {
        izquierda: "right-full bottom-0 mr-2",
        arriba: "right-0 bottom-full mb-2",
        barra: "right-0 bottom-full mb-2 md:right-full md:bottom-0 md:mr-2 md:mb-0",
      },
    },
  },
);

const variantesIconoOpcion = cva("hexagono mt-0.5 h-5 w-[18px] shrink-0", {
  variants: {
    tono: {
      gps: "bg-primario",
      elegido: "bg-referencia",
      neutro: "bg-tinta",
      quitar: "bg-linea-fuerte",
    },
  },
  defaultVariants: { tono: "neutro" },
});

export type OpcionUbicacionProps = VariantProps<typeof variantesIconoOpcion> & {
  readonly etiqueta: string;
  /** Qué pasa al elegirla o, si no se puede, por qué. */
  readonly detalle?: string | undefined;
  readonly disabled?: boolean;
  readonly onClick: () => void;
};

/** Una opción del menú de ubicación, con su hexágono de color y una línea que la explica. */
export function OpcionUbicacion(props: OpcionUbicacionProps) {
  const detalle = createUniqueId();
  return (
    <button
      type="button"
      aria-label={props.etiqueta}
      aria-describedby={props.detalle === undefined ? undefined : detalle}
      disabled={props.disabled === true}
      class="flex min-h-11 w-full items-start gap-3 px-2.5 py-2 text-left text-sm hover:bg-superficie-alta disabled:cursor-default disabled:hover:bg-transparent"
      onClick={() => props.onClick()}
    >
      <span
        aria-hidden="true"
        class={variantesIconoOpcion({ tono: props.disabled === true ? "quitar" : props.tono })}
      />
      <span class="flex flex-col">
        <span class={props.disabled === true ? "text-tinta-suave" : ""}>{props.etiqueta}</span>
        <Show when={props.detalle}>
          <span id={detalle} class="text-xs leading-snug text-tinta-suave">
            {props.detalle}
          </span>
        </Show>
      </span>
    </button>
  );
}
