import type { Compania } from "@celda/dominio/compania";
import { For, Match, Show, Switch } from "solid-js";

/**
 * Logos de las compañías. Son aproximaciones dibujadas a mano a partir de los prototipos, no los
 * logos oficiales; qué permite usar cada marca está pendiente (ver `docs/patterns/ui.md`).
 */

const RELLENO: Readonly<Record<Compania, string>> = {
  movistar: "fill-movistar",
  vodafone: "fill-vodafone",
  orange: "fill-orange",
  digi: "fill-digi",
  yoigo: "fill-yoigo",
};

/** El dibujo blanco de cada compañía sobre su color, en un lienzo de 40 × 40. */
function Glifo(props: { readonly compania: Compania }) {
  return (
    <Switch>
      <Match when={props.compania === "movistar"}>
        <path
          d="M11,27 C11,17 13.5,13.5 15.8,13.5 C18.4,13.5 19.3,18 20,22 C20.7,18 21.6,13.5 24.2,13.5 C26.5,13.5 29,17 29,27"
          fill="none"
          class="stroke-compania-tinta"
          stroke-width="3.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </Match>
      <Match when={props.compania === "vodafone"}>
        <circle cx="20" cy="20" r="10.5" class="fill-compania-tinta" />
        <path
          d="M22.4,12.6 C17.6,13.4 14.9,17 15.1,20.9 C15.3,24.6 18.1,27.2 21.1,27.2 C24.2,27.2 26.3,25 26.3,22.1 C26.3,19 24.1,17.4 21.8,17.1 C21.4,15.7 21.6,14 22.4,12.6Z"
          class="fill-vodafone"
        />
      </Match>
      <Match when={props.compania === "orange"}>
        <rect x="12" y="13" width="7" height="1.6" class="fill-compania-tinta" />
        <text
          x="20"
          y="25"
          text-anchor="middle"
          font-family="Helvetica,Arial,sans-serif"
          font-weight="700"
          font-size="7.4"
          class="fill-compania-tinta"
        >
          orange
        </text>
      </Match>
      <Match when={props.compania === "digi"}>
        <text
          x="20"
          y="23.6"
          text-anchor="middle"
          font-family="Arial Black,Arial,sans-serif"
          font-weight="900"
          font-size="10"
          letter-spacing=".4"
          class="fill-compania-tinta"
        >
          DIGI
        </text>
      </Match>
      <Match when={props.compania === "yoigo"}>
        <text
          x="20"
          y="24"
          text-anchor="middle"
          font-family="Helvetica,Arial,sans-serif"
          font-weight="700"
          font-size="9"
          class="fill-compania-tinta"
        >
          yoigo
        </text>
      </Match>
    </Switch>
  );
}

interface Porcion {
  readonly compania: Compania;
  /** Trazo del sector circular. */
  readonly d: string;
  /** Dónde va el glifo, reducido, dentro del sector. */
  readonly glifo: string;
  /** Radio blanco que separa este sector del anterior. */
  readonly borde: { readonly x: number; readonly y: number };
}

const punto = (angulo: number, radio: number) => ({
  x: Number((20 + radio * Math.cos(angulo)).toFixed(2)),
  y: Number((20 + radio * Math.sin(angulo)).toFixed(2)),
});

/** Un sector por compañía, empezando arriba a la izquierda, como en los prototipos. */
const porciones = (companias: ReadonlyArray<Compania>): ReadonlyArray<Porcion> => {
  const n = companias.length;
  const inicio = (-Math.PI * 3) / 4;
  const paso = (2 * Math.PI) / n;
  return companias.map((compania, k) => {
    const a1 = inicio + k * paso;
    const a2 = a1 + paso;
    const desde = punto(a1, 19);
    const hasta = punto(a2, 19);
    const centro = punto((a1 + a2) / 2, n === 2 ? 8.5 : 10.5);
    const escala = n === 2 ? 0.55 : 0.46;
    return {
      compania,
      d: `M20,20 L${desde.x},${desde.y} A19,19 0 ${paso > Math.PI ? 1 : 0} 1 ${hasta.x},${hasta.y}Z`,
      glifo: `translate(${centro.x},${centro.y}) scale(${escala}) translate(-20,-20)`,
      borde: desde,
    };
  });
};

export interface LogoCompaniasProps {
  /** Compañías del emplazamiento, en el orden en que se reparten el círculo. */
  readonly companias: ReadonlyArray<Compania>;
  /** Lado en píxeles. */
  readonly tamano: number;
}

/** El dibujo del logo en un lienzo de 40 × 40, sin el `<svg>` que lo contiene. */
function DibujoLogo(props: { readonly companias: ReadonlyArray<Compania> }) {
  return (
    <>
      <Switch>
        <Match when={props.companias.length === 0}>
          <circle cx="20" cy="20" r="19" class="fill-tinta-suave" />
        </Match>
        <Match when={props.companias.length === 1 ? props.companias[0] : undefined}>
          {(compania) => (
            <>
              <circle cx="20" cy="20" r="19" class={RELLENO[compania()]} />
              <Glifo compania={compania()} />
            </>
          )}
        </Match>
        <Match when={props.companias.length > 1}>
          <For each={porciones(props.companias)}>
            {(porcion) => (
              <>
                <path d={porcion.d} class={RELLENO[porcion.compania]} />
                <g transform={porcion.glifo}>
                  <Glifo compania={porcion.compania} />
                </g>
              </>
            )}
          </For>
          <For each={porciones(props.companias)}>
            {(porcion) => (
              <line
                x1="20"
                y1="20"
                x2={porcion.borde.x}
                y2={porcion.borde.y}
                class="stroke-compania-tinta"
                stroke-width="1.2"
              />
            )}
          </For>
        </Match>
      </Switch>
      <Show when={props.companias.length > 0}>
        <circle
          cx="20"
          cy="20"
          r="19"
          fill="none"
          class="stroke-compania-tinta"
          stroke-width="1.6"
        />
      </Show>
    </>
  );
}

/**
 * El logo de un emplazamiento: el de su compañía o, si es compartido, un círculo repartido en
 * porciones con el logo de cada una (historia 3). Es decorativo; el nombre lo pone quien lo usa.
 */
export function LogoCompanias(props: LogoCompaniasProps) {
  return (
    <svg
      width={props.tamano}
      height={props.tamano}
      viewBox="0 0 40 40"
      aria-hidden="true"
      class="block shrink-0"
    >
      <DibujoLogo companias={props.companias} />
    </svg>
  );
}

/** Identificador del símbolo de una combinación de compañías en `SimbolosDeLogos`. */
export const idDeLogo = (companias: ReadonlyArray<Compania>): string =>
  companias.length === 0 ? "celda-logo-ninguna" : `celda-logo-${companias.join("-")}`;

/**
 * Un símbolo SVG por combinación de compañías, dibujado una sola vez. Cada marcador lo usa con
 * `<use>`: con cientos de marcadores en pantalla, eso son cuatro nodos por marcador en lugar de
 * una veintena.
 */
export function SimbolosDeLogos(props: {
  readonly combinaciones: ReadonlyArray<ReadonlyArray<Compania>>;
}) {
  return (
    <svg aria-hidden="true" class="absolute size-0 overflow-hidden">
      <For each={props.combinaciones}>
        {(companias) => (
          <symbol id={idDeLogo(companias)} viewBox="0 0 40 40">
            <DibujoLogo companias={companias} />
          </symbol>
        )}
      </For>
    </svg>
  );
}
