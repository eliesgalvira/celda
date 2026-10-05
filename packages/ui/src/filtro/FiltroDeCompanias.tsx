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
  "flex min-h-9 w-full items-center gap-2 border-[1.5px] py-1 pr-3 pl-2 font-texto text-sm font-semibold " +
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

/**
 * El logo del chip, en una caja de 22 px para que todos, también el hexágono de «Todas», midan lo
 * mismo y el nombre empiece a la misma altura. Apagado si su compañía no se ve con el filtro.
 */
const variantesLogoDelChip = cva("grid size-[22px] shrink-0 place-items-center", {
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
      class={variantesDiana({ class: "w-full" })}
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
  /** El chip de todas (`ChipDeCompania` sin compañía). */
  readonly todas: JSX.Element;
  /** Un chip por compañía. */
  readonly children: JSX.Element;
  /** Qué se ve ahora, en una frase. Solo la oye el lector de pantalla, al cambiar. */
  readonly estado: string;
}

/**
 * Lo que se despliega: «Todas», una raya y las compañías, todos en una columna del mismo ancho.
 * Lo que se ve ya lo dicen los chips pulsados; la frase de `estado` solo se anuncia.
 */
export function PanelDeCompanias(props: PanelDeCompaniasProps) {
  return (
    <>
      <fieldset class="flex flex-col">
        <legend class="sr-only">Compañías que se ven</legend>
        {props.todas}
        <span aria-hidden="true" class="mx-1 my-1 border-t border-linea" />
        {props.children}
      </fieldset>
      <output aria-live="polite" class="sr-only">
        {props.estado}
      </output>
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
            "chaflan absolute right-0 bottom-full z-20 mb-2 flex w-48 flex-col",
            "bg-superficie px-2 py-1.5 drop-shadow-panel [--corte:10px]",
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
  /** Una línea más, solo si algo sorprendería: la red que usan o que de lejos se cuentan todas. */
  readonly detalle?: string | undefined;
  /** Quita el filtro de un toque. */
  readonly alQuitar: () => void;
}

/**
 * El aviso de que hay un filtro puesto, bajo la fecha de los datos: qué se ve y «Ver todas» en una
 * línea, y debajo, a todo el ancho, el detalle si lo hay. Es un control, claro y con borde, como
 * las pastillas. El botón queda a 10 px del borde por arriba, por abajo y por la derecha.
 */
export function AvisoDeFiltro(props: AvisoDeFiltroProps) {
  return (
    <section
      aria-label="Filtro de compañías"
      class="grid max-w-[min(24rem,calc(100vw-1.5rem))] grid-cols-[1fr_auto] items-center gap-x-2 border-[1.5px] border-control-borde bg-control py-[3.5px] pr-2.5 pl-3.5 text-control-tinta drop-shadow-marcador"
    >
      <output class="truncate font-texto text-sm font-semibold">{props.texto}</output>
      <button
        type="button"
        class={variantesDiana({ class: "shrink-0" })}
        onClick={() => props.alQuitar()}
      >
        <span class="border-[1.5px] border-control-borde bg-superficie px-2.5 py-1 font-texto text-sm font-semibold whitespace-nowrap text-control-tinta group-hover:bg-control-hover">
          Ver todas
        </span>
      </button>
      <Show when={props.detalle}>
        <span class="col-span-2 -mt-2 pb-2 text-xs leading-snug text-tinta-suave">
          {props.detalle}
        </span>
      </Show>
    </section>
  );
}
