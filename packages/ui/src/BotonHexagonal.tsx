import type { JSX } from "@solidjs/web";
import { createUniqueId, Match, omit, Show, Switch, useContext } from "solid-js";

import { variantesDiana } from "./Boton.tsx";
import { AspectoDeControl } from "./controles/aspecto.ts";

export type BotonHexagonalProps = Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  "class" | "style" | "children" | "aria-pressed"
> & {
  /** Texto visible bajo el hexágono; es también el nombre accesible del botón. */
  readonly etiqueta: string;
  /** El dibujo del hexágono (un signo o un icono SVG con `currentColor`). */
  readonly icono: JSX.Element;
  /** Para los botones que se encienden y apagan (una vista, un modo). */
  readonly activo?: boolean;
  /** PROTOTIPO (controles): qué hace, en una línea. Solo se ve en las filas de un menú. */
  readonly detalle?: string;
};

/** El icono dentro de una losa clara con borde de tinta, como en los controles de piedra. */
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
 * El control del mapa del tema Hexágono. La etiqueta siempre se ve: los
 * controles no se adivinan por el icono (historia 65). Con el prototipo de controles, el aspecto
 * lo decide dónde lo pone `DisposicionMapa` (`AspectoDeControl`).
 */
export function BotonHexagonal(props: BotonHexagonalProps) {
  const resto = omit(props, "etiqueta", "icono", "activo", "detalle", "type");
  const aspecto = useContext(AspectoDeControl);
  const etiqueta = createUniqueId();
  const detalle = createUniqueId();
  const pulsado = () => (props.activo === undefined ? undefined : props.activo ? "true" : "false");

  return (
    <Switch>
      <Match when={aspecto === "hexagono"}>
        <button
          type={props.type ?? "button"}
          aria-pressed={pulsado()}
          class={variantesDiana({ class: "flex-col gap-1" })}
          {...resto}
        >
          <span
            aria-hidden="true"
            class={
              "hexagono grid h-[45px] w-10 place-items-center bg-superficie-invertida font-mono text-xl text-tinta-invertida " +
              "transition-[background-color,transform] duration-150 ease-out md:h-[52px] md:w-[46px] " +
              "group-hover:bg-primario group-hover:text-primario-fg group-active:translate-y-px group-active:bg-primario-activo " +
              "group-aria-pressed:bg-primario group-aria-pressed:text-primario-fg group-disabled:opacity-50"
            }
          >
            {props.icono}
          </span>
          <span class="cinta bg-superficie px-2 font-mono text-[11px] leading-5 text-tinta [--pico:6px] group-disabled:text-tinta-suave">
            {props.etiqueta}
          </span>
        </button>
      </Match>

      <Match when={aspecto === "piedra"}>
        <button
          type={props.type ?? "button"}
          aria-pressed={pulsado()}
          class={variantesDiana({ class: "drop-shadow-marcador" })}
          {...resto}
        >
          <span class="chaflan grid bg-control-borde p-[2px] [--corte:10px] group-disabled:opacity-50">
            <span
              class={
                "chaflan flex h-[3.25rem] w-[5.25rem] flex-col items-center justify-center gap-1 bg-control px-1 " +
                "text-control-tinta [--corte:9px] transition-colors duration-150 group-hover:bg-control-hover " +
                "group-active:bg-primario-activo group-active:text-primario-fg " +
                "group-aria-pressed:bg-primario group-aria-pressed:text-primario-fg"
              }
            >
              <span
                aria-hidden="true"
                class="grid h-5 place-items-center font-mono text-xl leading-none"
              >
                {props.icono}
              </span>
              <span class="text-center font-texto text-[11px] leading-[1.1] font-semibold">
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

      <Match when={aspecto === "barra"}>
        <button
          type={props.type ?? "button"}
          aria-pressed={pulsado()}
          class={variantesDiana({
            class: "h-14 min-w-0 flex-1 md:h-auto md:w-full md:flex-none",
          })}
          {...resto}
        >
          <span
            class={
              "chaflan flex size-full flex-col items-center justify-center gap-1 px-1 py-1.5 text-control-tinta [--corte:8px] " +
              "transition-colors duration-150 group-hover:bg-control-hover group-active:bg-primario-activo " +
              "group-active:text-primario-fg group-aria-pressed:bg-primario group-aria-pressed:text-primario-fg " +
              "group-aria-expanded:bg-superficie-invertida group-aria-expanded:text-tinta-invertida group-disabled:opacity-50 " +
              "md:py-2"
            }
          >
            <span
              aria-hidden="true"
              class="grid h-5 place-items-center font-mono text-xl leading-none"
            >
              {props.icono}
            </span>
            <span class="text-center font-texto text-[11px] leading-[1.1] font-semibold">
              {props.etiqueta}
            </span>
          </span>
        </button>
      </Match>

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
