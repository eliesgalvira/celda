import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

/** Un bloque de referencia dentro de un plegable de «Mejorar la señal», con su pregunta. */
export function BloqueDeReferencia(props: {
  readonly titulo: string;
  readonly children: JSX.Element;
}) {
  return (
    <section class="flex flex-col gap-2 bg-superficie-alta px-4 pt-3 pb-3.5">
      <h4 class="text-sm font-semibold">{props.titulo}</h4>
      {props.children}
    </section>
  );
}

/** Un párrafo de una referencia. Puede llevar términos. */
export function TextoDeReferencia(props: { readonly children: JSX.Element }) {
  return <p class="text-[13.5px] leading-normal">{props.children}</p>;
}

/** De dónde salen las cifras de una referencia. */
export function FuentesDeReferencia(props: { readonly children: JSX.Element }) {
  return <p class="font-mono text-[11px] leading-snug text-tinta-suave">{props.children}</p>;
}

/** Una fila de la gráfica: un tramo del eje con su etiqueta y su cifra. */
export interface TramoDeGrafica {
  readonly etiqueta: string;
  /** Dónde empieza y dónde acaba el tramo; si es el mismo valor, es un punto. */
  readonly desde: number;
  readonly hasta: number;
  /** El margen que dan las fuentes, más claro y debajo del tramo. */
  readonly margen?: { readonly desde: number; readonly hasta: number };
  /** «8–16 dB». */
  readonly cifra: string;
  /** Lo que sale al pasar por encima de la fila. */
  readonly explicacion: string;
}

/** Una marca del eje, con una línea de texto o dos: «10 dB» y «1/10». */
export interface MarcaDeGrafica {
  readonly valor: number;
  readonly lineas: readonly [string] | readonly [string, string];
}

export interface GraficaDeTramosProps {
  /** Lo que dice entera, para un lector de pantalla. */
  readonly nombre: string;
  /** El valor del final del eje. */
  readonly maximo: number;
  readonly filas: ReadonlyArray<TramoDeGrafica>;
  readonly marcas: ReadonlyArray<MarcaDeGrafica>;
}

const ANCHO = 340;
const ETIQUETAS = 156;
const FILA = 29;
const ARRIBA = 5;
const LINEA_DEL_EJE = 14;
/** Ancho de una letra de la cifra: la letra monoespaciada mide 0,6 em y la cifra, 10,5 px. */
const ANCHO_DE_LETRA = 0.6 * 10.5;
const HUECO = 7;

/**
 * Una gráfica de filas con un tramo cada una sobre un eje lineal, como cuánto se pierde al
 * entrar en un edificio. La cifra va tras el tramo y, si no cabe, delante. Cada fila explica de
 * dónde sale su cifra al pasar por encima.
 */
export function GraficaDeTramos(props: GraficaDeTramosProps) {
  const x = (valor: number) => ETIQUETAS + (valor / props.maximo) * (ANCHO - 6 - ETIQUETAS);
  const lineasDelEje = () => Math.max(...props.marcas.map((marca) => marca.lineas.length));
  const alto = () => ARRIBA + props.filas.length * FILA + 6 + lineasDelEje() * LINEA_DEL_EJE;
  const centro = (indice: number) => ARRIBA + indice * FILA + FILA / 2;
  const fondo = () => ARRIBA + props.filas.length * FILA;
  return (
    <svg
      viewBox={`0 0 ${ANCHO} ${alto()}`}
      width="100%"
      // Un dibujo SVG se anuncia como imagen con role="img"; un <img> no podría usar los tokens.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="img"
      aria-label={props.nombre}
      class="block overflow-visible"
    >
      <For each={props.marcas}>
        {(marca) => (
          <g>
            <line
              x1={x(marca.valor)}
              x2={x(marca.valor)}
              y1={ARRIBA}
              y2={fondo()}
              class="stroke-linea"
            />
            <For each={marca.lineas}>
              {(texto, i) => (
                <text
                  x={x(marca.valor)}
                  y={fondo() + 4 + (i() + 1) * LINEA_DEL_EJE - 3}
                  text-anchor="middle"
                  class={`font-mono text-[10px] ${i() === 0 ? "fill-tinta-suave" : "fill-tinta"}`}
                >
                  {texto}
                </text>
              )}
            </For>
          </g>
        )}
      </For>
      <For each={props.filas}>
        {(fila, i) => {
          const tras = () => x(Math.max(fila.hasta, fila.margen?.hasta ?? 0)) + HUECO;
          const cabe = () => tras() + fila.cifra.length * ANCHO_DE_LETRA <= ANCHO;
          return (
            <g>
              <title>{fila.explicacion}</title>
              <rect
                x="0"
                y={centro(i()) - FILA / 2}
                width={ANCHO}
                height={FILA}
                fill="transparent"
              />
              <text x="0" y={centro(i()) + 4} class="fill-tinta text-[12px]">
                {fila.etiqueta}
              </text>
              <Show when={fila.margen}>
                {(margen) => (
                  <rect
                    x={x(margen().desde)}
                    y={centro(i()) - 5}
                    width={x(margen().hasta) - x(margen().desde)}
                    height="10"
                    rx="5"
                    class="fill-primario/35"
                  />
                )}
              </Show>
              <Show
                when={fila.desde !== fila.hasta}
                fallback={
                  <circle
                    cx={x(fila.desde)}
                    cy={centro(i())}
                    r="5"
                    class="fill-primario stroke-superficie-alta stroke-2"
                  />
                }
              >
                <rect
                  x={x(fila.desde)}
                  y={centro(i()) - 5}
                  width={Math.max(x(fila.hasta) - x(fila.desde), 6)}
                  height="10"
                  rx="5"
                  class="fill-primario"
                />
              </Show>
              <text
                x={cabe() ? tras() : x(fila.desde) - HUECO}
                y={centro(i()) + 3.5}
                text-anchor={cabe() ? "start" : "end"}
                paint-order="stroke"
                class="fill-tinta-suave stroke-superficie-alta stroke-4 font-mono text-[10.5px]"
              >
                {fila.cifra}
              </text>
            </g>
          );
        }}
      </For>
    </svg>
  );
}
