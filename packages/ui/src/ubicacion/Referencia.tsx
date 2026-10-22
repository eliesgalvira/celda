import type { JSX } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";
import { Show } from "solid-js";

/** El punto de referencia en la ficha del emplazamiento: sin punto, esperando o con punto. */
export function SeccionReferencia(props: { readonly children: JSX.Element }) {
  return (
    <section
      aria-label="Punto de referencia"
      class="flex flex-col border-b border-linea px-5 py-3 md:px-6"
    >
      {props.children}
    </section>
  );
}

export interface SinReferenciaProps {
  readonly titulo: string;
  /** Una línea bajo el título, si hace falta. Puede llevar términos. */
  readonly texto?: JSX.Element;
  /** Por qué no se puede usar la ubicación ahora, y qué hacer. */
  readonly aviso?: string | undefined;
  readonly acciones: JSX.Element;
}

/** Sin punto de referencia: cómo darlo y, si la ubicación falla, por qué (historias 23 y 25). */
export function SinReferencia(props: SinReferenciaProps) {
  return (
    <div class="flex flex-col gap-2 bg-superficie-alta px-4 py-3">
      <h3 class="font-titulo text-lg leading-6">{props.titulo}</h3>
      <Show when={props.texto}>
        <p class="text-sm leading-relaxed">{props.texto}</p>
      </Show>
      <Show when={props.aviso}>
        {(aviso) => (
          <p class="border-l-3 border-aviso bg-aviso-fondo px-3 py-1.5 text-sm leading-relaxed text-aviso-tinta">
            {aviso()}
          </p>
        )}
      </Show>
      <div class="flex flex-wrap gap-2">{props.acciones}</div>
    </div>
  );
}

/** Mientras llega la ubicación: lo dice y deja cancelar. */
export function EsperandoReferencia(props: {
  readonly texto: string;
  readonly acciones: JSX.Element;
}) {
  return (
    <div aria-busy="true" class="flex flex-wrap items-center justify-between gap-2">
      <output class="flex items-center gap-2 font-mono text-xs text-tinta-suave">
        <span
          aria-hidden="true"
          class="hexagono size-3 animate-pulse bg-primario motion-reduce:animate-none"
        />
        {props.texto}
      </output>
      <div class="flex gap-1">{props.acciones}</div>
    </div>
  );
}

const variantesMarcaReferencia = cva("hexagono mt-0.5 h-4 w-3.5 shrink-0", {
  variants: {
    tipo: {
      gps: "bg-superficie-invertida",
      elegido: "bg-referencia",
    },
  },
});

export type ConReferenciaProps = VariantProps<typeof variantesMarcaReferencia> & {
  /** Desde dónde se mira: «tu ubicación (±25 m)» o «el punto elegido». Puede llevar términos. */
  readonly desde: JSX.Element;
  /** Si la distancia es aproximada por el margen del GPS. Puede llevar términos. */
  readonly margen?: JSX.Element | undefined;
  /** Cambiar y quitar el punto (historia 33). */
  readonly acciones: JSX.Element;
};

/** Con punto de referencia: desde dónde se mira y, con el GPS, si la distancia es aproximada. */
export function ConReferencia(props: ConReferenciaProps) {
  return (
    <div data-tipo={props.tipo ?? "gps"} class="flex flex-col gap-1.5">
      <div class="flex flex-wrap items-center justify-between gap-x-2">
        <p class="flex items-center gap-2 font-mono text-xs text-tinta-suave">
          <span aria-hidden="true" class={variantesMarcaReferencia({ tipo: props.tipo })} />
          <span>
            Desde: <strong class="font-semibold text-tinta">{props.desde}</strong>
          </span>
        </p>
        <div class="flex">{props.acciones}</div>
      </div>
      <Show when={props.margen}>
        <p class="text-xs leading-snug text-tinta-suave">{props.margen}</p>
      </Show>
    </div>
  );
}
