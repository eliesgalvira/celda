import type { JSX } from "@solidjs/web";
import { Portal } from "@solidjs/web";
import { cva } from "class-variance-authority";

/** Desplazamiento en píxeles de pantalla respecto a la posición del propio marcador. */
export interface Salto {
  readonly x: number;
  readonly y: number;
}

/** El `transform` de una lámina desplazada `salto` píxeles. */
export const trasladoDeLamina = (salto: Salto): string =>
  `translate(${salto.x.toFixed(1)}px, ${salto.y.toFixed(1)}px)`;

/**
 * Una lámina dentro del contenedor del mapa que se desplaza con la de los marcadores
 * (`CapaDeMarcadores`). No recoge gestos y el lector de pantalla no la lee: lo que lleva repite lo
 * que el mapa ya dice, como los rótulos de ciudad del mapa base o los puntos que se mueven en el
 * paso a los logos (ADR 0028). Queda bajo los marcadores si se monta antes y encima si se monta
 * después.
 */
export function LaminaMuda(props: {
  readonly contenedor: HTMLElement;
  /** Lo que se ha desplazado el mapa desde que se colocó lo que lleva. */
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
 * Cómo aparece o se va un marcador cuando el mapa agrupa o separa emplazamientos.
 *
 * - `entra`: sale de `desde` (la agrupación en que estaba) o, sin él, crece en su sitio.
 * - `sale`: se desliza hacia `hacia` (la agrupación que lo recoge) o, sin él, se apaga en su sitio.
 * - `quieto`: aparece sin transición, como al abrir el mapa.
 *
 * `escala` es lo pequeño que empieza o acaba: en el paso de la vista de puntos a los logos, el
 * tamaño de un punto (ADR 0028). Sin ella, el de siempre.
 */
export type Movimiento =
  | { readonly tipo: "quieto" }
  | { readonly tipo: "entra"; readonly desde: Salto | undefined; readonly escala?: number }
  | { readonly tipo: "sale"; readonly hacia: Salto | undefined; readonly escala?: number };

/** Lo que dura la transición más larga. Después, lo que sale ya no se ve y se puede quitar. */
export const DURACION_MOVIMIENTO_MS = 600;

const variantesDeslizable = cva("block motion-reduce:transition-none", {
  variants: {
    forma: {
      /** El logo se desliza hacia su agrupación y se apaga. */
      logo: "deslizar",
      /** El hexágono crece con un pequeño rebote. */
      agrupacion: "brotar",
    },
    entra: {
      // El estado inicial va en `@starting-style`: el navegador lo aplica al insertar el nodo y
      // la transición lo lleva a su sitio sin esperar a otro fotograma.
      si: "starting:opacity-0 starting:[transform:translate(var(--desde-x),var(--desde-y))_scale(var(--desde-escala))]",
      no: "",
    },
  },
});

const escala = (hacia: Salto | undefined): number => (hacia === undefined ? 0.55 : 0.3);

const estiloDe = (movimiento: Movimiento): JSX.CSSProperties | undefined => {
  switch (movimiento.tipo) {
    case "quieto": {
      return undefined;
    }
    case "entra": {
      return {
        "--desde-x": `${(movimiento.desde?.x ?? 0).toFixed(1)}px`,
        "--desde-y": `${(movimiento.desde?.y ?? 0).toFixed(1)}px`,
        "--desde-escala": String(movimiento.escala ?? escala(movimiento.desde)),
      };
    }
    case "sale": {
      const { x = 0, y = 0 } = movimiento.hacia ?? {};
      return {
        transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${movimiento.escala ?? escala(movimiento.hacia)})`,
        opacity: "0",
      };
    }
  }
};

/**
 * La parte del marcador que se mueve al agrupar y separar. El botón que la envuelve sigue en la
 * posición del emplazamiento; esto se desplaza respecto a él. Con la preferencia de reducir
 * movimiento no hay transición: el cambio es directo.
 */
export function Deslizable(props: {
  readonly forma: "logo" | "agrupacion";
  readonly movimiento: Movimiento;
  readonly children: JSX.Element;
}) {
  return (
    <span
      class={variantesDeslizable({
        forma: props.forma,
        entra: props.movimiento.tipo === "entra" ? "si" : "no",
      })}
      style={estiloDe(props.movimiento)}
    >
      {props.children}
    </span>
  );
}
