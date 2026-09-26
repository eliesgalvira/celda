import type { JSX } from "@solidjs/web";
import { cva } from "class-variance-authority";
import { createUniqueId, For, Show } from "solid-js";

import { Etiqueta } from "../Etiqueta.tsx";

/**
 * El diagrama de radiación de los sectores de un emplazamiento (historias 15 y 16), como el
 * diagrama polar del prototipo v6: el borde es 0 dB y el centro, la atenuación máxima. Siempre
 * lleva la etiqueta de modelo con su versión y dice si la orientación es estimada o supuesta.
 */

const TAMANO = 300;
const CENTRO = TAMANO / 2;
const RADIO = CENTRO - 26;
/** Anillos de referencia, en dB. */
const ANILLOS = [0, -10, -20] as const;
const CARDINALES = ["N", "E", "S", "O"] as const;

/** Punto a `r` del centro en el rumbo dado (grados desde el norte hacia el este). */
const punto = (rumbo: number, r: number): readonly [number, number] => {
  const radianes = (rumbo * Math.PI) / 180;
  return [CENTRO + r * Math.sin(radianes), CENTRO - r * Math.cos(radianes)];
};

/** Radio de una ganancia en dB: el borde es 0 dB y el centro, `−maxima`. */
const radioDe = (ganancia: number, maxima: number): number =>
  RADIO * Math.max(0, 1 + ganancia / maxima);

/**
 * El rumbo más alejado de todos los ejes: el centro del hueco más ancho entre sectores. Ahí se
 * escriben los dB de los anillos, para que no pisen el rumbo de ningún sector.
 */
export const rumboLibre = (azimuts: ReadonlyArray<number>): number => {
  const ordenados = azimuts.map((a) => ((a % 360) + 360) % 360).sort((a, b) => a - b);
  const primero = ordenados[0] ?? 0;
  const huecos = ordenados.map((desde, i) => ({
    desde,
    hueco: (ordenados[i + 1] ?? primero + 360) - desde,
  }));
  const mayor = huecos.reduce((a, b) => (b.hueco > a.hueco ? b : a), { desde: 0, hueco: 0 });
  return (mayor.desde + mayor.hueco / 2) % 360;
};

/** Texto sobre el dibujo, con un halo del color del panel para que se lea encima de las líneas. */
const TEXTO_CON_HALO =
  "font-mono stroke-superficie stroke-[3px] [paint-order:stroke] [stroke-linejoin:round]";

const hexagono = (cx: number, cy: number, r: number): string =>
  [0, 1, 2, 3, 4, 5]
    .map((i) => {
      const a = ((60 * i - 90) * Math.PI) / 180;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(" ");

export const variantesLobulo = cva("stroke-[1.1]", {
  variants: {
    orientacion: {
      /** Orientación estimada: trazo continuo. */
      estimada: "",
      /** Orientación supuesta: trazo discontinuo, porque no sale de ningún dato. */
      supuesta: "[stroke-dasharray:4_3]",
    },
    destacado: {
      true: "fill-primario/30 stroke-primario stroke-[1.8]",
      false: "fill-tinta/8 stroke-tinta/45",
    },
  },
  defaultVariants: { orientacion: "estimada", destacado: false },
});

/** Un sector ya calculado. */
export interface LobuloSector {
  /** Hacia dónde apunta, en grados desde el norte. */
  readonly azimut: number;
  /** Lo que se escribe sobre su eje, como «120°» o «120° ±15°». */
  readonly etiqueta: string;
  /** Ganancia en dB hacia cada rumbo de `rumbos`. */
  readonly ganancia: ArrayLike<number>;
}

export interface LobulosSectorProps {
  /** Rumbos en grados, en orden, de la vuelta completa. */
  readonly rumbos: ArrayLike<number>;
  readonly sectores: ReadonlyArray<LobuloSector>;
  readonly orientacion: "estimada" | "supuesta";
  /** Margen de la orientación en grados, si es una estimación: se dibuja a los dos lados del eje. */
  readonly margen?: number | undefined;
  /** El índice del sector que se resalta, si hay uno. */
  readonly destacado?: number | undefined;
  /** La atenuación en el centro del diagrama, en dB positivos. */
  readonly atenuacionMaxima: number;
}

/** Los lóbulos de los sectores, dentro de `DiagramaRadiacion`. */
export function LobulosSector(props: LobulosSectorProps) {
  const trazo = (ganancia: ArrayLike<number>): string => {
    const puntos = Array.from(props.rumbos, (rumbo, i) =>
      punto(rumbo, radioDe(ganancia[i] ?? -props.atenuacionMaxima, props.atenuacionMaxima)),
    );
    return `${puntos.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join("")}Z`;
  };
  return (
    <g data-sectores={props.sectores.length}>
      <For each={props.sectores}>
        {(sector, k) => (
          <g>
            <Show when={props.margen}>
              {(margen) => (
                <For each={[-margen(), margen()]}>
                  {(desvio) => {
                    const [x, y] = punto(sector.azimut + desvio, RADIO);
                    return (
                      <line x1={CENTRO} y1={CENTRO} x2={x} y2={y} class="stroke-primario/25" />
                    );
                  }}
                </For>
              )}
            </Show>
            <path
              d={trazo(sector.ganancia)}
              data-destacado={props.destacado === k() ? "si" : "no"}
              class={variantesLobulo({
                orientacion: props.orientacion,
                destacado: props.destacado === k(),
              })}
            />
            <text
              x={punto(sector.azimut, RADIO * 0.62)[0]}
              y={punto(sector.azimut, RADIO * 0.62)[1] + 3.5}
              text-anchor="middle"
              class={`${TEXTO_CON_HALO} fill-tinta-suave text-[10px]`}
            >
              {sector.etiqueta}
            </text>
          </g>
        )}
      </For>
    </g>
  );
}

/** Lo que ocupa el sitio de los lóbulos mientras se calculan: nada, y un aviso si tarda. */
export function CalculandoDiagrama() {
  return (
    <text
      x={CENTRO}
      y={CENTRO - RADIO * 0.45}
      text-anchor="middle"
      class="animate-aparecer fill-tinta-suave font-mono text-[10px]"
    >
      Calculando el modelo…
    </text>
  );
}

export interface DiagramaRadiacionProps {
  /** Nombre accesible del diagrama. */
  readonly titulo: string;
  /** Lo que enseña el diagrama, en una o dos frases, para quien no lo ve. */
  readonly descripcion: string;
  /** Qué modelo es y su versión, como «diagrama-sector v1». */
  readonly modelo: string;
  /** Una línea por sector bajo el diagrama, como «Sector 1 · 0°». */
  readonly leyenda: ReadonlyArray<string>;
  /** De dónde sale la forma y la orientación. */
  readonly notas: ReadonlyArray<string>;
  /** La atenuación en el centro del diagrama, en dB positivos. */
  readonly atenuacionMaxima: number;
  /** Hacia dónde apuntan los sectores, en grados: los dB se escriben lejos de ellos. */
  readonly azimuts: ReadonlyArray<number>;
  /** Los lóbulos, o lo que ocupa su sitio mientras se calculan. */
  readonly children: JSX.Element;
}

/**
 * El marco del diagrama: etiqueta de modelo, ejes en dB, rumbos y leyenda. Los lóbulos llegan
 * como hijos, así que el marco ya ocupa su sitio mientras el Worker calcula.
 */
export function DiagramaRadiacion(props: DiagramaRadiacionProps) {
  const id = createUniqueId();
  const escala = (db: number) =>
    punto(rumboLibre(props.azimuts), radioDe(db, props.atenuacionMaxima) - 7);
  return (
    <figure class="flex flex-col items-center gap-3">
      <div class="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <Etiqueta tono="modelo">Modelo</Etiqueta>
        <span class="font-mono text-[11px] text-tinta-suave">{props.modelo}</span>
      </div>
      <svg
        viewBox={`0 0 ${TAMANO} ${TAMANO}`}
        // Un dibujo SVG se anuncia como imagen con role="img"; un <img> no tendría sus <title> y <desc>.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="img"
        aria-labelledby={`${id}-titulo`}
        aria-describedby={`${id}-descripcion`}
        class="block aspect-square h-auto w-full max-w-[18.75rem]"
      >
        <title id={`${id}-titulo`}>{props.titulo}</title>
        <desc id={`${id}-descripcion`}>{props.descripcion}</desc>
        <For each={ANILLOS}>
          {(db) => (
            <g>
              <circle
                cx={CENTRO}
                cy={CENTRO}
                r={radioDe(db, props.atenuacionMaxima)}
                class={
                  db === 0
                    ? "fill-none stroke-tinta/20"
                    : "fill-none stroke-tinta/12 [stroke-dasharray:2_3]"
                }
              />
              <text
                x={escala(db)[0]}
                y={escala(db)[1] + 3}
                text-anchor="middle"
                class={`${TEXTO_CON_HALO} fill-tinta-suave text-[9px]`}
              >
                {db === 0 ? "0 dB" : `−${-db} dB`}
              </text>
            </g>
          )}
        </For>
        <For each={Array.from({ length: 12 }, (_, i) => i * 30)}>
          {(rumbo) => {
            const [x1, y1] = punto(rumbo, RADIO);
            const [x2, y2] = punto(rumbo, RADIO + (rumbo % 90 === 0 ? 6 : 3));
            return <line x1={x1} y1={y1} x2={x2} y2={y2} class="stroke-tinta-suave" />;
          }}
        </For>
        <For each={CARDINALES}>
          {(letra, i) => {
            const [x, y] = punto(i() * 90, RADIO + 15);
            return (
              <text
                x={x}
                y={y + 4}
                text-anchor="middle"
                class="fill-tinta font-mono text-[11px] font-semibold"
              >
                {letra}
              </text>
            );
          }}
        </For>
        {props.children}
        <polygon points={hexagono(CENTRO, CENTRO, 7)} class="fill-tinta" />
      </svg>
      <figcaption class="flex w-full flex-col gap-2">
        <ul class="flex flex-wrap justify-center gap-x-4 gap-y-1 font-mono text-xs">
          <For each={props.leyenda}>{(linea) => <li>{linea}</li>}</For>
        </ul>
        <For each={props.notas}>
          {(nota) => <p class="text-center text-xs leading-relaxed text-tinta-suave">{nota}</p>}
        </For>
      </figcaption>
    </figure>
  );
}
