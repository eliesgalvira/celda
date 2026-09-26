import type { JSX } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";
import { createMemo, createUniqueId, For, Show } from "solid-js";

/**
 * Las piezas de la sección «Mejorar la señal» de la ficha (historias 34 a 37), como en el
 * prototipo v8: los consejos, lo que se gana con un punto de referencia y la brújula para
 * apuntar una antena exterior.
 */

/** Hacia dónde queda el emplazamiento: lo primero que se lee de la sección. */
export function HaciaEmplazamiento(props: { readonly children: JSX.Element }) {
  return <p class="font-titulo text-[1.0625rem] leading-relaxed">{props.children}</p>;
}

/** La lista de consejos. */
export function ListaConsejos(props: { readonly children: JSX.Element }) {
  return <ul class="flex flex-col gap-2">{props.children}</ul>;
}

export const variantesConsejo = cva("flex gap-2.5 text-sm leading-relaxed", {
  variants: {
    tono: {
      principal: "",
      /** Un aparte, como que girar el móvil en la mano apenas cambia nada. */
      secundario: "text-tinta-suave",
    },
  },
  defaultVariants: { tono: "principal" },
});

export type ConsejoProps = VariantProps<typeof variantesConsejo> & {
  /** El consejo. Puede llevar términos. */
  readonly children: JSX.Element;
};

/** Un consejo, con un hexágono pequeño de viñeta. */
export function Consejo(props: ConsejoProps) {
  return (
    <li data-tono={props.tono ?? "principal"} class={variantesConsejo({ tono: props.tono })}>
      <span
        aria-hidden="true"
        class={
          props.tono === "secundario"
            ? "hexagono mt-1.5 h-2.5 w-2 shrink-0 bg-linea-fuerte"
            : "hexagono mt-1.5 h-2.5 w-2 shrink-0 bg-primario"
        }
      />
      <span>{props.children}</span>
    </li>
  );
}

export interface LlamadaPuntoProps {
  /** Qué se ganaría con un punto de referencia. Puede llevar términos. */
  readonly texto: JSX.Element;
  /** Cómo darlo: usar la ubicación o elegir en el mapa. */
  readonly acciones: JSX.Element;
}

/** Sin punto de referencia: qué se ganaría con uno y cómo darlo. */
export function LlamadaPunto(props: LlamadaPuntoProps) {
  return (
    <div class="flex flex-col gap-2 bg-superficie-alta px-4 py-3">
      <p class="text-sm leading-relaxed">{props.texto}</p>
      <div class="flex flex-wrap gap-2">{props.acciones}</div>
    </div>
  );
}

/** Una nota al pie de la sección, como cuánto fiarse de los consejos. Puede llevar términos. */
export function NotaMejorar(props: { readonly children: JSX.Element }) {
  return <p class="text-xs leading-snug text-tinta-suave">{props.children}</p>;
}

const TAMANO = 120;
const CENTRO = TAMANO / 2;
const RADIO = 52;
const CARDINALES = [
  { letra: "N", grados: 0 },
  { letra: "E", grados: 90 },
  { letra: "S", grados: 180 },
  { letra: "O", grados: 270 },
] as const;
const MARCAS = Array.from({ length: 12 }, (_, i) => i * 30);

/** Punto a `r` del centro en el rumbo dado, en grados desde arriba hacia la derecha. */
const punto = (rumbo: number, r: number): readonly [number, number] => {
  const radianes = (rumbo * Math.PI) / 180;
  return [CENTRO + r * Math.sin(radianes), CENTRO - r * Math.cos(radianes)];
};

const hexagono = (cx: number, cy: number, r: number): string =>
  [0, 1, 2, 3, 4, 5]
    .map((i) => {
      const a = ((60 * i - 90) * Math.PI) / 180;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(" ");

/** La diferencia más corta de `desde` a `hasta`, entre −180 y 180. */
const giroCorto = (desde: number, hasta: number): number =>
  ((((hasta - desde) % 360) + 540) % 360) - 180;

export const variantesGuia = cva("font-titulo text-lg leading-6", {
  variants: {
    alineado: {
      true: "font-semibold text-primario-texto",
      false: "text-tinta",
    },
  },
  defaultVariants: { alineado: false },
});

export interface BrujulaProps {
  /** Rumbo del emplazamiento visto desde el punto, en grados desde el norte. */
  readonly objetivo: number;
  /** Hacia dónde apunta el móvil, en grados desde el norte: de la brújula o de la barra. */
  readonly rumbo: number;
  /** De dónde sale `rumbo`. Con la barra, el dibujo lo dice: es una simulación. */
  readonly fuente: "brujula" | "barra";
  /** Nombre accesible del dibujo. */
  readonly titulo: string;
  /** Lo que enseña el dibujo, para quien no lo ve: hacia dónde apunta cada cosa. */
  readonly descripcion: string;
  /** Qué hacer ahora: «Gira 108° a la derecha» o «Apuntando al emplazamiento». */
  readonly guia: string;
  readonly alineado: boolean;
  /** Los dos rumbos en texto: «Móvil 300° · emplazamiento 48°». */
  readonly rumbos: string;
  /** El estado de la brújula y sus controles: botones, la barra o lo que haya que explicar. */
  readonly children: JSX.Element;
}

/**
 * La brújula para apuntar una antena exterior (historias 35 y 36): un dial con el norte, el
 * hexágono del emplazamiento y la flecha que apunta hacia él, con la parte de arriba del móvil
 * siempre arriba. Al lado, qué hacer y los controles. El hueco de los controles está reservado,
 * así que pasar de un estado a otro de la brújula mueve poco la ficha.
 */
export function Brujula(props: BrujulaProps) {
  const id = createUniqueId();
  // Hacia dónde queda el emplazamiento respecto a la parte de arriba del móvil. Se acumula sin
  // saltar de 359° a 0°, para que la transición gire por el camino corto.
  const giro = createMemo<number>((anterior) => {
    const nuevo = props.objetivo - props.rumbo;
    return anterior === undefined ? nuevo : anterior + giroCorto(anterior, nuevo);
  });
  const emplazamiento = () => punto(props.objetivo - props.rumbo, RADIO - 8);
  return (
    <div
      data-fuente={props.fuente}
      class="chaflan grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-4 bg-superficie-alta p-3 [--corte:10px]"
    >
      <svg
        viewBox={`0 0 ${TAMANO} ${TAMANO}`}
        // Un dibujo SVG se anuncia como imagen con role="img"; un <img> no tendría sus <title> y <desc>.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="img"
        aria-labelledby={`${id}-titulo`}
        aria-describedby={`${id}-descripcion`}
        class="block aspect-square h-auto w-full"
      >
        <title id={`${id}-titulo`}>{props.titulo}</title>
        <desc id={`${id}-descripcion`}>{props.descripcion}</desc>
        <circle cx={CENTRO} cy={CENTRO} r={RADIO} class="fill-superficie stroke-tinta/55" />
        <For each={MARCAS}>
          {(grados) => {
            const desde = () => punto(grados - props.rumbo, RADIO);
            const hasta = () => punto(grados - props.rumbo, RADIO - (grados % 90 === 0 ? 7 : 4));
            return (
              <line
                x1={desde()[0]}
                y1={desde()[1]}
                x2={hasta()[0]}
                y2={hasta()[1]}
                class="stroke-tinta-suave"
              />
            );
          }}
        </For>
        <For each={CARDINALES}>
          {(cardinal) => (
            <text
              x={punto(cardinal.grados - props.rumbo, RADIO - 15)[0]}
              y={punto(cardinal.grados - props.rumbo, RADIO - 15)[1] + 3.5}
              text-anchor="middle"
              class={
                cardinal.letra === "N"
                  ? "fill-tinta font-mono text-[10px] font-bold"
                  : "fill-tinta-suave font-mono text-[9px]"
              }
            >
              {cardinal.letra}
            </text>
          )}
        </For>
        {/* La parte de arriba del móvil: siempre arriba. */}
        <polygon points={`${CENTRO - 5},1 ${CENTRO + 5},1 ${CENTRO},8`} class="fill-tinta" />
        <g
          class={
            "origin-center transition-transform duration-200 ease-out [transform-box:view-box] " +
            "motion-reduce:transition-none"
          }
          style={{ transform: `rotate(${giro()}deg)` }}
        >
          <line
            x1={CENTRO}
            y1={CENTRO + 14}
            x2={CENTRO}
            y2={CENTRO - (RADIO - 22)}
            class="stroke-primario stroke-[3]"
          />
          <polygon
            points={`${CENTRO},${CENTRO - (RADIO - 14)} ${CENTRO + 7},${CENTRO - (RADIO - 25)} ${CENTRO - 7},${CENTRO - (RADIO - 25)}`}
            class="fill-primario"
          />
        </g>
        <polygon
          points={hexagono(emplazamiento()[0], emplazamiento()[1], 6.5)}
          class="fill-primario stroke-superficie stroke-[1.5]"
        />
        <circle cx={CENTRO} cy={CENTRO} r={3} class="fill-tinta" />
      </svg>
      <div class="flex min-h-[12.5rem] min-w-0 flex-col gap-1.5">
        <output aria-live="polite" class={variantesGuia({ alineado: props.alineado })}>
          {props.guia}
        </output>
        <p class="font-mono text-xs text-tinta-suave tabular-nums">{props.rumbos}</p>
        {props.children}
      </div>
    </div>
  );
}

/** Un párrafo del estado de la brújula, como para qué se pide el permiso. */
export function TextoBrujula(props: {
  readonly titulo?: string | undefined;
  readonly children: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-0.5">
      <Show when={props.titulo}>{(titulo) => <p class="text-sm font-semibold">{titulo()}</p>}</Show>
      <p class="text-xs leading-snug text-tinta-suave">{props.children}</p>
    </div>
  );
}

/** Los botones del estado de la brújula, en fila. */
export function AccionesBrujula(props: { readonly children: JSX.Element }) {
  return <div class="flex flex-wrap gap-x-2">{props.children}</div>;
}
