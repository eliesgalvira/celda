import { createEffect, createMemo, onCleanup, untrack } from "solid-js";

/**
 * La única forma de abrir desde Solid algo que hay que cerrar: el GPS, la brújula, escuchadores de
 * la ventana o del mapa, temporizadores, fotogramas, peticiones y cálculos del Worker. Ver
 * `docs/patterns/efectos.md`.
 *
 * En Solid 2 la segunda función de `createEffect` corre otra vez, y antes cierra lo anterior, cada
 * vez que cambia algo que lee la primera, aunque devuelva lo mismo. Un efecto que abre algo a
 * partir de un estado que ese algo escribe se cierra y se reabre con cada lectura. Aquí la clave
 * pasa por un memo, que compara, y el recurso solo se reabre cuando la clave cambia de verdad.
 */

/** Una clave que deja el recurso cerrado. */
export type Cerrado = false | null | undefined;

/**
 * Cierra lo abierto. Recibe la clave con la que se va a volver a abrir enseguida, o `undefined` si
 * el recurso se cierra del todo: la clave pasa a cerrado o su dueño se desmonta.
 */
export type Cierre<K> = (siguiente: K | undefined) => void;

export interface OpcionesRecurso<K> {
  /**
   * Cuándo dos claves son la misma. Por defecto `Object.is`, que con objetos compara la
   * referencia: una clave que es un objeto nuevo en cada cálculo necesita su comparador
   * (`mismosCampos`, `mismasListas` o uno propio).
   */
  readonly iguales?: (a: K, b: K) => boolean;
  /**
   * Cuántas aperturas por segundo son normales. Pasar de ahí es un bucle y el vigilante avisa. Los
   * recursos que siguen un gesto (arrastrar, un deslizador) abren uno por evento y suben el tope.
   */
  readonly maximoPorSegundo?: number;
}

/** Aperturas por segundo de un recurso a partir de las cuales el vigilante avisa. */
export const MAXIMO_POR_SEGUNDO = 10;

const cerrada = <K>(clave: K | Cerrado): clave is Cerrado =>
  clave === false || clave === null || clave === undefined;

/**
 * Abre un recurso mientras `clave` diga que tiene que estar abierto y lo cierra al cambiar la clave
 * o al desmontarse quien lo llama. `abrir` y el cierre corren fuera del seguimiento: lo que lean
 * no reabre nada, y Solid no avisa de que lo lean sin seguirlo.
 *
 * - `false`, `null` o `undefined` dejan el recurso cerrado.
 * - Una clave igual a la anterior (según `iguales`) no hace nada: ni cierra ni abre.
 * - Una clave distinta cierra lo anterior, pasándole la nueva, y abre con ella.
 *
 * `nombre` identifica el recurso en los avisos del vigilante.
 */
export function recurso<K>(
  nombre: string,
  clave: () => K | Cerrado,
  abrir: (clave: K) => Cierre<K> | undefined,
  opciones: OpcionesRecurso<K> = {},
): void {
  const iguales = opciones.iguales ?? Object.is;
  const maximo = opciones.maximoPorSegundo ?? MAXIMO_POR_SEGUNDO;
  const actual = createMemo(clave, {
    equals: (a, b) => Object.is(a, b) || (!cerrada(a) && !cerrada(b) && iguales(a, b)),
  });
  let cerrar: Cierre<K> | undefined;
  const cerrarAhora = (siguiente: K | undefined) => {
    const pendiente = cerrar;
    cerrar = undefined;
    untrack(() => pendiente?.(siguiente));
  };
  // La limpieza no va en lo que devuelve el efecto: así el cierre sabe con qué se reabre.
  createEffect(actual, (ahora) => {
    if (cerrada(ahora)) {
      cerrarAhora(undefined);
      return;
    }
    cerrarAhora(ahora);
    contarApertura(nombre, maximo);
    cerrar = untrack(() => abrir(ahora));
  });
  onCleanup(() => cerrarAhora(undefined));
}

/** Un recurso que se abre al montar y se cierra al desmontar, sin clave que cambie. */
export const recursoFijo = (nombre: string, abrir: () => (() => void) | undefined): void =>
  recurso(nombre, () => true, abrir);

/** Compara dos objetos campo a campo con `Object.is`: para claves con varias lecturas. */
export const mismosCampos = <T extends object>(a: T, b: T): boolean => {
  const deA = Object.entries(a);
  const deB = new Map(Object.entries(b));
  return (
    deA.length === deB.size &&
    deA.every(([campo, valor]) => deB.has(campo) && Object.is(valor, deB.get(campo)))
  );
};

/** Compara dos listas elemento a elemento con `Object.is`. */
export const mismasListas = <T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean =>
  a.length === b.length && a.every((elemento, i) => Object.is(elemento, b[i]));

// ---------------------------------------------------------------------------------------------
// Vigilante: en desarrollo y en las pruebas cuenta cuántas veces se abre cada recurso.

/** Un recurso que se ha abierto más veces por segundo de las normales. */
export interface Exceso {
  readonly nombre: string;
  /** Aperturas en el último segundo. */
  readonly veces: number;
  readonly maximo: number;
}

const VIGILAR = import.meta.env.DEV;
const aperturas = new Map<string, { total: number; recientes: Array<number> }>();
const excesos: Array<Exceso> = [];

const avisarEnConsola = (exceso: Exceso) => {
  // @effect-diagnostics-next-line globalConsole:off
  console.warn(
    `[Celda] «${exceso.nombre}» se ha abierto ${exceso.veces} veces en un segundo (lo normal es ${exceso.maximo} como mucho). ` +
      "Seguramente su clave cambia con lo que el propio recurso escribe. Ver docs/patterns/efectos.md.",
  );
};

const contarApertura = (nombre: string, maximo: number) => {
  if (!VIGILAR) return;
  const ahora = performance.now();
  const cuenta = aperturas.get(nombre) ?? { total: 0, recientes: [] };
  cuenta.total += 1;
  cuenta.recientes = [...cuenta.recientes.filter((t) => ahora - t < 1000), ahora];
  aperturas.set(nombre, cuenta);
  if (cuenta.recientes.length > maximo) {
    const exceso = { nombre, veces: cuenta.recientes.length, maximo };
    // Un aviso por ráfaga: la cuenta del segundo vuelve a empezar.
    cuenta.recientes = [];
    excesos.push(exceso);
    avisarEnConsola(exceso);
  }
};

/** Lo que ha visto el vigilante. Las pruebas fallan si hay excesos (`pruebas/vigilante.ts`). */
export const vigilante = {
  /** Los recursos que han pasado de su tope desde el último `reiniciar`. */
  excesos: (): ReadonlyArray<Exceso> => [...excesos],
  /** Cuántas veces se ha abierto el recurso `nombre` desde el último `reiniciar`. */
  aperturas: (nombre: string): number => aperturas.get(nombre)?.total ?? 0,
  reiniciar: (): void => {
    excesos.length = 0;
    aperturas.clear();
  },
};
