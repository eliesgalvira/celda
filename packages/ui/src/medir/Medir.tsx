import type { JSX } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";
import { For, Show } from "solid-js";

/**
 * Piezas del paso de medir la señal: el código del modo de información, los pasos, las opciones
 * en un ordenador y la medida de ejemplo con sus valores explicados.
 */

export const variantesNota = cva("flex flex-col gap-1 px-4 py-3", {
  variants: {
    tono: {
      /** Algo no se puede hacer aquí: qué, por qué y qué hacer. */
      aviso: "bg-aviso-fondo text-aviso-tinta shadow-[inset_3px_0_0_var(--aviso)]",
      /** Una aclaración que conviene leer, sin alarmar. */
      info: "bg-superficie-alta text-tinta shadow-[inset_3px_0_0_var(--primario)]",
    },
  },
  defaultVariants: { tono: "info" },
});

export type NotaProps = VariantProps<typeof variantesNota> & {
  readonly titulo?: string;
  readonly children: JSX.Element;
};

/** Un recuadro de texto dentro de un diálogo o un panel. No se anuncia: está ahí desde el principio. */
export function Nota(props: NotaProps) {
  return (
    <div data-tono={props.tono ?? "info"} class={variantesNota({ tono: props.tono })}>
      <Show when={props.titulo}>
        <p class="text-base font-semibold">{props.titulo}</p>
      </Show>
      <div class="flex flex-col gap-1.5">{props.children}</div>
    </div>
  );
}

export interface CodigoDelModoProps {
  /** El código que hay que marcar, o nada si aún no se sabe cuál. */
  readonly codigo: string | undefined;
  /** Lo que se lee en el mismo sitio mientras no hay código. */
  readonly vacio: string;
}

/**
 * El código del modo de información, grande y en monoespaciada para copiarlo a mano. Ocupa lo
 * mismo con código o sin él: elegir la marca no mueve el resto.
 */
export function CodigoDelModo(props: CodigoDelModoProps) {
  return (
    <p
      data-vacio={props.codigo === undefined ? "" : undefined}
      class={
        "my-1 flex min-h-14 items-center bg-superficie-alta px-4 shadow-[inset_0_0_0_1.5px_var(--linea-fuerte)] " +
        "font-mono text-2xl font-semibold tracking-wider text-tinta break-all " +
        "data-vacio:font-texto data-vacio:text-sm data-vacio:font-normal data-vacio:tracking-normal data-vacio:text-tinta-suave"
      }
    >
      {props.codigo ?? props.vacio}
    </p>
  );
}

/** Lista numerada de pasos. Cada hijo es un `Paso`. */
export function Pasos(props: { readonly children: JSX.Element }) {
  return <ol class="flex flex-col gap-4">{props.children}</ol>;
}

export interface PasoProps {
  readonly numero: number;
  readonly titulo: string;
  readonly children?: JSX.Element;
  /** Botones o enlaces del paso, como el de la página oficial a la que lleva. */
  readonly acciones?: JSX.Element;
}

/** Un paso con su número en un hexágono. */
export function Paso(props: PasoProps) {
  return (
    <li class="grid grid-cols-[2rem_1fr] gap-x-3">
      <span
        aria-hidden="true"
        class="hexagono grid h-8 w-7 place-items-center bg-superficie-invertida font-mono text-sm font-semibold text-tinta-invertida"
      >
        {props.numero}
      </span>
      <div class="flex min-w-0 flex-col gap-1.5">
        <p class="pt-1 font-semibold">{props.titulo}</p>
        {props.children}
        <Show when={props.acciones}>
          <div class="flex flex-wrap gap-x-4">{props.acciones}</div>
        </Show>
      </div>
    </li>
  );
}

/** Lista de frases cortas con viñeta hexagonal. */
export function Puntos(props: { readonly children: JSX.Element }) {
  return (
    <ul class="flex flex-col gap-2 [&>li]:relative [&>li]:pl-4 [&>li]:before:absolute [&>li]:before:top-[0.55em] [&>li]:before:left-0 [&>li]:before:size-1.5 [&>li]:before:bg-primario [&>li]:before:[clip-path:var(--hexagono)]">
      {props.children}
    </ul>
  );
}

export interface OpcionProps {
  readonly titulo: string;
  readonly children: JSX.Element;
  /** Una marca junto al título, como «PRONTO». */
  readonly etiqueta?: JSX.Element;
  /** Lo que va al lado del texto en escritorio y debajo en el móvil, como un código QR. */
  readonly lado?: JSX.Element;
  /** Botones o enlaces de la opción. */
  readonly acciones?: JSX.Element;
}

/** Una de las salidas que se ofrecen cuando algo no se puede hacer desde aquí. */
export function Opcion(props: OpcionProps) {
  return (
    <section class="flex flex-col gap-3 bg-superficie-alta px-4 py-3 shadow-[inset_0_0_0_1.5px_var(--linea)] sm:flex-row sm:items-start">
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 class="flex flex-wrap items-center gap-2 text-base font-semibold">
          {props.titulo}
          {props.etiqueta}
        </h3>
        <div class="flex flex-col gap-1.5">{props.children}</div>
        <Show when={props.acciones}>
          <div class="mt-1 flex flex-wrap gap-2">{props.acciones}</div>
        </Show>
      </div>
      {props.lado}
    </section>
  );
}

export interface ValorDeSenal {
  /** Qué es, en lenguaje llano, con el término técnico entre paréntesis. */
  readonly nombre: string;
  readonly valor: string;
  /** Qué quiere decir el valor. */
  /** Lo que quiere decir el valor, si no es evidente. */
  readonly explicacion?: string;
  /** Rayas de cobertura de 0 a 4, para los valores que se pueden puntuar. */
  readonly rayas?: number;
}

/** Rayas de cobertura, como las del móvil. El valor ya se dice en texto; esto solo lo acompaña. */
function Rayas(props: { readonly rayas: number }) {
  return (
    <span aria-hidden="true" class="inline-flex h-4 items-end gap-0.5">
      <For each={[1, 2, 3, 4]}>
        {(raya) => (
          <span
            data-encendida={raya <= props.rayas ? "" : undefined}
            class={
              "w-1 bg-linea-fuerte opacity-40 data-encendida:bg-tinta data-encendida:opacity-100 " +
              ["h-1", "h-2", "h-3", "h-4"][raya - 1]
            }
          />
        )}
      </For>
    </span>
  );
}

export interface MedidaMostradaProps {
  /** La marca que dice de quién es la medida, como la etiqueta «EJEMPLO». */
  readonly etiqueta: JSX.Element;
  readonly titulo: string;
  /** El tono del marco: una medida de ejemplo nunca lleva el de una propia. */
  readonly tipo: "propia" | "ejemplo";
  readonly valores: ReadonlyArray<ValorDeSenal>;
  /** Frases tras los valores, como que es inventada. */
  readonly children?: JSX.Element;
}

/**
 * Una medida con sus valores explicados uno a uno. La de ejemplo lleva el marco y la etiqueta
 * del color de ejemplo, que ningún dato usa (historia 49).
 */
export function MedidaMostrada(props: MedidaMostradaProps) {
  return (
    <section
      data-tipo={props.tipo}
      aria-label={props.titulo}
      class={
        "flex flex-col gap-3 bg-superficie-alta px-4 py-3 shadow-[inset_0_0_0_2px_var(--primario)] " +
        "data-[tipo=ejemplo]:shadow-[inset_0_0_0_2px_var(--ejemplo)]"
      }
    >
      <div class="flex flex-wrap items-center gap-2">
        {props.etiqueta}
        <h3 class="text-base font-semibold">{props.titulo}</h3>
      </div>
      <dl class="flex flex-col">
        <For each={props.valores}>
          {(valor) => (
            <div class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-t border-linea py-2 first:border-t-0 first:pt-0">
              <dt class="font-semibold">{valor.nombre}</dt>
              <dd class="flex items-center justify-end gap-2 font-mono font-semibold whitespace-nowrap">
                <Show when={valor.rayas !== undefined}>
                  <Rayas rayas={valor.rayas ?? 0} />
                </Show>
                {valor.valor}
              </dd>
              <Show when={valor.explicacion}>
                <dd class="col-span-2 text-tinta-suave">{valor.explicacion}</dd>
              </Show>
            </div>
          )}
        </For>
      </dl>
      <Show when={props.children}>
        <div class="flex flex-col gap-1.5">{props.children}</div>
      </Show>
    </section>
  );
}

/** Rayas de cobertura para el botón «Medir mi señal» del mapa. */
export function IconoSenal() {
  return (
    <svg width="20" height="18" viewBox="0 0 20 18" aria-hidden="true" fill="currentColor">
      <rect x="1" y="12" width="3" height="5" />
      <rect x="6" y="8" width="3" height="9" />
      <rect x="11" y="4" width="3" height="13" />
      <rect x="16" y="0" width="3" height="17" />
    </svg>
  );
}
