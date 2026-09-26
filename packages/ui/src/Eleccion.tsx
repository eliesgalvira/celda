import type { JSX } from "@solidjs/web";
import { createUniqueId, For, Show } from "solid-js";

export interface OpcionDeEleccion<Valor extends string> {
  readonly valor: Valor;
  readonly etiqueta: string;
}

export interface SegmentadoProps<Valor extends string> {
  /** Pregunta visible que agrupa las opciones. */
  readonly leyenda: string;
  readonly opciones: ReadonlyArray<OpcionDeEleccion<Valor>>;
  /** La opción marcada, o ninguna. */
  readonly valor: Valor | undefined;
  readonly alCambiar: (valor: Valor) => void;
  /** Una frase bajo las opciones, como de dónde sale la opción marcada. */
  readonly ayuda?: JSX.Element;
}

/**
 * Pocas opciones excluyentes en fila, como botones pegados. Son botones de radio de verdad: el
 * teclado se mueve con las flechas y el lector de pantalla lee la pregunta.
 */
export function Segmentado<Valor extends string>(props: SegmentadoProps<Valor>) {
  const nombre = createUniqueId();
  return (
    <fieldset class="flex min-w-0 flex-col gap-1.5">
      <legend class="mb-1.5 font-mono text-xs font-semibold tracking-wider text-tinta-suave">
        {props.leyenda}
      </legend>
      <div class="flex flex-wrap gap-1">
        <For each={props.opciones}>
          {(opcion) => (
            <label
              class={
                "relative inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center px-3 " +
                "bg-superficie-alta font-mono text-sm font-semibold text-tinta shadow-[inset_0_0_0_1.5px_var(--linea-fuerte)] " +
                "hover:bg-fondo has-checked:bg-superficie-invertida has-checked:text-tinta-invertida " +
                "has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-foco"
              }
            >
              <input
                type="radio"
                name={nombre}
                value={opcion.valor}
                checked={props.valor === opcion.valor}
                onChange={() => props.alCambiar(opcion.valor)}
                class="sr-only"
              />
              {opcion.etiqueta}
            </label>
          )}
        </For>
      </div>
      <Show when={props.ayuda}>
        <p class="text-xs leading-snug text-tinta-suave">{props.ayuda}</p>
      </Show>
    </fieldset>
  );
}

export interface SelectorProps<Valor extends string> {
  /** Etiqueta visible del desplegable. */
  readonly etiqueta: string;
  readonly opciones: ReadonlyArray<OpcionDeEleccion<Valor>>;
  readonly valor: Valor | undefined;
  /** El texto de la opción vacía, cuando aún no hay ninguna elegida. */
  readonly vacio: string;
  readonly alCambiar: (valor: Valor) => void;
}

export interface DeslizadorProps {
  /** Etiqueta visible, encima a la izquierda. */
  readonly etiqueta: string;
  readonly valor: number;
  readonly minimo: number;
  readonly maximo: number;
  readonly paso: number;
  /** El valor como se lee, encima a la derecha y para el lector de pantalla: «50 %». */
  readonly texto: string;
  /** Se llama con cada movimiento, también con las flechas del teclado. */
  readonly alCambiar: (valor: number) => void;
}

/**
 * Un deslizador nativo con su etiqueta y su valor visibles. La pista ocupa 44 px de alto, así
 * que se coge bien con el dedo, y las flechas, Re Pág y Av Pág lo mueven.
 */
export function Deslizador(props: DeslizadorProps) {
  const id = createUniqueId();
  return (
    <div class="flex flex-col">
      <div class="flex items-baseline justify-between gap-2">
        <label for={id} class="font-mono text-xs font-semibold tracking-wider text-tinta-suave">
          {props.etiqueta}
        </label>
        <output for={id} class="font-mono text-sm font-semibold text-tinta">
          {props.texto}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={props.minimo}
        max={props.maximo}
        step={props.paso}
        value={props.valor}
        aria-valuetext={props.texto}
        onInput={(evento) => props.alCambiar(Number(evento.currentTarget.value))}
        class="h-11 w-full cursor-pointer accent-primario"
      />
    </div>
  );
}

/** Un desplegable nativo con su etiqueta visible encima. */
export function Selector<Valor extends string>(props: SelectorProps<Valor>) {
  const id = createUniqueId();
  const elegir = (texto: string) => {
    const opcion = props.opciones.find((candidata) => candidata.valor === texto);
    if (opcion !== undefined) props.alCambiar(opcion.valor);
  };
  return (
    <div class="flex flex-col gap-1.5">
      <label for={id} class="font-mono text-xs font-semibold tracking-wider text-tinta-suave">
        {props.etiqueta}
      </label>
      <select
        id={id}
        onChange={(evento) => elegir(evento.currentTarget.value)}
        class={
          "min-h-11 w-full cursor-pointer bg-superficie-alta px-3 text-base text-tinta " +
          "shadow-[inset_0_0_0_1.5px_var(--linea-fuerte)] hover:bg-fondo"
        }
      >
        <option value="" disabled selected={props.valor === undefined}>
          {props.vacio}
        </option>
        <For each={props.opciones}>
          {(opcion) => (
            <option value={opcion.valor} selected={props.valor === opcion.valor}>
              {opcion.etiqueta}
            </option>
          )}
        </For>
      </select>
    </div>
  );
}
