import type { Compania } from "@celda/dominio/compania";
import type { JSX } from "@solidjs/web";
import { cva } from "class-variance-authority";
import { createSignal, createUniqueId, Show } from "solid-js";

import { variantesDiana } from "../Boton.tsx";
import { cn } from "../cn.ts";
import { ControlDelMapa } from "../ControlDelMapa.tsx";
import { LogoCompanias } from "../marcadores/LogoCompanias.tsx";
import { recursoFijo } from "../recurso.ts";

/**
 * El filtro de compañías del mapa (ADR 0026): una pastilla «Compañías» junto a «Foto aérea» y
 * «Ubicación», que abre encima una fila de chips, y el aviso que dice bajo la cabecera que hay un
 * filtro puesto. Son controles: claros, con borde de tinta y rectangulares, para no confundirse
 * con los marcadores, que son los datos (redondos o hexagonales).
 */

/** Un embudo: lo que filtra. */
export function IconoCompanias() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linejoin="round"
    >
      <path d="M2.5 3.5h15l-5.75 7v5.5l-3.5 1.5v-7z" />
    </svg>
  );
}

const variantesChip = cva(
  "flex min-h-9 items-center gap-2 border-[1.5px] py-1 pr-3 pl-1.5 font-texto text-sm font-semibold " +
    "transition-colors duration-150 motion-reduce:transition-none",
  {
    variants: {
      pulsado: {
        si: "border-primario bg-primario text-primario-fg group-hover:bg-primario-hover",
        no: "border-control-borde bg-control text-control-tinta group-hover:bg-control-hover",
      },
    },
  },
);

/** El logo del chip, apagado si su compañía no se ve con el filtro. */
const variantesLogoDelChip = cva("grid shrink-0 place-items-center", {
  variants: {
    incluida: { si: "", no: "opacity-40 grayscale" },
  },
});

export interface ChipDeCompaniaProps {
  /** La compañía, o `undefined` en el chip de todas. */
  readonly compania?: Compania;
  readonly etiqueta: string;
  /** Si está elegida en el filtro: `aria-pressed`. */
  readonly pulsado: boolean;
  /** Si sus emplazamientos se ven: sin filtro, todas; con él, las elegidas. */
  readonly incluida: boolean;
  readonly onClick: () => void;
}

/**
 * Un chip del filtro: un botón que se enciende y se apaga (`aria-pressed`), con el logo pequeño de
 * la compañía y su nombre escrito. El objetivo táctil mide 44 px de alto.
 */
export function ChipDeCompania(props: ChipDeCompaniaProps) {
  return (
    <button
      type="button"
      aria-pressed={props.pulsado ? "true" : "false"}
      data-compania={props.compania ?? "todas"}
      class={variantesDiana()}
      onClick={() => props.onClick()}
    >
      <span class={variantesChip({ pulsado: props.pulsado ? "si" : "no" })}>
        <span
          aria-hidden="true"
          class={variantesLogoDelChip({ incluida: props.incluida ? "si" : "no" })}
        >
          <Show
            when={props.compania}
            fallback={<span class="hexagono block size-5 bg-superficie-invertida" />}
          >
            {(compania) => <LogoCompanias companias={[compania()]} tamano={22} />}
          </Show>
        </span>
        {props.etiqueta}
      </span>
    </button>
  );
}

export interface PanelDeCompaniasProps {
  /** Los chips: el de todas y uno por compañía (`ChipDeCompania`). */
  readonly children: JSX.Element;
  /** Qué se ve ahora, en una frase: se anuncia al cambiar. */
  readonly estado: string;
  /** Cómo se usa, o qué sale aparte con el filtro puesto. */
  readonly nota: string;
}

/** Lo que se despliega: los chips en filas, lo que se ve y una nota. */
export function PanelDeCompanias(props: PanelDeCompaniasProps) {
  const nota = createUniqueId();
  return (
    <>
      <fieldset aria-describedby={nota} class="flex flex-wrap gap-x-1 gap-y-0.5">
        <legend class="sr-only">Compañías que se ven</legend>
        {props.children}
      </fieldset>
      <output aria-live="polite" class="px-1 text-sm text-tinta">
        {props.estado}
      </output>
      <p id={nota} class="px-1 text-xs leading-snug text-tinta-suave">
        {props.nota}
      </p>
    </>
  );
}

export interface MenuDeCompaniasProps {
  /** Hay un filtro puesto: la pastilla se ve encendida. */
  readonly activo: boolean;
  readonly disabled?: boolean;
  /** Lo que se despliega (`PanelDeCompanias`). */
  readonly children: JSX.Element;
}

/**
 * La pastilla «Compañías» y su panel, que sale encima, como el de «Ubicación». Tocar un chip no
 * lo cierra: se pueden elegir varias. Escape o un toque fuera lo cierran.
 */
export function MenuDeCompanias(props: MenuDeCompaniasProps) {
  const id = createUniqueId();
  const [abierto, setAbierto] = createSignal(false);
  let caja: HTMLDivElement | undefined;

  recursoFijo("menu-de-companias:fuera", () => {
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
        // La caja no es un control: solo recoge el Escape de los botones que tiene dentro.
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
        etiqueta="Compañías"
        icono={<IconoCompanias />}
        activo={props.activo}
        disabled={props.disabled === true}
        aria-expanded={abierto() ? "true" : "false"}
        aria-controls={id}
        onClick={() => setAbierto(!abierto())}
      />
      <Show when={abierto()}>
        <div
          id={id}
          ref={(elemento) => {
            queueMicrotask(() =>
              (
                elemento.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ??
                elemento.querySelector<HTMLButtonElement>("button")
              )?.focus(),
            );
          }}
          class={cn(
            "chaflan absolute right-0 bottom-full z-20 mb-2 flex w-[min(20.5rem,calc(100vw-1rem))] flex-col gap-1.5",
            "bg-superficie p-2 drop-shadow-panel [--corte:10px]",
          )}
        >
          {props.children}
        </div>
      </Show>
    </div>
  );
}

export interface AvisoDeFiltroProps {
  /** Qué se ve: «Solo Movistar». */
  readonly texto: string;
  /** Una línea más, como la de la red que usan o que de lejos aún se cuentan todas. */
  readonly detalle?: string | undefined;
  /** Quita el filtro de un toque. */
  readonly alQuitar: () => void;
}

/**
 * El aviso de que hay un filtro puesto, bajo la fecha de los datos: qué se ve y un botón para
 * volver a ver todas. Es un control, claro y con borde, como las pastillas.
 */
export function AvisoDeFiltro(props: AvisoDeFiltroProps) {
  return (
    <section
      aria-label="Filtro de compañías"
      class="flex max-w-[min(24rem,calc(100vw-1.5rem))] items-center gap-1 border-[1.5px] border-control-borde bg-control py-0.5 pr-0.5 pl-2.5 text-control-tinta drop-shadow-marcador"
    >
      <span class="flex min-w-0 flex-col py-0.5">
        <output class="truncate font-texto text-sm font-semibold">{props.texto}</output>
        <Show when={props.detalle}>
          <span class="text-xs leading-snug text-tinta-suave">{props.detalle}</span>
        </Show>
      </span>
      <button
        type="button"
        class={variantesDiana({ class: "shrink-0 px-1" })}
        onClick={() => props.alQuitar()}
      >
        <span class="border-[1.5px] border-control-borde bg-superficie px-2 py-1 font-texto text-sm font-semibold whitespace-nowrap text-control-tinta group-hover:bg-control-hover">
          Ver todas
        </span>
      </button>
    </section>
  );
}
