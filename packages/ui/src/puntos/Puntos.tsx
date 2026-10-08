import type { Compania } from "@celda/dominio/compania";
import type { JSX } from "@solidjs/web";
import { Portal } from "@solidjs/web";
import { Show } from "solid-js";

import { type Salto, trasladoDeLamina } from "../marcadores/Deslizable.tsx";
import { LogoCompanias } from "../marcadores/LogoCompanias.tsx";

/**
 * Las piezas de la vista de puntos que no van en el mapa (ADR 0028): los iconos de sus controles en
 * «Funciones» y la lista de los emplazamientos que se ven, el camino para llegar a uno con el
 * teclado o con un lector de pantalla.
 */

/** El icono de «Vista agrupada»: un hexágono con unos puntos dentro, como una agrupación. */
export function IconoVistaAgrupada() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none">
      <path
        d="M10 1.5 17.4 5.75v8.5L10 18.5 2.6 14.25v-8.5Z"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <circle cx="7.4" cy="8.4" r="1.5" fill="currentColor" />
      <circle cx="12.6" cy="8.4" r="1.5" fill="currentColor" />
      <circle cx="10" cy="12.8" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** El icono de la lista de emplazamientos: tres puntos con su línea. */
export function IconoListaDeEmplazamientos() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none">
      <circle cx="3.5" cy="4.5" r="2" fill="currentColor" />
      <circle cx="3.5" cy="10" r="2" fill="currentColor" />
      <circle cx="3.5" cy="15.5" r="2" fill="currentColor" />
      <path d="M8 4.5h10M8 10h10M8 15.5h10" stroke="currentColor" stroke-width="2" />
    </svg>
  );
}

/**
 * La lista de los emplazamientos que se ven. `resumen` dice cuántos son, y si van todos o solo los
 * más cercanos al centro; sin ninguno, `children` va vacío y `resumen` dice qué hacer.
 */
export function ListaDeEmplazamientos(props: {
  readonly resumen: string;
  readonly children?: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-3">
      <p class="text-sm text-tinta-suave">{props.resumen}</p>
      <ul class="flex flex-col gap-1.5">{props.children}</ul>
    </div>
  );
}

/**
 * Un emplazamiento de la lista: un botón de 44 px de alto como mínimo con su logo, sus compañías y
 * dónde queda. El nombre accesible es el texto que se ve. Los de la red usada van con el logo
 * más claro, como su marcador (ADR 0026).
 */
export function FilaDeEmplazamiento(props: {
  readonly companias: ReadonlyArray<Compania>;
  /** Sus compañías, escritas: «Movistar y Orange». */
  readonly nombre: string;
  /** Dónde queda: «a 230 m al noreste del centro». */
  readonly detalle: string;
  /** Lo que dice si es de la red usada: «Red de Movistar que usa Digi». */
  readonly redUsada?: string | undefined;
  readonly alElegir: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        class="flex min-h-11 w-full items-center gap-3 bg-superficie-alta px-3 py-2 text-left shadow-[inset_0_0_0_1.5px_var(--linea)] transition-colors duration-150 hover:bg-control-hover active:bg-primario-activo active:text-primario-fg"
        onClick={() => props.alElegir()}
      >
        <span
          class={props.redUsada === undefined ? "shrink-0" : "shrink-0 scale-[0.82] opacity-55"}
        >
          <LogoCompanias companias={props.companias} tamano={28} />
        </span>
        <span class="flex min-w-0 flex-col">
          <span class="font-semibold">{props.nombre}</span>
          <span class="text-sm text-tinta-suave">
            {props.detalle}
            <Show when={props.redUsada}>{(texto) => <> · {texto()}</>}</Show>
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * La lámina de los puntos que se mueven en el paso entre la vista de puntos y los logos (ADR
 * 0028): dentro del contenedor del mapa, bajo los marcadores, que se montan después. No recoge
 * gestos y el lector de pantalla no la lee: los puntos del mapa tampoco se leen. Se desplaza con
 * la de los marcadores.
 */
export function CapaDeTraspaso(props: {
  readonly contenedor: HTMLElement;
  readonly salto: Salto;
  readonly children: JSX.Element;
}) {
  return (
    <Portal mount={props.contenedor}>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 will-change-transform"
        style={{ transform: trasladoDeLamina(props.salto) }}
      >
        {props.children}
      </div>
    </Portal>
  );
}

/**
 * Hacia dónde anima cada sentido: `va` sale de su sitio y avanza hasta su marcador apagándose, y
 * `viene` hace lo contrario. El principio va en `@starting-style` y el final en la clase: un estilo
 * en línea ganaría también a `@starting-style`, y el punto no se movería. Si el sentido cambia a
 * mitad, la transición da la vuelta desde donde esté.
 */
const SENTIDOS = {
  va: "[--traspaso-avance:1] [--traspaso-luz:0] starting:[--traspaso-avance:0] starting:[--traspaso-luz:1]",
  viene:
    "[--traspaso-avance:0] [--traspaso-luz:1] starting:[--traspaso-avance:1] starting:[--traspaso-luz:0]",
} as const;

/**
 * Un punto del paso entre los puntos y los logos, igual que los que dibuja el mapa: del mismo
 * color, tamaño y opacidad. Con `va`, sale de su sitio hacia `marcador` (el hexágono que lo recoge,
 * o su propio logo) y se apaga; con `viene`, sale de ahí y se queda en su sitio. Usa la curva de
 * los logos. Quien lo usa le pasa su sitio y su marcador cada vez que cambia el zoom: lo que se
 * anima es solo cuánto ha avanzado (la utilidad `traspaso`), así que va siempre entre los dos
 * aunque el zoom cambie a mitad. Con la preferencia de reducir movimiento no se monta.
 */
export function PuntoDeTraspaso(props: {
  /** Dónde está su emplazamiento en la lámina. */
  readonly x: number;
  readonly y: number;
  /** Dónde está su marcador respecto a su emplazamiento. */
  readonly marcador: Salto;
  readonly sentido: "va" | "viene";
  readonly diametro: number;
  readonly opacidad: number;
}) {
  return (
    <span
      class="absolute top-0 left-0 block"
      style={{
        width: `${props.diametro.toFixed(2)}px`,
        height: `${props.diametro.toFixed(2)}px`,
        transform: `translate(${(props.x - props.diametro / 2).toFixed(1)}px, ${(props.y - props.diametro / 2).toFixed(1)}px)`,
      }}
    >
      <span
        class={`traspaso block size-full rounded-full motion-reduce:transition-none ${SENTIDOS[props.sentido]}`}
        style={{
          background: "var(--mapa-punto)",
          "--traspaso-x": `${props.marcador.x.toFixed(1)}px`,
          "--traspaso-y": `${props.marcador.y.toFixed(1)}px`,
          "--traspaso-opacidad": props.opacidad.toFixed(3),
        }}
      />
    </span>
  );
}
