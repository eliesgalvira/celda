import type { JSX } from "@solidjs/web";
import { cva, type VariantProps } from "class-variance-authority";
import { children, omit, Show } from "solid-js";

import { cn } from "./cn.ts";

/**
 * La diana (el `<button>` o el `<a>`) es rectangular y lleva el foco; la forma
 * de dentro lleva el recorte. Así el anillo de foco no se pierde con el
 * `clip-path` y el objetivo táctil nunca baja de 44 px.
 */
export const variantesDiana = cva(
  "group relative inline-flex min-h-11 min-w-11 shrink-0 select-none items-center justify-center " +
    "cursor-pointer disabled:pointer-events-none",
);

export const variantesBoton = cva(
  "inline-flex items-center justify-center gap-2 font-mono font-semibold tracking-wide whitespace-nowrap " +
    "transition-[background-color,color,transform] duration-150 ease-out " +
    "group-active:translate-y-px group-disabled:opacity-50 group-aria-disabled:opacity-50",
  {
    variants: {
      variante: {
        primario:
          "cinta bg-superficie-invertida text-tinta-invertida group-hover:bg-primario " +
          "group-hover:text-primario-fg group-active:bg-primario-activo group-active:text-primario-fg",
        destacado:
          "cinta bg-primario text-primario-fg group-hover:bg-primario-hover group-active:bg-primario-activo",
        secundario:
          "bg-superficie text-tinta shadow-[inset_0_0_0_1.5px_var(--tinta)] group-hover:bg-superficie-alta",
        enlace: "text-primario-texto underline underline-offset-4 group-hover:text-tinta",
      },
      tamano: {
        normal: "min-h-9 px-4 text-sm",
        /** Para un botón que va en una fila apretada, como «Edificio» junto a los logos. */
        compacto: "min-h-9 px-2.5 text-sm",
        grande: "min-h-11 px-5 text-base",
      },
      /** `completo` ocupa todo el ancho que le deja su contenedor. */
      ancho: {
        ajustado: "",
        completo: "w-full",
      },
    },
    defaultVariants: { variante: "primario", tamano: "normal", ancho: "ajustado" },
  },
);

export type VariantesBoton = VariantProps<typeof variantesBoton>;

export type BotonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "style"> &
  VariantesBoton & {
    /**
     * Muestra un hexágono girando. Con `icono`, el hexágono ocupa el sitio del icono y la etiqueta
     * se sigue viendo; sin él, va sobre la etiqueta, que queda invisible. El ancho no cambia.
     */
    readonly cargando?: boolean;
    /** Un icono de 16 px delante de la etiqueta. */
    readonly icono?: JSX.Element;
  };

/** El hexágono que gira mientras un botón espera. */
function Girando() {
  return <span class="hexagono size-3.5 animate-spin bg-current motion-reduce:animate-none" />;
}

/** El botón de Celda. Si una pantalla necesita otro aspecto, se añade una variante aquí. */
export function Boton(props: BotonProps) {
  const resto = omit(
    props,
    "variante",
    "tamano",
    "ancho",
    "cargando",
    "icono",
    "disabled",
    "children",
    "type",
  );
  const cargando = () => props.cargando === true;
  // Se resuelve una vez: leer `props.icono` crea el icono otra vez.
  const icono = children(() => props.icono);
  const conIcono = () => icono.toArray().length > 0;
  return (
    <button
      type={props.type ?? "button"}
      data-variante={props.variante ?? "primario"}
      disabled={props.disabled === true || cargando()}
      aria-busy={cargando() ? "true" : "false"}
      class={variantesDiana({ class: props.ancho === "completo" ? "flex-1" : undefined })}
      {...resto}
    >
      <span
        class={variantesBoton({
          variante: props.variante,
          tamano: props.tamano,
          ancho: props.ancho,
        })}
      >
        <Show when={conIcono()}>
          <span class="grid size-4 shrink-0 place-items-center" aria-hidden="true">
            <Show when={cargando()} fallback={icono()}>
              <Girando />
            </Show>
          </span>
        </Show>
        <span class={cn("contents", cargando() && !conIcono() && "invisible")}>
          {props.children}
        </span>
      </span>
      <Show when={cargando() && !conIcono()}>
        <span class="absolute inset-0 grid place-items-center" aria-hidden="true">
          <Girando />
        </span>
      </Show>
    </button>
  );
}

export type EnlaceProps = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "class" | "style"> &
  VariantesBoton & { readonly href: string };

/** Un enlace con el aspecto de un botón, para navegar. */
export function Enlace(props: EnlaceProps) {
  const resto = omit(props, "variante", "tamano", "ancho", "children");
  return (
    <a data-variante={props.variante ?? "primario"} class={variantesDiana()} {...resto}>
      <span
        class={variantesBoton({
          variante: props.variante,
          tamano: props.tamano,
          ancho: props.ancho,
        })}
      >
        {props.children}
      </span>
    </a>
  );
}

/** Una fila de botones y enlaces, el principal primero. Si no caben, pasan a la línea siguiente. */
export function Acciones(props: { readonly children: JSX.Element }) {
  return <div class="flex flex-wrap items-center gap-2">{props.children}</div>;
}

/**
 * La ✕ de todos los cierres: la ficha, los diálogos, la explicación de un término y los avisos. Va
 * sin fondo y en la tinta de lo que la rodea, así que sirve igual sobre el panel, sobre la
 * explicación invertida y sobre un aviso de fallo. Su nombre es «Cerrar».
 */
export function BotonCerrar(props: { readonly alCerrar: () => void }) {
  return (
    <button
      type="button"
      aria-label="Cerrar"
      title="Cerrar"
      class={variantesDiana()}
      onClick={() => props.alCerrar()}
    >
      <span
        class={
          "chaflan grid size-9 place-items-center transition-colors duration-150 [--corte:7px] " +
          "group-hover:bg-current/10 group-active:bg-current/20 motion-reduce:transition-none"
        }
      >
        <svg
          viewBox="0 0 24 24"
          class="size-5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </span>
    </button>
  );
}
