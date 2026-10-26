import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import type { GrupoSinRedPropia, SinRedPropia } from "@celda/dominio/filtro";
import type { JSX } from "@solidjs/web";
import { cva } from "class-variance-authority";
import { createSignal, createUniqueId, flush, For, Show } from "solid-js";

import { variantesDiana } from "../Boton.tsx";
import { cn } from "../cn.ts";
import { ControlDelMapa } from "../ControlDelMapa.tsx";
import { LogoCompanias } from "../marcadores/LogoCompanias.tsx";
import { recursoFijo } from "../recurso.ts";

/**
 * El filtro de compañías del mapa (ADR 0026): una pastilla «Compañías» junto a «Foto aérea» y
 * «Ubicación», que abre encima los chips, y el aviso que dice bajo la cabecera que hay un
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

/** La raya que separa partes del panel. */
function Raya() {
  return <span aria-hidden="true" class="mx-1 my-1 border-t border-linea" />;
}

/** «Red de Orange», con su logo, y debajo las compañías que la usan, en filas que se parten. */
function CompaniasDeLaRed(props: {
  readonly grupo: GrupoSinRedPropia;
  readonly alElegir: (compania: string) => void;
}) {
  const titulo = createUniqueId();
  return (
    <div role="group" aria-labelledby={titulo} class="flex flex-col pt-1.5">
      <span
        id={titulo}
        class="flex items-center gap-1.5 px-0.5 font-texto text-xs font-semibold text-tinta"
      >
        <span aria-hidden="true" class="grid size-4 place-items-center">
          <LogoCompanias companias={[props.grupo.red]} tamano={16} />
        </span>
        Red de {NOMBRE_COMPANIA[props.grupo.red]}
      </span>
      <div class="flex flex-wrap gap-x-1">
        <For each={props.grupo.companias}>
          {(compania) => (
            <button type="button" class={variantesDiana()} onClick={() => props.alElegir(compania)}>
              <span class="border-[1.5px] border-control-borde bg-control px-2 py-1 font-texto text-xs font-semibold text-control-tinta group-hover:bg-control-hover group-active:bg-primario group-active:text-primario-fg">
                {compania}
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

export interface MenuDeCompaniasProps {
  /** Hay un filtro puesto: la pastilla se ve encendida. */
  readonly activo: boolean;
  readonly disabled?: boolean;
  /** El chip de todas (`ChipDeCompania` sin compañía). */
  readonly todas: JSX.Element;
  /** Un chip por compañía. */
  readonly children: JSX.Element;
  /** Qué se ve ahora, en una frase. Solo la oye el lector de pantalla, al cambiar. */
  readonly estado: string;
  /** Las compañías sin red propia, por la red que usan: las de «¿No sale la tuya?». */
  readonly sinRedPropia: ReadonlyArray<GrupoSinRedPropia>;
  /** Se ha tocado una compañía sin red propia. El panel se cierra. */
  readonly alElegirSinRedPropia: (eleccion: SinRedPropia) => void;
}

/**
 * La pastilla «Compañías» y su panel, que sale encima, como el de «Ubicación»: «Todas», una raya,
 * las compañías, todas en una columna del mismo ancho, y «¿No sale la tuya?», que cambia el panel
 * por las compañías sin red propia. Tocar un chip no lo cierra, para elegir varias; tocar una
 * compañía sin red propia, sí. Escape vuelve a los chips o cierra, y un toque fuera cierra. Lo que
 * se ve ya lo dicen los chips pulsados; la frase de `estado` solo se anuncia, también con el panel
 * cerrado.
 */
export function MenuDeCompanias(props: MenuDeCompaniasProps) {
  const id = createUniqueId();
  const nota = createUniqueId();
  const [abierto, setAbierto] = createSignal(false);
  const [viendoSinRed, setViendoSinRed] = createSignal(false);
  let caja: HTMLDivElement | undefined;
  let noSale: HTMLButtonElement | undefined;
  let volver: HTMLButtonElement | undefined;

  const verSinRed = (ver: boolean) => {
    setViendoSinRed(ver);
    flush();
    (ver ? volver : noSale)?.focus();
  };
  const cerrar = () => {
    setAbierto(false);
    caja?.querySelector<HTMLButtonElement>("[aria-controls]")?.focus();
  };

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
            if (viendoSinRed()) verSinRed(false);
            else cerrar();
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
        onClick={() => {
          setViendoSinRed(false);
          setAbierto(!abierto());
        }}
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
            "chaflan absolute right-0 bottom-full z-20 mb-2 flex flex-col",
            "bg-superficie px-2 py-1.5 drop-shadow-panel [--corte:10px]",
            viendoSinRed() ? "w-60" : "w-48",
          )}
        >
          <Show
            when={viendoSinRed()}
            fallback={
              <>
                <fieldset class="flex flex-col">
                  <legend class="sr-only">Compañías que se ven</legend>
                  {props.todas}
                  <Raya />
                  {props.children}
                </fieldset>
                <Raya />
                <button
                  type="button"
                  ref={(boton) => {
                    noSale = boton;
                  }}
                  class={variantesDiana({ class: "w-full" })}
                  onClick={() => verSinRed(true)}
                >
                  <span class="flex w-full items-center justify-between px-1 font-texto text-sm font-semibold text-primario-texto group-hover:text-tinta">
                    <span class="underline underline-offset-4">¿No sale la tuya?</span>
                    <span aria-hidden="true">›</span>
                  </span>
                </button>
              </>
            }
          >
            <div role="group" aria-labelledby={nota} class="flex flex-col">
              <button
                type="button"
                aria-label="Volver a las compañías"
                ref={(boton) => {
                  volver = boton;
                }}
                class={variantesDiana({ class: "justify-start" })}
                onClick={() => verSinRed(false)}
              >
                <span class="flex items-center gap-1.5 px-0.5 font-texto text-sm font-semibold text-tinta group-hover:text-primario-texto">
                  <span aria-hidden="true">‹</span>
                  Compañías
                </span>
              </button>
              <p id={nota} class="px-0.5 pb-1 font-texto text-xs leading-snug text-tinta-suave">
                Estas compañías no tienen antenas propias y usan las de otra. Toca la tuya para ver
                esa red.
              </p>
              <div class="flex flex-col divide-y divide-linea">
                <For each={props.sinRedPropia}>
                  {(grupo) => (
                    <CompaniasDeLaRed
                      grupo={grupo}
                      alElegir={(compania) => {
                        props.alElegirSinRedPropia({ compania, red: grupo.red });
                        cerrar();
                      }}
                    />
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </Show>
      <output aria-live="polite" class="sr-only">
        {props.estado}
      </output>
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
