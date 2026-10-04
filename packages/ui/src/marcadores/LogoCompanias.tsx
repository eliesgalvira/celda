import type { Compania } from "@celda/dominio/compania";
import { For, Match, Show, Switch } from "solid-js";

import { DIBUJOS_DE_COMPANIAS, type LogoOficial, type Pintura } from "./logosDeCompanias.ts";

/**
 * Logos de las compañías: el oficial de cada una, como su icono, salvo Yoigo, que va con su
 * nombre. De dónde sale cada uno y por qué, en `logos/FUENTES.md` y en `docs/patterns/ui.md`.
 */

const COLOR: Readonly<Record<Compania, string>> = {
  movistar: "fill-movistar",
  vodafone: "fill-vodafone",
  orange: "fill-orange",
  digi: "fill-digi",
  yoigo: "fill-yoigo",
};

/** El logo oficial de una compañía, si se puede enseñar. */
const logoDe = (compania: Compania): LogoOficial | undefined => {
  const dibujo = DIBUJOS_DE_COMPANIAS[compania];
  return dibujo.tipo === "logo" ? dibujo : undefined;
};

/** El nombre que se escribe en lugar del logo, si no se puede enseñar. */
const nombreDe = (compania: Compania): string | undefined => {
  const dibujo = DIBUJOS_DE_COMPANIAS[compania];
  return dibujo.tipo === "nombre" ? dibujo.texto : undefined;
};

/** La clase que pinta de `pintura` algo de `compania`. */
const claseDePintura = (compania: Compania, pintura: Pintura): string =>
  pintura === "compania" ? COLOR[compania] : "fill-compania-tinta";

/** La clase del círculo o de la porción de una compañía. */
const claseDeFondo = (compania: Compania): string =>
  claseDePintura(compania, logoDe(compania)?.fondo ?? "compania");

/** El logo oficial, centrado en el lienzo de 40 × 40. */
function LogoOficialCentrado(props: { readonly compania: Compania; readonly logo: LogoOficial }) {
  const alto = () => (props.logo.ancho * props.logo.caja[3]) / props.logo.caja[2];
  return (
    <svg
      x={20 - props.logo.ancho / 2}
      y={20 - alto() / 2}
      width={props.logo.ancho}
      height={alto()}
      viewBox={props.logo.caja.join(" ")}
      overflow="hidden"
    >
      <For each={props.logo.trazos}>
        {(trazo) => <path d={trazo.d} class={claseDePintura(props.compania, trazo.pintura)} />}
      </For>
    </svg>
  );
}

/** El dibujo de cada compañía, centrado en un lienzo de 40 × 40. */
function Glifo(props: { readonly compania: Compania }) {
  return (
    <Switch>
      <Match when={logoDe(props.compania)}>
        {(logo) => <LogoOficialCentrado compania={props.compania} logo={logo()} />}
      </Match>
      <Match when={nombreDe(props.compania)}>
        {(nombre) => (
          <text
            x="20"
            y="24"
            text-anchor="middle"
            font-family="Helvetica,Arial,sans-serif"
            font-weight="700"
            font-size="9"
            class="fill-compania-tinta"
          >
            {nombre()}
          </text>
        )}
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
              <circle cx="20" cy="20" r="19" class={claseDeFondo(compania())} />
              <Glifo compania={compania()} />
            </>
          )}
        </Match>
        <Match when={props.companias.length > 1}>
          <For each={porciones(props.companias)}>
            {(porcion) => (
              <>
                <path d={porcion.d} class={claseDeFondo(porcion.compania)} />
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
