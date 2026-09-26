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

const QUIETO: Movimiento = { tipo: "quieto" };

const salto = (proyectar: Proyectar, desde: Coordenada, hasta: Coordenada): Salto => {
  const a = proyectar(desde);
  const b = proyectar(hasta);
  return { x: b.x - a.x, y: b.y - a.y };
};

/**
 * Lo que queda en el DOM al pasar de la escena `anterior` a `nueva`.
 *
 * - Lo que sigue se queda donde estaba en la lista, para que el DOM no mueva nodos.
 * - Al cambiar de nivel, lo que desaparece se desliza hacia su destino y se quita pasado
 *   `DURACION_MOVIMIENTO_MS`, y lo que aparece sale de su origen.
 * - En el mismo nivel (el mapa se ha desplazado), lo que desaparece está fuera de la vista y se
 *   quita ya, y lo que aparece lo hace sin transición.
 * - Con `reducido` (la preferencia de reducir movimiento) todo cambia de golpe.
 */
export const siguientesPintados = (
  pintados: ReadonlyArray<Pintado>,
  anterior: Escena | undefined,
  nueva: Escena,
  transicion: Transicion,
  proyectar: Proyectar,
  ahora: number,
  reducido: boolean,
): ReadonlyArray<Pintado> => {
  const animar = !reducido && anterior !== undefined && anterior.nivel !== nueva.nivel;
  const resultado: Array<Pintado> = [];
  const siguen = new Set<string>();

  for (const pintado of pintados) {
    const { clave } = pintado.elemento;
    const sigue = nueva.elementos.get(clave);
    if (sigue !== undefined) {
      siguen.add(clave);
      // Si se estaba yendo, vuelve a su sitio desde donde esté.
      resultado.push({
        elemento: sigue,
        movimiento: pintado.movimiento.tipo === "sale" ? QUIETO : pintado.movimiento,
        quitarEn: undefined,
      });
      continue;
    }
    if (reducido) continue;
    if (pintado.quitarEn !== undefined) {
      if (pintado.quitarEn > ahora) resultado.push(pintado);
      continue;
    }
    if (!animar) continue;
    const destino = nueva.elementos.get(transicion.destino.get(clave) ?? "");
    resultado.push({
      elemento: pintado.elemento,
      movimiento: {
        tipo: "sale",
        hacia:
          destino === undefined
            ? undefined
            : salto(proyectar, pintado.elemento.posicion, destino.posicion),
      },
      quitarEn: ahora + DURACION_MOVIMIENTO_MS,
    });
  }

  for (const elemento of nueva.elementos.values()) {
    if (siguen.has(elemento.clave)) continue;
    const origen = anterior?.elementos.get(transicion.origen.get(elemento.clave) ?? "");
    resultado.push({
      elemento,
      movimiento: animar
        ? {
            tipo: "entra",
            desde:
              origen === undefined
                ? undefined
                : salto(proyectar, elemento.posicion, origen.posicion),
          }
        : QUIETO,
      quitarEn: undefined,
    });
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
