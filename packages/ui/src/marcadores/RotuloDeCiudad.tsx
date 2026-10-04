import type { JSX } from "@solidjs/web";
import { Portal } from "@solidjs/web";
import { cva } from "class-variance-authority";

/**
 * Los rótulos de ciudad por encima de los datos (ADR 0024). MapLibre los coloca en capas
 * transparentes del mapa base y Celda los copia aquí, encima de los hexágonos y los logos, con la
 * misma letra, tamaño y halo. Son nombres de población: en caja normal, no en versalitas como las
 * zonas.
 */

/** Madrid y las capitales de comunidad van en negrita; las demás ciudades, en redonda. */
export type ImportanciaDeRotulo = "capital" | "ciudad";

const variantesRotulo = cva(
  "absolute top-0 left-0 font-rotulo leading-none whitespace-nowrap will-change-transform [paint-order:stroke_fill]",
  {
    variants: {
      importancia: { capital: "font-bold", ciudad: "font-normal" },
      // Sobre la foto aérea, en blanco con halo oscuro, como los rótulos del mapa base.
      foto: { no: "", si: "text-rotulo-foto [-webkit-text-stroke:3.2px_var(--mapa-foto-halo)]" },
    },
    compoundVariants: [
      {
        importancia: "capital",
        foto: "no",
        class: "text-rotulo-capital [-webkit-text-stroke:3.6px_var(--mapa-halo)]",
      },
      {
        importancia: "ciudad",
        foto: "no",
        class: "text-rotulo-ciudad [-webkit-text-stroke:3.2px_var(--mapa-halo)]",
      },
    ],
  },
);

export interface RotuloDeCiudadProps {
  /** Dónde va el centro del rótulo, en píxeles desde la esquina del mapa. */
  readonly x: number;
  readonly y: number;
  readonly texto: string;
  /** El tamaño de la letra en píxeles, el `text-size` de su capa al zoom en que se colocó. */
  readonly tamano: number;
  readonly importancia: ImportanciaDeRotulo;
  /** Con la foto aérea encendida. */
  readonly conFoto: boolean;
}

/** Un rótulo de ciudad centrado en su punto. No se puede pulsar: los gestos pasan al mapa. */
export function RotuloDeCiudad(props: RotuloDeCiudadProps) {
  return (
    <span
      data-rotulo={props.importancia}
      class={variantesRotulo({ importancia: props.importancia, foto: props.conFoto ? "si" : "no" })}
      style={{
        transform: `translate(${props.x.toFixed(1)}px, ${props.y.toFixed(1)}px) translate(-50%, -50%)`,
        "font-size": `${props.tamano.toFixed(1)}px`,
      }}
    >
      {props.texto}
    </span>
  );
}

/**
 * La lámina de los rótulos, dentro del contenedor del mapa y después de la de los marcadores, así
 * que queda encima. No recoge gestos y el lector de pantalla no la lee: repite lo que dice el mapa
 * base, que tampoco se lee.
 */
export function CapaDeRotulos(props: {
  readonly contenedor: HTMLElement;
  readonly children: JSX.Element;
}) {
  return (
    <Portal mount={props.contenedor}>
      <div aria-hidden="true" class="pointer-events-none absolute inset-0 overflow-hidden">
        {props.children}
      </div>
    </Portal>
  );
}
