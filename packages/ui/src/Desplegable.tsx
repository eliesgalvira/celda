import type { JSX } from "@solidjs/web";
import { cva } from "class-variance-authority";
import { createSignal, createUniqueId, untrack } from "solid-js";

const variantesDesplegable = cva("", {
  variants: {
    variante: {
      /** Una sección más del panel del emplazamiento, separada por una línea. */
      panel: "border-t border-linea",
      /** Un recuadro dentro de un diálogo, como «¿Qué hace el código en el móvil?». */
      recuadro: "bg-superficie-alta shadow-[inset_0_0_0_1.5px_var(--linea)]",
      /** Una parte de una sección de la ficha, como «Las medidas de cada compañía». */
      seccion: "border-t border-linea",
    },
  },
  defaultVariants: { variante: "panel" },
});

const variantesBotonDesplegable = cva(
  "group flex w-full items-center gap-2.5 text-left hover:text-tinta active:bg-linea",
  {
    variants: {
      variante: {
        panel:
          "min-h-12 px-5 font-mono text-[11px] font-semibold tracking-[0.14em] text-primario-texto uppercase hover:bg-superficie-alta md:px-6",
        recuadro: "min-h-11 px-4 text-base font-semibold text-tinta hover:bg-fondo",
        seccion: "min-h-11 text-sm font-semibold text-tinta",
      },
    },
    defaultVariants: { variante: "panel" },
  },
);

const variantesContenidoDesplegable = cva("", {
  variants: {
    variante: {
      panel: "px-5 pb-5 md:px-6",
      recuadro: "px-4 pb-4",
      seccion: "flex flex-col gap-3 pb-3",
    },
  },
  defaultVariants: { variante: "panel" },
});

export interface DesplegableProps {
  /** Etiqueta visible del botón, que es también su nombre accesible. */
  readonly titulo: string;
  /** Abierto al aparecer. Luego lo abre y lo cierra quien lo lee. Por defecto, cerrado. */
  readonly abierto?: boolean;
  readonly variante?: "panel" | "recuadro" | "seccion";
  readonly children: JSX.Element;
}

/**
 * Un bloque plegado que se abre con un botón: con el dedo, con Intro o con Espacio. El
 * contenido está en el DOM pero oculto, así que el botón apunta a él con `aria-controls` y
 * abrirlo no lo vuelve a construir.
 */
export function Desplegable(props: DesplegableProps) {
  const [abierto, setAbierto] = createSignal(untrack(() => props.abierto === true));
  const id = createUniqueId();
  return (
    <div class={variantesDesplegable({ variante: props.variante })}>
      <button
        type="button"
        aria-expanded={abierto() ? "true" : "false"}
        aria-controls={id}
        onClick={() => setAbierto((antes) => !antes)}
        class={variantesBotonDesplegable({ variante: props.variante })}
      >
        <span
          aria-hidden="true"
          class="inline-block text-sm leading-none transition-transform group-aria-expanded:rotate-90 motion-reduce:transition-none"
        >
          ▸
        </span>
        {props.titulo}
      </button>
      <div
        id={id}
        hidden={!abierto()}
        class={variantesContenidoDesplegable({ variante: props.variante })}
      >
        {props.children}
      </div>
    </div>
  );
}
