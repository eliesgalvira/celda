import type { Compania } from "@celda/dominio/compania";
import type { JSX } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";
import { For, Show } from "solid-js";

import { LogoCompanias } from "../marcadores/LogoCompanias.tsx";

/**
 * Las piezas de la ficha dentro de `PanelEmplazamiento`. La cabecera y su esqueleto comparten
 * contenedor y alturas de línea, así que pasar de «cargando» a la ficha no mueve nada.
 */

const CONTENEDOR_CABECERA =
  "flex flex-col gap-1 border-b border-linea bg-superficie-alta px-5 pr-28 pb-4 md:px-6 md:pt-5 md:pr-28";
const ANTETITULO = "font-mono text-[11px] leading-4 tracking-[0.14em] uppercase";
const TITULO = "font-titulo text-[1.375rem] leading-7 md:text-[1.625rem] md:leading-8";
/**
 * En el resumen de la hoja del móvil, el lugar va en una línea: con el barrio (#13) o un municipio
 * largo partía en dos o tres y la fila de los logos quedaba fuera del resumen.
 */
const LUGAR =
  "font-mono text-xs leading-4 text-tinta-suave max-md:group-data-[altura=resumen]/panel:truncate";
/**
 * La fila de los logos llega por debajo de «Cerrar», que queda a la altura del título: así caben
 * los logos, «Ver el edificio» y el estado sin partirse en dos líneas.
 */
const FILA_LOGOS = "mt-2 -mr-23 flex min-h-10 items-center gap-3 md:-mr-22";

export interface CabeceraFichaProps {
  /** Qué es, en pocas palabras: «Emplazamiento compartido». Puede llevar un `Termino`. */
  readonly antetitulo: JSX.Element;
  readonly titulo: string;
  /** Dónde está: el municipio o el barrio. */
  readonly lugar: string;
  readonly companias: ReadonlyArray<Compania>;
  /** Etiquetas junto a los logos, como el estado. */
  readonly etiquetas?: JSX.Element;
  /** Un botón delante de las etiquetas, como «Ver el edificio» (`BotonEdificio`). */
  readonly accion?: JSX.Element;
}

/** La cabecera de la ficha: lo que se ve con la hoja en el resumen. */
export function CabeceraFicha(props: CabeceraFichaProps) {
  return (
    <header class={CONTENEDOR_CABECERA}>
      <p class={`${ANTETITULO} text-primario-texto`}>{props.antetitulo}</p>
      <h2 class={`${TITULO} max-md:truncate md:line-clamp-2`}>{props.titulo}</h2>
      <p class={LUGAR}>{props.lugar}</p>
      <div class={FILA_LOGOS}>
        <div class="flex">
          <For each={props.companias}>
            {(compania) => (
              <span class="-mr-2 rounded-full ring-3 ring-superficie-alta">
                <LogoCompanias companias={[compania]} tamano={36} />
              </span>
            )}
          </For>
        </div>
        <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
          {props.accion}
          {props.etiquetas}
        </div>
      </div>
    </header>
  );
}

/**
 * La ficha mientras llega: el sitio de cada pieza ya reservado. Lo que dura poco no se ve; si
 * tarda, lo dice, y si tarda mucho, dice por qué puede ser.
 */
export function EsqueletoFicha() {
  return (
    <div aria-busy="true">
      <div class={CONTENEDOR_CABECERA}>
        <output class={`${ANTETITULO} block animate-aparecer text-tinta-suave`}>
          Cargando la ficha…
        </output>
        <div aria-hidden="true" class="flex flex-col gap-1">
          <span class="my-1 block h-5 w-3/4 animate-pulse bg-linea motion-reduce:animate-none md:h-6" />
          <span class="block h-4 w-1/3 bg-linea" />
          <span class={FILA_LOGOS}>
            <span class="size-9 rounded-full bg-linea" />
          </span>
        </div>
      </div>
      <div class="flex flex-col gap-3 px-5 py-4 md:px-6">
        <p class="animate-aparecer-tarde text-sm text-tinta-suave">
          Tarda más de lo normal. Puede que falle la conexión.
        </p>
        <span aria-hidden="true" class="block h-4 w-1/2 bg-linea" />
        <span aria-hidden="true" class="block h-16 bg-linea" />
        <span aria-hidden="true" class="block h-16 bg-linea" />
      </div>
    </div>
  );
}

export interface SeccionFichaProps {
  /** El título en versalitas. Puede llevar un `Termino`. */
  readonly titulo: JSX.Element;
  readonly children: JSX.Element;
}

/**
 * Una sección del cuerpo de la ficha, con su título en versalitas. Mientras queda fuera de la
 * vista, el navegador no la maqueta ni la pinta (`content-visibility: auto`): al abrir la ficha
 * en el móvil solo se ve el resumen, y así la ficha sale antes.
 */
export function SeccionFicha(props: SeccionFichaProps) {
  return (
    <section class="flex flex-col gap-2 px-5 py-4 [content-visibility:auto] [contain-intrinsic-size:auto_10rem] md:px-6">
      <h3 class="font-mono text-[10.5px] tracking-[0.14em] text-tinta-suave uppercase">
        {props.titulo}
      </h3>
      {props.children}
    </section>
  );
}

export interface EstacionFichaProps {
  readonly compania: Compania;
  readonly nombre: string;
  /** Los códigos con que la publica la compañía. */
  readonly codigos: string;
  /** De dónde sale: una `OrigenFicha` por observación. */
  readonly children: JSX.Element;
}

/** Una estación base: la compañía, sus códigos y de dónde sale cada dato. */
export function EstacionFicha(props: EstacionFichaProps) {
  return (
    <article class="flex flex-col gap-1 border-t border-linea pt-3 first:border-t-0 first:pt-0">
      <div class="flex items-center gap-2.5">
        <LogoCompanias companias={[props.compania]} tamano={28} />
        <h4 class="font-semibold">{props.nombre}</h4>
        <span class="ml-auto font-mono text-[11px] text-tinta-suave">{props.codigos}</span>
      </div>
      <ul class="flex flex-col">{props.children}</ul>
    </article>
  );
}

/**
 * La frase que resume el emplazamiento en lenguaje llano (historia 13): lo primero que se lee
 * bajo la cabecera.
 */
export function ResumenFicha(props: { readonly children: JSX.Element }) {
  return (
    <p class="px-5 pt-4 font-titulo text-[1.0625rem] leading-relaxed md:px-6">{props.children}</p>
  );
}

/**
 * Por qué sale este emplazamiento con el filtro de compañías puesto, si es de la red que usa una
 * compañía del filtro (ADR 0026): una nota bajo el resumen, con el borde discontinuo y claro de
 * sus agrupaciones en el mapa.
 */
export function RedUsadaFicha(props: { readonly children: JSX.Element }) {
  return (
    <p class="mx-5 mt-3 border-l-2 border-dashed border-tinta-suave pl-3 text-sm leading-relaxed text-tinta md:mx-6">
      {props.children}
    </p>
  );
}

export const variantesOrigen = cva("flex flex-wrap items-center gap-x-2 text-sm", {
  variants: {
    tono: {
      /** La fuente dice que la estación está. */
      presente: "",
      /** Una corrección: la fuente la da por desmontada. */
      correccion: "text-aviso-tinta",
    },
  },
  defaultVariants: { tono: "presente" },
});

export type OrigenFichaProps = VariantProps<typeof variantesOrigen> & {
  readonly fuente: JSX.Element;
  /** Qué dice y desde cuándo: «lo dice desde el 26 sept 2026». */
  readonly detalle: JSX.Element;
  readonly enlace: string;
  readonly textoEnlace: string;
};

/** Una observación de la que sale un dato: la fuente, desde cuándo lo dice y un enlace. */
export function OrigenFicha(props: OrigenFichaProps) {
  return (
    <li data-tono={props.tono ?? "presente"} class={variantesOrigen({ tono: props.tono })}>
      <span class="font-semibold">{props.fuente}</span>
      <span class="font-mono text-xs text-tinta-suave">{props.detalle}</span>
      <a
        href={props.enlace}
        target="_blank"
        rel="noreferrer"
        class="inline-flex min-h-11 items-center text-primario-texto underline underline-offset-2 hover:text-tinta"
      >
        {props.textoEnlace}
        <span aria-hidden="true">&nbsp;↗</span>
      </a>
    </li>
  );
}

export const variantesMarcaFicha = cva("flex flex-col gap-1 px-5 py-3 md:px-6", {
  variants: {
    tono: {
      /** La ficha no ha cambiado desde el mapa: solo su fecha. */
      "al-dia": "text-tinta-suave",
      /** La ficha ha cambiado después del mapa: se dice, en lugar de contradecirse en silencio. */
      posterior: "bg-aviso-fondo text-aviso-tinta",
    },
  },
  defaultVariants: { tono: "al-dia" },
});

export type MarcaDeAguaFichaProps = VariantProps<typeof variantesMarcaFicha> & {
  readonly titulo: JSX.Element;
  readonly children?: JSX.Element;
};

/** La marca de agua de la ficha: de cuándo son sus datos y si van por delante del mapa. */
export function MarcaDeAguaFicha(props: MarcaDeAguaFichaProps) {
  return (
    <div data-tono={props.tono ?? "al-dia"} class={variantesMarcaFicha({ tono: props.tono })}>
      <p class="flex items-center gap-2 font-mono text-[11px] leading-5 font-semibold tracking-wide">
        <Show when={props.tono === "posterior"}>
          <span aria-hidden="true" class="hexagono size-2.5 shrink-0 bg-aviso" />
        </Show>
        {/* En un solo hijo: el hueco del flex no separa el término de lo que le sigue. */}
        <span>{props.titulo}</span>
      </p>
      <Show when={props.children}>
        <p class="text-sm leading-relaxed">{props.children}</p>
      </Show>
    </div>
  );
}

/** Un aviso dentro del panel, como que la ficha no ha llegado o no existe. Deja libre el botón de cerrar. */
export function AvisoFicha(props: { readonly children: JSX.Element }) {
  return <div class="px-4 pt-14 pb-4 md:px-5 md:pt-16">{props.children}</div>;
}
