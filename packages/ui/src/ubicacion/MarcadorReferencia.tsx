import { type JSX, Portal } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";

import { variantesDiana } from "../Boton.tsx";
import { cn } from "../cn.ts";

/** La mirilla del botón de ubicación: un círculo con cuatro marcas. */
export function IconoMirilla() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="5" stroke="currentColor" stroke-width="1.8" />
      <path d="M10 1v4M10 15v4M1 10h4M15 10h4" stroke="currentColor" stroke-width="1.8" />
    </svg>
  );
}

/** Lo que mueven las flechas del teclado el punto elegido, en píxeles; con Mayúsculas, más. */
const PASO_TECLADO = 10;
const PASO_TECLADO_LARGO = 50;

/** Hacia dónde mueve el punto cada flecha del teclado. */
const direccionDeTecla = (tecla: string): readonly [number, number] | undefined => {
  switch (tecla) {
    case "ArrowLeft":
      return [-1, 0];
    case "ArrowRight":
      return [1, 0];
    case "ArrowUp":
      return [0, -1];
    case "ArrowDown":
      return [0, 1];
    default:
      return undefined;
  }
};

export interface CapaDeReferenciaProps {
  /** El elemento del mapa que recibe los gestos, como en `CapaDeMarcadores`. */
  readonly contenedor: HTMLElement;
  readonly children: JSX.Element;
}

/** La lámina del punto de referencia, encima de los marcadores y dentro del mapa. */
export function CapaDeReferencia(props: CapaDeReferenciaProps) {
  return (
    <Portal mount={props.contenedor}>
      <div class="pointer-events-none absolute inset-0 overflow-hidden">{props.children}</div>
    </Portal>
  );
}

export interface UbicacionGpsProps {
  /** Posición en la pantalla, en píxeles desde la esquina del mapa. */
  readonly x: number;
  readonly y: number;
  /** Radio del círculo de precisión en la pantalla, en píxeles. */
  readonly radio: number;
  /** Nombre accesible: «Tu ubicación, con ±25 m de precisión». */
  readonly nombre: string;
}

/** El hexágono «TÚ» mide 30 × 34 px; el dibujo nunca es más pequeño. */
const RADIO_MINIMO = 20;

/** La ubicación GPS en el mapa: el hexágono «TÚ» con su círculo de precisión (historia 29). */
export function UbicacionGps(props: UbicacionGpsProps) {
  const lado = () => Math.max(props.radio, RADIO_MINIMO);
  return (
    <svg
      width={lado() * 2}
      height={lado() * 2}
      viewBox={`${-lado()} ${-lado()} ${lado() * 2} ${lado() * 2}`}
      class="absolute top-0 left-0 overflow-visible will-change-transform"
      style={{
        transform: `translate(${(props.x - lado()).toFixed(1)}px, ${(props.y - lado()).toFixed(1)}px)`,
      }}
    >
      <title>{props.nombre}</title>
      <circle
        r={props.radio}
        class="fill-referencia/10 stroke-referencia"
        stroke-width="2"
        stroke-dasharray="4 4"
      />
      <polygon
        points="0,-17 15,-8.5 15,8.5 0,17 -15,8.5 -15,-8.5"
        class="fill-superficie-invertida drop-shadow-marcador"
      />
      <text
        text-anchor="middle"
        dominant-baseline="central"
        class="fill-tinta-invertida font-mono text-[10px] font-bold"
      >
        TÚ
      </text>
    </svg>
  );
}

export interface PuntoElegidoProps {
  readonly x: number;
  readonly y: number;
  /** Nombre accesible, que explica cómo moverlo. */
  readonly nombre: string;
  /** En escritorio se arrastra con el ratón; en el móvil el dedo mueve el mapa. */
  readonly arrastrable: boolean;
  /** El punto se mueve a esta posición de la pantalla: lo que depende de él se recalcula. */
  readonly alMover: (x: number, y: number) => void;
  /** Se ha soltado donde está ahora: es el momento de guardarlo. */
  readonly alSoltar: () => void;
}

/**
 * El punto elegido en el mapa: un hexágono naranja con la etiqueta «PUNTO». En escritorio se
 * arrastra (historia 28), y con el foco, las flechas lo mueven.
 */
export function PuntoElegido(props: PuntoElegidoProps) {
  let arrastre: { readonly puntero: number; readonly dx: number; readonly dy: number } | undefined;

  const posicionEnMapa = (evento: PointerEvent, boton: HTMLElement) => {
    const lamina = boton.parentElement?.getBoundingClientRect();
    return {
      x: evento.clientX - (lamina?.left ?? 0) - (arrastre?.dx ?? 0),
      y: evento.clientY - (lamina?.top ?? 0) - (arrastre?.dy ?? 0),
    };
  };

  return (
    <button
      type="button"
      aria-label={props.nombre}
      class={cn(
        variantesDiana(),
        "pointer-events-auto absolute top-0 left-0 z-10 -mt-[22px] -ml-[22px] will-change-transform",
        props.arrastrable && "cursor-grab touch-none active:cursor-grabbing",
      )}
      style={{ transform: `translate(${props.x.toFixed(1)}px, ${props.y.toFixed(1)}px)` }}
      // Que el mapa no empiece a moverse con el mismo gesto que arrastra el punto.
      onMouseDown={(evento) => {
        if (props.arrastrable) evento.stopPropagation();
      }}
      onPointerDown={(evento) => {
        if (!props.arrastrable || evento.pointerType !== "mouse" || evento.button !== 0) return;
        evento.currentTarget.setPointerCapture?.(evento.pointerId);
        const caja = evento.currentTarget.getBoundingClientRect();
        arrastre = {
          puntero: evento.pointerId,
          dx: evento.clientX - (caja.left + caja.width / 2),
          dy: evento.clientY - (caja.top + caja.height / 2),
        };
      }}
      onPointerMove={(evento) => {
        if (arrastre?.puntero !== evento.pointerId) return;
        const { x, y } = posicionEnMapa(evento, evento.currentTarget);
        props.alMover(x, y);
      }}
      onPointerUp={(evento) => {
        if (arrastre?.puntero !== evento.pointerId) return;
        arrastre = undefined;
        props.alSoltar();
      }}
      onPointerCancel={() => {
        if (arrastre === undefined) return;
        arrastre = undefined;
        props.alSoltar();
      }}
      onKeyDown={(evento) => {
        const direccion = direccionDeTecla(evento.key);
        if (direccion === undefined) return;
        evento.preventDefault();
        const paso = evento.shiftKey ? PASO_TECLADO_LARGO : PASO_TECLADO;
        props.alMover(props.x + direccion[0] * paso, props.y + direccion[1] * paso);
      }}
      onKeyUp={(evento) => {
        if (direccionDeTecla(evento.key) !== undefined) props.alSoltar();
      }}
    >
      <span class="flex flex-col items-center">
        <span
          aria-hidden="true"
          class="hexagono grid h-[34px] w-[30px] place-items-center bg-referencia drop-shadow-marcador transition-transform duration-150 ease-out group-hover:scale-110 motion-reduce:transition-none"
        >
          <span class="size-2 rounded-full bg-referencia-fg" />
        </span>
      </span>
      <span
        aria-hidden="true"
        class="cinta absolute top-full mt-0.5 bg-referencia px-2 font-mono text-[10px] leading-4 font-bold tracking-wider text-referencia-fg [--pico:5px]"
      >
        PUNTO
      </span>
    </button>
  );
}

export const variantesEtiquetaReferencia = cva(
  "cinta absolute top-0 left-0 -translate-y-1/2 bg-referencia px-2.5 font-mono text-[11px] leading-5 font-bold whitespace-nowrap text-referencia-fg drop-shadow-marcador [--pico:6px]",
  {
    variants: {
      /** Al lado contrario de la línea que va al emplazamiento, para no taparla. */
      lado: {
        derecha: "ml-6",
        izquierda: "-ml-6 -translate-x-full",
      },
    },
    defaultVariants: { lado: "derecha" },
  },
);

export type EtiquetaReferenciaProps = VariantProps<typeof variantesEtiquetaReferencia> & {
  readonly x: number;
  readonly y: number;
  readonly texto: string;
};

/**
 * La etiqueta junto al punto de referencia con la distancia y el sector que da servicio, como
 * «340 m · sector 2». Va al lado del hexágono, sin tapar la línea ni la cinta «PUNTO».
 */
export function EtiquetaReferencia(props: EtiquetaReferenciaProps) {
  return (
    <div
      aria-hidden="true"
      class="absolute top-0 left-0 will-change-transform"
      style={{ transform: `translate(${props.x.toFixed(1)}px, ${props.y.toFixed(1)}px)` }}
    >
      <span
        data-lado={props.lado ?? "derecha"}
        class={variantesEtiquetaReferencia({ lado: props.lado })}
      >
        {props.texto}
      </span>
    </div>
  );
}

/**
 * El pin fijo en el centro del mapa para elegir un punto en el móvil (historia 27): el mapa se
 * mueve debajo y la punta marca el punto.
 */
export function PinCentral() {
  return (
    <div class="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full">
      <svg
        width="34"
        height="44"
        viewBox="0 0 34 44"
        aria-hidden="true"
        class="block drop-shadow-marcador"
      >
        <polygon
          points="17,2 32,10.5 32,27.5 17,36 2,27.5 2,10.5"
          class="fill-referencia stroke-referencia-fg"
          stroke-width="2"
        />
        <circle cx="17" cy="19" r="4" class="fill-referencia-fg" />
        <line x1="17" y1="36" x2="17" y2="44" class="stroke-referencia" stroke-width="2.5" />
      </svg>
    </div>
  );
}
