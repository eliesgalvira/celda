import type { JSX } from "@solidjs/web";
import { createContext, createUniqueId, For, Show, useContext } from "solid-js";

import { variantesDiana } from "./Boton.tsx";
import { cn } from "./cn.ts";

export interface Credito {
  readonly texto: string;
  /** Adónde lleva. Un aviso sin fuente que enlazar no lleva enlace. */
  readonly enlace?: string;
  /**
   * Un aviso o una cita, no el crédito de unos datos: va sin «©». Lo son el de las marcas de las
   * compañías y la cita del logotipo de DIGI.
   */
  readonly aviso?: boolean;
  /** Qué datos son, para quien pasa el puntero o usa un lector de pantalla. */
  readonly detalle?: string;
  /** Lo que se escribe en el móvil, donde los créditos tienen poco sitio, si es más corto. */
  readonly corto?: string;
  /**
   * Si se ve también con los créditos plegados en el móvil, junto al botón «i». Lo pide la licencia
   * del mapa base de reserva del IGN: su crédito, a pie de mapa.
   */
  readonly fijo?: boolean;
}

/**
 * Los créditos se pliegan tras un botón «i», en el móvil y en escritorio, como permiten las pautas
 * de atribución de OpenStreetMap. Empiezan plegados y, abiertos, se vuelven a plegar al tocar el
 * mapa o a los cinco segundos. Lo decide `DisposicionMapa`, que sabe cuándo se toca el mapa.
 */
export interface PliegueCreditos {
  readonly plegada: () => boolean;
  readonly cambiar: (plegada: boolean) => void;
}

export const PliegueDeCreditos = createContext<PliegueCreditos>();

export interface AtribucionProps {
  readonly creditos: ReadonlyArray<Credito>;
}

const TEXTO = "inline-flex min-h-6 items-center";
const ENLACE = `${TEXTO} underline-offset-2 hover:text-primario-texto hover:underline`;
const CINTA =
  "cinta flex flex-wrap items-center gap-x-2 bg-superficie/90 px-3 py-0.5 font-mono text-[10.5px] text-tinta [--pico:6px]";

/** «© » delante de un crédito; nada delante de un aviso. */
const simbolo = (credito: Credito): string => (credito.aviso === true ? "" : "© ");

/** El texto de un crédito: entero y, en el móvil, el corto si lo tiene. */
function TextoDelCredito(props: { readonly credito: Credito }) {
  return (
    <Show
      when={props.credito.corto}
      fallback={
        <>
          {simbolo(props.credito)}
          {props.credito.texto}
        </>
      }
    >
      {(corto) => (
        <>
          <span class="max-md:hidden">
            {simbolo(props.credito)}
            {props.credito.texto}
          </span>
          <span class="md:hidden">
            {simbolo(props.credito)}
            {corto()}
          </span>
        </>
      )}
    </Show>
  );
}

/** Un crédito: un enlace a su fuente o, si no tiene, solo su texto. */
function UnCredito(props: { readonly credito: Credito; readonly children: JSX.Element }) {
  return (
    <Show
      when={props.credito.enlace}
      fallback={
        <span title={props.credito.detalle} class={TEXTO}>
          {props.children}
        </span>
      }
    >
      {(enlace) => (
        <a
          href={enlace()}
          title={props.credito.detalle}
          target="_blank"
          rel="noopener noreferrer"
          class={ENLACE}
        >
          {props.children}
        </a>
      )}
    </Show>
  );
}

/**
 * Los créditos de los datos del mapa, siempre a la vista o a un toque del botón «i». Los que son
 * `fijo` se ven también plegados, en una línea junto al botón.
 */
export function Atribucion(props: AtribucionProps) {
  const id = createUniqueId();
  const pliegue = useContext(PliegueDeCreditos);
  const plegada = () => pliegue.plegada();
  const fijos = () => props.creditos.filter((credito) => credito.fijo === true);
  return (
    <div class="flex items-end gap-1">
      <button
        type="button"
        aria-expanded={plegada() ? "false" : "true"}
        aria-controls={id}
        title="Créditos del mapa"
        class={variantesDiana({ class: "drop-shadow-marcador" })}
        onClick={() => pliegue.cambiar(!plegada())}
      >
        <span aria-hidden="true" class="chaflan grid size-8 bg-control-borde p-[2px] [--corte:6px]">
          <span class="chaflan grid place-items-center bg-control font-titulo text-lg leading-none font-semibold text-control-tinta italic [--corte:5px] group-hover:bg-control-hover">
            i
          </span>
        </span>
        <span class="sr-only">Créditos del mapa</span>
      </button>
      <p
        id={id}
        class={cn(
          CINTA,
          // Abiertos pueden quedar sobre la pista o la vista: fondo opaco.
          "bg-superficie",
          plegada() && "hidden",
        )}
      >
        <For each={props.creditos}>
          {(credito) => (
            <UnCredito credito={credito}>
              <TextoDelCredito credito={credito} />
            </UnCredito>
          )}
        </For>
      </p>
      <Show when={plegada() && fijos().length > 0}>
        <p class={cn(CINTA, "flex-nowrap whitespace-nowrap")}>
          <For each={fijos()}>
            {(credito) => (
              <UnCredito credito={credito}>
                {simbolo(credito)}
                {credito.corto ?? credito.texto}
              </UnCredito>
            )}
          </For>
        </p>
      </Show>
    </div>
  );
}
