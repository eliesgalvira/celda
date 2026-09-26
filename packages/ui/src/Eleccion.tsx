import type { JSX } from "@solidjs/web";
import { createEffect, createUniqueId, For, Show } from "solid-js";

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

export interface InterruptorProps {
  /** Etiqueta visible, que es también el nombre accesible. */
  readonly etiqueta: string;
  /** Qué cambia al encenderlo, bajo la etiqueta. Se lee con el control. */
  readonly descripcion?: JSX.Element;
  readonly encendido: boolean;
  readonly alCambiar: (encendido: boolean) => void;
  readonly disabled?: boolean;
}

/**
 * Un ajuste que se enciende y se apaga. Es una casilla nativa con el papel de interruptor: se
 * cambia con el dedo en toda la fila, con Espacio y con el lector de pantalla, que dice si está
 * encendido.
 */
export function Interruptor(props: InterruptorProps) {
  const id = createUniqueId();
  return (
    <label
      class={
        "grid min-h-11 cursor-pointer grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1 bg-superficie-alta px-4 py-3 " +
        "text-base font-semibold " +
        "shadow-[inset_0_0_0_1.5px_var(--linea)] hover:bg-fondo " +
        "has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-foco " +
        "has-disabled:cursor-default has-disabled:opacity-60"
      }
    >
      {props.etiqueta}
      <input
        type="checkbox"
        role="switch"
        checked={props.encendido}
        aria-checked={props.encendido ? "true" : "false"}
        disabled={props.disabled}
        aria-describedby={props.descripcion === undefined ? undefined : id}
        onChange={(evento) => props.alCambiar(evento.currentTarget.checked)}
        class="peer sr-only"
      />
      <span
        aria-hidden="true"
        class={
          "col-start-2 row-span-2 row-start-1 mt-0.5 flex h-7 w-12 items-center bg-linea-fuerte px-1 " +
          "transition-colors peer-checked:bg-primario peer-checked:*:translate-x-5 motion-reduce:transition-none"
        }
      >
        <span class="hexagono size-5 bg-superficie transition-transform motion-reduce:transition-none" />
      </span>
      <Show when={props.descripcion}>
        <span id={id} class="col-start-1 text-sm leading-snug font-normal text-tinta-suave">
          {props.descripcion}
        </span>
      </Show>
    </label>
  );
}

export interface CampoNumeroProps {
  /** Etiqueta visible encima del campo. */
  readonly etiqueta: string;
  readonly valor: number;
  /** La unidad, escrita tras el número: «%», «por cada 100 habitantes». */
  readonly unidad: string;
  readonly minimo: number;
  readonly maximo: number;
  /** Solo recibe números dentro del intervalo; lo demás se queda en el campo sin aplicarse. */
  readonly alCambiar: (valor: number) => void;
  /** Una frase bajo el campo, como de dónde sale el valor. */
  readonly ayuda?: JSX.Element;
}

/** El número como se escribe en castellano, con coma decimal. */
const escribirNumero = (valor: number): string => String(valor).replace(".", ",");

/**
 * Un número que se puede escribir, con su etiqueta y su unidad a la vista. Acepta coma o punto
 * decimal. Mientras lo escrito no es un número válido, el campo lo marca y el valor anterior sigue
 * valiendo.
 */
export function CampoNumero(props: CampoNumeroProps) {
  const id = createUniqueId();
  const idAyuda = createUniqueId();
  let campo: HTMLInputElement | undefined;
  const leer = (texto: string): number | undefined => {
    const numero = Number(texto.trim().replace(",", "."));
    return texto.trim() !== "" &&
      Number.isFinite(numero) &&
      numero >= props.minimo &&
      numero <= props.maximo
      ? numero
      : undefined;
  };
  // Un valor nuevo que llega de fuera, como al restablecer, se escribe en el campo; el que sale
  // de lo que se está escribiendo no, para no mover el cursor.
  createEffect(
    () => props.valor,
    (valor) => {
      if (campo !== undefined && leer(campo.value) !== valor) {
        campo.value = escribirNumero(valor);
        campo.setAttribute("aria-invalid", "false");
      }
    },
  );
  return (
    <div class="flex min-w-0 flex-col gap-1.5">
      <label for={id} class="font-mono text-xs font-semibold tracking-wider text-tinta-suave">
        {props.etiqueta}
      </label>
      <div class="flex items-center gap-2">
        <input
          ref={(elemento) => {
            campo = elemento;
          }}
          id={id}
          type="text"
          inputmode="decimal"
          autocomplete="off"
          aria-invalid="false"
          aria-describedby={props.ayuda === undefined ? undefined : idAyuda}
          onInput={(evento) => {
            const numero = leer(evento.currentTarget.value);
            evento.currentTarget.setAttribute(
              "aria-invalid",
              numero === undefined ? "true" : "false",
            );
            if (numero !== undefined) props.alCambiar(numero);
          }}
          class={
            "min-h-11 w-24 bg-superficie-alta px-3 text-right font-mono text-base text-tinta " +
            "shadow-[inset_0_0_0_1.5px_var(--linea-fuerte)] hover:bg-fondo " +
            "aria-invalid:shadow-[inset_0_0_0_2px_var(--aviso)]"
          }
        />
        <span class="text-sm text-tinta-suave">{props.unidad}</span>
      </div>
      <Show when={props.ayuda}>
        <p id={idAyuda} class="text-xs leading-snug text-tinta-suave">
          {props.ayuda}
        </p>
      </Show>
    </div>
  );
}
