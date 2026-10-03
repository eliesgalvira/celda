import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

/**
 * Las piezas de compartir una aportación con el buzón (ADR 0020 y 0021): qué sale del
 * dispositivo, la dedicación CC0 en el mismo paso y antes de enviar, y la lista de lo que hay en
 * el dispositivo con si se ha compartido.
 */

/** Un dato que sale del dispositivo, con su nombre llano y su valor tal como se envía. */
export interface DatoQueSale {
  readonly nombre: string;
  readonly valor: string;
}

export interface QueSaleProps {
  readonly titulo: string;
  readonly datos: ReadonlyArray<DatoQueSale>;
  /** Frases tras los datos: lo que no sale, o lo que el buzón guarda además. */
  readonly children?: JSX.Element;
}

/** Todo lo que sale del dispositivo al enviar, dato a dato. Lo que no está aquí no se envía. */
export function QueSale(props: QueSaleProps) {
  return (
    <section
      aria-label={props.titulo}
      class="flex flex-col gap-2 bg-superficie-alta px-4 py-3 shadow-[inset_0_0_0_1.5px_var(--linea)]"
    >
      <h3 class="font-semibold">{props.titulo}</h3>
      <dl class="flex flex-col text-sm">
        <For each={props.datos}>
          {(dato) => (
            <div class="flex items-baseline justify-between gap-4 border-t border-linea py-1.5 first:border-t-0">
              <dt class="text-tinta-suave">{dato.nombre}</dt>
              <dd class="min-w-0 text-right font-mono font-semibold break-all">{dato.valor}</dd>
            </div>
          )}
        </For>
      </dl>
      <Show when={props.children}>
        <div class="flex flex-col gap-1.5 text-sm leading-snug text-tinta-suave">
          {props.children}
        </div>
      </Show>
    </section>
  );
}

export interface DedicacionCc0Props {
  /** El texto legal de la dedicación. */
  readonly enlace: string;
  readonly children: JSX.Element;
}

/**
 * La dedicación al dominio público con CC0 1.0. Va en el mismo paso que el botón de enviar y
 * antes de él: quien envía la lee antes, porque no se puede retirar.
 */
export function DedicacionCc0(props: DedicacionCc0Props) {
  return (
    <section
      aria-label="Dedicación al dominio público"
      class="flex flex-col gap-1.5 bg-superficie-alta px-4 py-3 shadow-[inset_3px_0_0_var(--primario)]"
    >
      <p class="flex flex-wrap items-center gap-2 font-semibold">
        <span class="bg-superficie-invertida px-1.5 py-0.5 font-mono text-xs tracking-wider text-tinta-invertida">
          CC0 1.0
        </span>
        Dominio público
      </p>
      <div class="flex flex-col gap-1.5 text-sm leading-snug">{props.children}</div>
      <a
        href={props.enlace}
        target="_blank"
        rel="noreferrer"
        class="inline-flex min-h-11 items-center self-start text-sm text-primario-texto underline underline-offset-2 hover:text-tinta"
      >
        <span>
          Leer la dedicación CC0 1.0
          <span aria-hidden="true">&nbsp;↗</span>
        </span>
      </a>
    </section>
  );
}

/**
 * Dónde sale cómo ha ido el envío. Reserva su sitio desde el principio, así que al llegar la
 * respuesta no se mueven los botones.
 */
export function ResultadoDelEnvio(props: { readonly children?: JSX.Element }) {
  return <div class="min-h-[7.5rem]">{props.children}</div>;
}

/** Una fila de botones al final de un paso: el principal primero. */
export function AccionesDelPaso(props: { readonly children: JSX.Element }) {
  return <div class="flex flex-wrap items-center gap-2">{props.children}</div>;
}

export interface FilaAportacionProps {
  readonly titulo: string;
  /** Una línea con lo esencial: fecha, emplazamiento o valores. */
  readonly detalle: string;
  /** La etiqueta que dice si se ha compartido. */
  readonly estado: JSX.Element;
  readonly acciones?: JSX.Element;
}

/** Una aportación del dispositivo en la lista de «Tus aportaciones». */
export function FilaAportacion(props: FilaAportacionProps) {
  return (
    <li class="flex flex-col gap-2 bg-superficie-alta px-4 py-3 shadow-[inset_0_0_0_1.5px_var(--linea)] sm:flex-row sm:items-center">
      <div class="flex min-w-0 flex-1 flex-col items-start gap-1">
        <p class="font-semibold">{props.titulo}</p>
        <p class="text-sm text-tinta-suave">{props.detalle}</p>
        {props.estado}
      </div>
      <Show when={props.acciones}>
        <div class="flex flex-wrap gap-2">{props.acciones}</div>
      </Show>
    </li>
  );
}

/** La lista de aportaciones de un tipo, con su título. */
export function GrupoDeAportaciones(props: {
  readonly titulo: string;
  readonly children: JSX.Element;
}) {
  return (
    <section aria-label={props.titulo} class="flex flex-col gap-2">
      <h3 class="font-mono text-xs font-semibold tracking-wider text-tinta-suave uppercase">
        {props.titulo}
      </h3>
      <ul class="flex flex-col gap-2">{props.children}</ul>
    </section>
  );
}

/** Lo que dice un grupo sin aportaciones, y cómo crear una. */
export function GrupoVacio(props: { readonly children: JSX.Element }) {
  return (
    <li class="flex flex-col gap-1.5 text-sm leading-snug text-tinta-suave">{props.children}</li>
  );
}

/** Mientras se leen las aportaciones del dispositivo: ocupa lo que ocupará una lista corta. */
export function EsqueletoAportaciones() {
  return (
    <output class="block min-h-24 animate-aparecer text-sm text-tinta-suave">
      Leyendo lo que hay en este dispositivo…
    </output>
  );
}

/** Un buzón con una flecha que entra: el icono de «Tus aportaciones» en los controles del mapa. */
export function IconoAportaciones() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="round"
    >
      <path d="M2 11h4l1.5 3h5L14 11h4v7H2z" />
      <path d="M10 1.5v8M6.5 6l3.5 3.5L13.5 6" />
    </svg>
  );
}
