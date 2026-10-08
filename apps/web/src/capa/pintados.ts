import type { Coordenada } from "@celda/dominio/area";
import {
  DURACION_MOVIMIENTO_MS,
  type Movimiento,
  type Salto,
} from "@celda/ui/marcadores/Deslizable.tsx";

import type { Elemento, Escena, Transicion } from "./agrupacion.ts";

/** Un elemento que está en el DOM: los de la escena y los que se están yendo. */
export interface Pintado {
  readonly elemento: Elemento;
  readonly movimiento: Movimiento;
  /** Si se está yendo, cuándo se quita del DOM, en el reloj de `performance.now()`. */
  readonly quitarEn: number | undefined;
}

/** Dónde cae un punto del mapa en la pantalla, en píxeles. */
export type Proyectar = (posicion: Coordenada) => Salto;

/** El paso de una escena a otra, con lo que hace falta saber de la pantalla. */
export interface CambioDeEscena {
  readonly anterior: Escena | undefined;
  readonly nueva: Escena;
  readonly transicion: Transicion;
  readonly proyectar: Proyectar;
  /** Si un punto de la pantalla se ve, contando el tamaño de un marcador. */
  readonly seVe: (punto: Salto) => boolean;
  /** El momento del cambio, en el reloj de `performance.now()`. */
  readonly ahora: number;
  /** La preferencia de reducir movimiento. */
  readonly reducido: boolean;
  /**
   * En la vista de puntos, si el cambio es el paso entre los puntos y los logos (ADR 0028): lo
   * pequeño que es un punto al lado de un logo. Cada logo crece desde su punto, o se encoge hasta
   * él, también si la escena no cambia de nivel.
   */
  readonly escalaDeTraspaso?: number | undefined;
}

const QUIETO: Movimiento = { tipo: "quieto" };

const salto = (proyectar: Proyectar, desde: Coordenada, hasta: Coordenada): Salto => {
  const a = proyectar(desde);
  const b = proyectar(hasta);
  return { x: b.x - a.x, y: b.y - a.y };
};

/** Si un movimiento entre dos sitios del mapa pasa por la pantalla. */
const cruzaLaPantalla = (
  cambio: CambioDeEscena,
  desde: Coordenada,
  hasta: Coordenada | undefined,
): boolean =>
  cambio.seVe(cambio.proyectar(desde)) ||
  (hasta !== undefined && cambio.seVe(cambio.proyectar(hasta)));

/**
 * Se anima al cambiar de nivel y, en el mismo nivel, cuando la transición dice algo: al llegar
 * una provincia, sus emplazamientos salen de su hexágono (ADR 0016).
 */
const hayQueAnimar = (cambio: CambioDeEscena): boolean =>
  !cambio.reducido &&
  cambio.anterior !== undefined &&
  (cambio.anterior.nivel !== cambio.nueva.nivel ||
    cambio.escalaDeTraspaso !== undefined ||
    cambio.transicion.destino.size + cambio.transicion.origen.size > 0);

/** Lo pequeño que empieza o acaba un logo sin origen ni destino: su punto, en un traspaso. */
const escalaDe = (elemento: Elemento, cambio: CambioDeEscena): { escala?: number } =>
  elemento.tipo === "emplazamiento" && cambio.escalaDeTraspaso !== undefined
    ? { escala: cambio.escalaDeTraspaso }
    : {};

/** Qué pasa con lo que estaba pintado y no está en la escena nueva: se va o se quita ya. */
const loQueSeVa = (pintado: Pintado, cambio: CambioDeEscena): Pintado | undefined => {
  if (cambio.reducido) return undefined;
  if (pintado.quitarEn !== undefined) {
    return pintado.quitarEn > cambio.ahora ? pintado : undefined;
  }
  const { posicion, clave } = pintado.elemento;
  const destino = cambio.nueva.elementos.get(cambio.transicion.destino.get(clave) ?? "");
  if (!hayQueAnimar(cambio) || !cruzaLaPantalla(cambio, posicion, destino?.posicion)) {
    return undefined;
  }
  return {
    elemento: pintado.elemento,
    movimiento:
      destino === undefined
        ? { tipo: "sale", hacia: undefined, ...escalaDe(pintado.elemento, cambio) }
        : { tipo: "sale", hacia: salto(cambio.proyectar, posicion, destino.posicion) },
    quitarEn: cambio.ahora + DURACION_MOVIMIENTO_MS,
  };
};

/** Cómo aparece lo que llega con la escena nueva. */
const comoLlega = (elemento: Elemento, cambio: CambioDeEscena): Movimiento => {
  const origen = cambio.anterior?.elementos.get(cambio.transicion.origen.get(elemento.clave) ?? "");
  if (!hayQueAnimar(cambio) || !cruzaLaPantalla(cambio, elemento.posicion, origen?.posicion)) {
    return QUIETO;
  }
  return origen === undefined
    ? { tipo: "entra", desde: undefined, ...escalaDe(elemento, cambio) }
    : { tipo: "entra", desde: salto(cambio.proyectar, elemento.posicion, origen.posicion) };
};

/**
 * Lo que queda en el DOM al pasar de la escena `anterior` a `nueva`.
 *
 * - Lo que sigue se queda donde estaba en la lista, para que el DOM no mueva nodos.
 * - Al cambiar de nivel, lo que desaparece se desliza hacia su destino y se quita pasado
 *   `DURACION_MOVIMIENTO_MS`, y lo que aparece sale de su origen.
 * - Solo se anima lo que se ve: lo que se va fuera de la pantalla se quita ya y lo que llega fuera
 *   de ella aparece sin transición. Así un cambio de nivel toca los menos nodos posibles.
 * - En el mismo nivel (el mapa se ha desplazado), lo que desaparece está fuera de la vista y se
 *   quita ya, y lo que aparece lo hace sin transición. Salvo si llega una provincia: sus
 *   emplazamientos salen del hexágono que la representaba.
 * - Con `reducido` (la preferencia de reducir movimiento) todo cambia de golpe.
 */
export const siguientesPintados = (
  pintados: ReadonlyArray<Pintado>,
  cambio: CambioDeEscena,
): ReadonlyArray<Pintado> => {
  const resultado: Array<Pintado> = [];
  const siguen = new Set<string>();
  for (const pintado of pintados) {
    const sigue = cambio.nueva.elementos.get(pintado.elemento.clave);
    if (sigue === undefined) {
      const seVa = loQueSeVa(pintado, cambio);
      if (seVa !== undefined) resultado.push(seVa);
      continue;
    }
    siguen.add(sigue.clave);
    // Si se estaba yendo, vuelve a su sitio desde donde esté.
    const movimiento = pintado.movimiento.tipo === "sale" ? QUIETO : pintado.movimiento;
    resultado.push({ elemento: sigue, movimiento, quitarEn: undefined });
  }
  for (const elemento of cambio.nueva.elementos.values()) {
    if (!siguen.has(elemento.clave)) {
      resultado.push({ elemento, movimiento: comoLlega(elemento, cambio), quitarEn: undefined });
    }
  }
  return resultado;
};

/** Quita del DOM lo que ya ha terminado de irse. */
export const quitarLosIdos = (
  pintados: ReadonlyArray<Pintado>,
  ahora: number,
): ReadonlyArray<Pintado> =>
  pintados.some((p) => p.quitarEn !== undefined && p.quitarEn <= ahora)
    ? pintados.filter((p) => p.quitarEn === undefined || p.quitarEn > ahora)
    : pintados;
