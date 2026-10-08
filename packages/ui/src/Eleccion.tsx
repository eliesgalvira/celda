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
 * encendido. Su nombre es la etiqueta, y la descripción se lee después.
 *
 * Se ve como una pastilla. Apagada, un contorno con el mando pequeño en tinta suave; encendida,
 * verde azulada con el mando claro, más grande, al otro lado. El mando queda a la misma distancia
 * del borde por arriba, por abajo y por su lado, en píxeles enteros, para que salga centrado
 * también a 2x. La fila entera, de 44 px como mínimo, es el objetivo táctil y lleva el foco.
 */
export function Interruptor(props: InterruptorProps) {
  const id = createUniqueId();
  const idEtiqueta = createUniqueId();
  return (
    <label
      class={
        "group/interruptor grid min-h-11 cursor-pointer grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1 " +
        "bg-superficie-alta px-4 py-3 text-base font-semibold " +
        "shadow-[inset_0_0_0_1.5px_var(--linea)] hover:bg-fondo " +
        "has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-foco " +
        "has-disabled:cursor-default has-disabled:opacity-60"
      }
    >
      <span id={idEtiqueta}>{props.etiqueta}</span>
      <input
        type="checkbox"
        role="switch"
        checked={props.encendido}
        aria-checked={props.encendido ? "true" : "false"}
        aria-labelledby={idEtiqueta}
        disabled={props.disabled}
        aria-describedby={props.descripcion === undefined ? undefined : id}
        onChange={(evento) => props.alCambiar(evento.currentTarget.checked)}
        class="sr-only"
      />
      <span
        aria-hidden="true"
        class={
          "relative col-start-2 row-span-2 row-start-1 mt-0.5 h-7 w-12 rounded-full bg-superficie " +
          "shadow-[inset_0_0_0_1.5px_var(--linea-fuerte)] transition-[background-color,box-shadow] duration-150 " +
          "group-hover/interruptor:shadow-[inset_0_0_0_1.5px_var(--tinta)] " +
          "group-has-checked/interruptor:bg-primario group-has-checked/interruptor:shadow-none " +
          "group-has-checked/interruptor:group-hover/interruptor:bg-primario-hover " +
          "group-has-checked/interruptor:group-hover/interruptor:shadow-none " +
          "motion-reduce:transition-none"
        }
      >
        <span
          class={
            "absolute top-1.5 left-1.5 size-4 rounded-full bg-tinta-suave " +
            "transition-[top,left,width,height,background-color] duration-180 ease-[cubic-bezier(0.3,0.7,0.2,1)] " +
            "group-hover/interruptor:bg-tinta " +
            "group-has-checked/interruptor:top-0.75 group-has-checked/interruptor:left-5.75 " +
            "group-has-checked/interruptor:size-5.5 group-has-checked/interruptor:bg-primario-fg " +
            "group-has-checked/interruptor:shadow-[0_1px_2px_var(--sombra)] " +
            "group-has-checked/interruptor:group-hover/interruptor:bg-primario-fg " +
            "motion-reduce:transition-none"
          }
        />
      </span>
      <Show when={props.descripcion}>
        <span id={id} class="col-start-1 text-sm leading-snug font-normal text-tinta-suave">
          {props.descripcion}
        </span>
      </Show>
    </label>
  );
}

export interface OpcionDeCorredera<Valor extends string> extends OpcionDeEleccion<Valor> {
  /** Un icono de 16 px con `currentColor`, delante de la etiqueta. */
  readonly icono?: JSX.Element;
}

export interface CorrederaProps<Valor extends string> {
  /** Pregunta visible que agrupa las opciones. */
  readonly leyenda: string;
  readonly opciones: ReadonlyArray<OpcionDeCorredera<Valor>>;
  readonly valor: Valor;
  readonly alCambiar: (valor: Valor) => void;
}

/**
 * Pocas opciones excluyentes en una pastilla, con una corredera verde azulada que se desliza a la
 * elegida. Como `Segmentado`, son botones de radio de verdad. Cada opción ocupa los 44 px de alto
 * de la pastilla, aunque el fondo que se ve al pasar por encima y el foco son más bajos.
 */
export function Corredera<Valor extends string>(props: CorrederaProps<Valor>) {
  const nombre = createUniqueId();
  const elegida = () => props.opciones.findIndex((opcion) => opcion.valor === props.valor);
  return (
    <fieldset class="flex min-w-0 flex-col gap-1.5">
      <legend class="mb-1.5 font-mono text-xs font-semibold tracking-wider text-tinta-suave">
        {props.leyenda}
      </legend>
      <div
        class={
          "relative grid auto-cols-fr grid-flow-col rounded-full bg-fondo px-1 " +
          "shadow-[inset_0_0_0_1.5px_var(--linea-fuerte)]"
        }
      >
        <Show when={elegida() >= 0}>
          <span
            aria-hidden="true"
            data-parte="corredera"
            class={
              "absolute inset-y-1 left-1 rounded-full bg-primario shadow-[0_1px_2px_var(--sombra)] " +
              "transition-transform duration-200 ease-[cubic-bezier(0.3,0.7,0.2,1)] motion-reduce:transition-none"
            }
            style={{
              width: `calc((100% - 0.5rem) / ${props.opciones.length})`,
              transform: `translateX(${elegida() * 100}%)`,
            }}
          />
        </Show>
        <For each={props.opciones}>
          {(opcion) => (
            <label class="group/opcion relative flex h-11 cursor-pointer items-center">
              <input
                type="radio"
                name={nombre}
                value={opcion.valor}
                checked={props.valor === opcion.valor}
                onChange={() => props.alCambiar(opcion.valor)}
                class="sr-only"
              />
              <span
                class={
                  "flex h-9 w-full items-center justify-center gap-1.75 rounded-full px-2 " +
                  "text-sm font-semibold text-tinta-suave transition-colors duration-150 " +
                  "group-hover/opcion:bg-linea group-hover/opcion:text-tinta " +
                  "group-has-checked/opcion:bg-transparent group-has-checked/opcion:text-primario-fg " +
                  "group-has-checked/opcion:group-hover/opcion:bg-transparent " +
                  "group-has-checked/opcion:group-hover/opcion:text-primario-fg " +
                  "group-has-focus-visible/opcion:outline-3 group-has-focus-visible/opcion:outline-offset-3 " +
                  "group-has-focus-visible/opcion:outline-foco motion-reduce:transition-none"
                }
              >
                {opcion.icono}
                {opcion.etiqueta}
              </span>
            </label>
          )}
        </For>
      </div>
    </fieldset>
  );
}

/** Un monitor: el tema del sistema. */
export function IconoTemaSistema() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="shrink-0"
    >
      <rect x="1.5" y="2.5" width="13" height="8.5" rx="1" />
      <path d="M5.5 14h5M8 11v3" />
    </svg>
  );
}

/** Un sol: el tema claro. */
export function IconoTemaClaro() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="shrink-0"
    >
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1" />
    </svg>
  );
}

/** Una luna: el tema oscuro. */
export function IconoTemaOscuro() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="shrink-0"
    >
      <path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3z" />
    </svg>
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

export interface AreaDeTextoProps {
  /** Etiqueta visible encima del campo. */
  readonly etiqueta: string;
  readonly valor: string;
  /** Lo más largo que se puede escribir, en caracteres. Se ve lo que queda. */
  readonly maximo: number;
  readonly alCambiar: (valor: string) => void;
  /** Una frase bajo el campo, como qué no escribir. */
  readonly ayuda?: JSX.Element;
}

/**
 * Un texto de varias líneas con su etiqueta, su ayuda y los caracteres que quedan a la vista. No
 * deja escribir más de `maximo`.
 */
export function AreaDeTexto(props: AreaDeTextoProps) {
  const id = createUniqueId();
  const idAyuda = createUniqueId();
  return (
    <div class="flex min-w-0 flex-col gap-1.5">
      <div class="flex items-baseline justify-between gap-2">
        <label for={id} class="font-mono text-xs font-semibold tracking-wider text-tinta-suave">
          {props.etiqueta}
        </label>
        <span class="font-mono text-xs text-tinta-suave">
          quedan {props.maximo - props.valor.length}
        </span>
      </div>
      <textarea
        id={id}
        rows={3}
        maxlength={props.maximo}
        value={props.valor}
        aria-describedby={props.ayuda === undefined ? undefined : idAyuda}
        onInput={(evento) => props.alCambiar(evento.currentTarget.value)}
        class={
          "min-h-24 w-full resize-y bg-superficie-alta px-3 py-2 text-base text-tinta " +
          "shadow-[inset_0_0_0_1.5px_var(--linea-fuerte)] hover:bg-fondo"
        }
      />
      <Show when={props.ayuda}>
        <p id={idAyuda} class="text-xs leading-snug text-tinta-suave">
          {props.ayuda}
        </p>
      </Show>
    </div>
  );
}

export interface CasillasProps<Valor extends string> {
  /** Pregunta visible que agrupa las casillas. */
  readonly leyenda: string;
  readonly opciones: ReadonlyArray<OpcionDeEleccion<Valor>>;
  readonly marcadas: ReadonlyArray<Valor>;
  readonly alCambiar: (marcadas: ReadonlyArray<Valor>) => void;
}

/** Varias opciones que se pueden marcar a la vez, como casillas nativas de toda la fila. */
export function Casillas<Valor extends string>(props: CasillasProps<Valor>) {
  const cambiar = (valor: Valor, marcada: boolean) =>
    props.alCambiar(
      props.opciones
        .map((opcion) => opcion.valor)
        .filter((v) => (v === valor ? marcada : props.marcadas.includes(v))),
    );
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
                "relative inline-flex min-h-11 cursor-pointer items-center gap-2 px-3 " +
                "bg-superficie-alta text-sm font-semibold text-tinta shadow-[inset_0_0_0_1.5px_var(--linea-fuerte)] " +
                "hover:bg-fondo has-checked:shadow-[inset_0_0_0_2px_var(--primario)] " +
                "has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-foco"
              }
            >
              <input
                type="checkbox"
                checked={props.marcadas.includes(opcion.valor)}
                onChange={(evento) => cambiar(opcion.valor, evento.currentTarget.checked)}
                class="size-4 accent-primario"
              />
              {opcion.etiqueta}
            </label>
          )}
        </For>
      </div>
    </fieldset>
  );
}
