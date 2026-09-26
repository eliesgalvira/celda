import type { Compania } from "@celda/dominio/compania";
import type { JSX } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";
import { For, Show } from "solid-js";

import { LogoCompanias } from "../marcadores/LogoCompanias.tsx";

/**
 * Las piezas con que la ficha enseña una corrección: lo que dice el registro oficial junto a lo
 * que dice la comunidad (historia 18), y los conflictos entre fuentes, que nunca se esconden.
 */

/** Lo que dice una fuente de una estación base, con su fecha y su enlace si los tiene. */
export interface LadoContraste {
  readonly fuente: string;
  readonly dice: string;
  /** Desde cuándo lo dice: «desde el 26 sept 2026». */
  readonly fecha?: string;
  readonly enlace?: string;
  readonly textoEnlace?: string;
}

export const variantesLado = cva(
  "flex min-w-0 flex-col gap-0.5 border-l-4 bg-superficie-alta px-3 py-2",
  {
    variants: {
      tono: {
        /** El registro oficial: el dato de partida. */
        oficial: "border-linea-fuerte",
        /** La comunidad lo corrige. */
        corregido: "border-corregido",
        /** Solo lo conoce la comunidad. */
        nuevo: "border-nuevo",
      },
    },
    defaultVariants: { tono: "oficial" },
  },
);

type Tono = NonNullable<VariantProps<typeof variantesLado>["tono"]>;

function Lado(props: { readonly lado: LadoContraste; readonly tono: Tono }) {
  return (
    <div data-tono={props.tono} class={variantesLado({ tono: props.tono })}>
      <dt class="font-mono text-[10.5px] leading-4 tracking-[0.14em] text-tinta-suave uppercase">
        {props.lado.fuente}
      </dt>
      <dd class="leading-snug font-semibold">{props.lado.dice}</dd>
      <Show when={props.lado.fecha}>
        {(fecha) => <dd class="font-mono text-xs text-tinta-suave">{fecha()}</dd>}
      </Show>
      <Show when={props.lado.enlace}>
        {(enlace) => (
          <dd>
            <a
              href={enlace()}
              target="_blank"
              rel="noreferrer"
              class="inline-flex min-h-11 items-center text-sm text-primario-texto underline underline-offset-2 hover:text-tinta"
            >
              {/* Texto y flecha en una sola caja: al partirse en dos líneas, la flecha sigue al texto. */}
              <span>
                {props.lado.textoEnlace ?? enlace()}
                <span aria-hidden="true">&nbsp;↗</span>
              </span>
            </a>
          </dd>
        )}
      </Show>
    </div>
  );
}

export interface ContrasteFichaProps {
  readonly tono: "corregido" | "nuevo";
  readonly compania: Compania;
  readonly nombre: string;
  readonly oficial: LadoContraste;
  readonly comunidad: LadoContraste;
}

/**
 * Una estación base en la que las fuentes no coinciden: a la izquierda el registro oficial y a
 * la derecha la comunidad, cada uno con su fecha y su enlace.
 */
export function ContrasteFicha(props: ContrasteFichaProps) {
  return (
    <article data-tono={props.tono} class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <LogoCompanias companias={[props.compania]} tamano={24} />
        <h4 class="font-semibold">{props.nombre}</h4>
      </div>
      <dl aria-label={`Qué dice cada fuente de ${props.nombre}`} class="grid grid-cols-2 gap-2">
        <Lado lado={props.oficial} tono="oficial" />
        <Lado lado={props.comunidad} tono={props.tono} />
      </dl>
    </article>
  );
}

export const variantesNota = cva("", {
  variants: {
    tono: {
      /** Explica qué pasa, en lenguaje llano. */
      texto: "text-sm leading-relaxed",
      /** El crédito de una fuente. */
      credito: "text-xs leading-relaxed text-tinta-suave",
    },
  },
  defaultVariants: { tono: "texto" },
});

export type NotaFichaProps = VariantProps<typeof variantesNota> & {
  readonly children: JSX.Element;
};

/** Un párrafo del cuerpo de la ficha. */
export function NotaFicha(props: NotaFichaProps) {
  return (
    <p data-tono={props.tono ?? "texto"} class={variantesNota({ tono: props.tono })}>
      {props.children}
    </p>
  );
}

/** Los conflictos entre fuentes de un emplazamiento, ya escritos. */
export function ConflictosFicha(props: { readonly conflictos: ReadonlyArray<string> }) {
  return (
    <ul aria-label="Conflictos entre fuentes" class="flex flex-col gap-1.5">
      <For each={props.conflictos}>
        {(conflicto) => (
          <li class="flex gap-2 bg-aviso-fondo px-3 py-2 text-sm leading-snug text-aviso-tinta">
            <span aria-hidden="true" class="hexagono mt-1 size-2.5 shrink-0 bg-aviso" />
            {conflicto}
          </li>
        )}
      </For>
    </ul>
  );
}
