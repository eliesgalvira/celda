import type { JSX } from "@solidjs/web";
import { createUniqueId, Match, omit, Show, Switch, useContext } from "solid-js";

import { variantesDiana } from "./Boton.tsx";
import { AspectoDeControl } from "./controles/aspecto.ts";

export type ControlDelMapaProps = Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  "class" | "style" | "children" | "aria-pressed"
> & {
  /** Texto del botón; es también su nombre accesible. */
  readonly etiqueta: string;
  /** El dibujo (un signo o un icono SVG con `currentColor`). */
  readonly icono: JSX.Element;
  /** Para los botones que se encienden y apagan (una vista, un modo). */
  readonly activo?: boolean;
  /** Qué hace, en una línea. Solo se ve en las filas de un menú. */
  readonly detalle?: string;
};

/** El icono dentro de una losa clara con borde de tinta. */
function Losa(props: { readonly icono: JSX.Element; readonly tamano: "zoom" | "fila" }) {
  return (
    <span aria-hidden="true" class="chaflan grid shrink-0 bg-control-borde p-[2px] [--corte:8px]">
      <span
        class={
          (props.tamano === "zoom" ? "size-10 text-xl " : "size-8 text-base ") +
          "chaflan grid place-items-center bg-control font-mono text-control-tinta [--corte:7px] " +
          "transition-colors duration-150 group-hover:bg-control-hover group-active:bg-primario-activo " +
          "group-active:text-primario-fg group-aria-pressed:bg-primario group-aria-pressed:text-primario-fg"
        }
      >
        {props.icono}
      </span>
    </span>
  );
}

/**
 * Un control del mapa. Son claros, con borde de tinta, para no confundirse con las agrupaciones,
 * que son oscuras. Su aspecto lo decide dónde lo pone `DisposicionMapa` (`AspectoDeControl`):
 * una pastilla con la etiqueta, una losa pequeña para Acercar y Alejar o una fila de menú con su
 * explicación. La etiqueta siempre es el nombre accesible (historia 65).
 */
export function ControlDelMapa(props: ControlDelMapaProps) {
  const resto = omit(props, "etiqueta", "icono", "activo", "detalle", "type");
  const aspecto = useContext(AspectoDeControl);
  const etiqueta = createUniqueId();
  const detalle = createUniqueId();
  const pulsado = () => (props.activo === undefined ? undefined : props.activo ? "true" : "false");

  return (
    <Switch>
      <Match when={aspecto === "pastilla"}>
        <button
          type={props.type ?? "button"}
          aria-pressed={pulsado()}
          class={variantesDiana({ class: "drop-shadow-marcador" })}
          {...resto}
        >
          <span class="cinta grid bg-control-borde p-[2px] [--pico:14px] group-disabled:opacity-50">
            <span
              class={
                "cinta flex h-11 w-[9.5rem] items-center gap-2 bg-control pr-4 pl-5 text-control-tinta [--pico:13px] " +
                "transition-colors duration-150 group-hover:bg-control-hover group-active:bg-primario-activo " +
                "group-active:text-primario-fg group-aria-pressed:bg-primario group-aria-pressed:text-primario-fg " +
                "group-aria-expanded:bg-superficie-invertida group-aria-expanded:text-tinta-invertida"
              }
            >
              <span
                aria-hidden="true"
                class="grid w-5 place-items-center font-mono text-xl leading-none"
              >
                {props.icono}
              </span>
              <span class="font-texto text-sm font-semibold whitespace-nowrap">
                {props.etiqueta}
              </span>
            </span>
          </span>
        </button>
      </Match>

      <Match when={aspecto === "zoom"}>
        <button
          type={props.type ?? "button"}
          aria-pressed={pulsado()}
          title={props.etiqueta}
          class={variantesDiana({ class: "drop-shadow-marcador group-disabled:opacity-50" })}
          {...resto}
        >
          <Losa icono={props.icono} tamano="zoom" />
          <span class="sr-only">{props.etiqueta}</span>
        </button>
      </Match>

      <Match when={aspecto === "fila"}>
        <button
          type={props.type ?? "button"}
          aria-pressed={pulsado()}
          aria-labelledby={etiqueta}
          aria-describedby={props.detalle === undefined ? undefined : detalle}
          class={
            "group flex min-h-12 w-full cursor-pointer items-center gap-3 px-2.5 py-1.5 text-left " +
            "hover:bg-superficie-alta disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
          }
          {...resto}
        >
          <Losa icono={props.icono} tamano="fila" />
          <span class="flex min-w-0 flex-col">
            <span id={etiqueta} class="font-texto text-sm font-semibold text-tinta">
              {props.etiqueta}
            </span>
            <Show when={props.detalle}>
              <span id={detalle} class="text-xs leading-snug text-tinta-suave">
                {props.detalle}
              </span>
            </Show>
          </span>
        </button>
      </Match>
    </Switch>
  );
}
