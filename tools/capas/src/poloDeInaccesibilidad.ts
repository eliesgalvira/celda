/**
 * El polo de inaccesibilidad de un polígono: el punto de dentro más alejado de sus bordes, con
 * una precisión dada. Es el algoritmo de polylabel (Mapbox, 2016): se cubre la caja del polígono
 * con celdas cuadradas y se parten primero las que aún pueden tener un punto mejor que el mejor
 * encontrado, hasta que ninguna puede mejorarlo en más de la precisión.
 *
 * Trabaja en un plano: quien lo llama proyecta antes. El centro visual de una provincia se calcula
 * en Mercator, que es como se ve el mapa (`centros.ts`).
 */

/** Un punto del plano. */
export type PuntoPlano = readonly [number, number];

/** Un polígono del plano: el anillo exterior y, detrás, sus agujeros. Cada anillo, cerrado o no. */
export type PoligonoPlano = ReadonlyArray<ReadonlyArray<PuntoPlano>>;

/** El polo y su distancia al borde más cercano, en las unidades del plano. */
export interface Polo {
  readonly x: number;
  readonly y: number;
  readonly distancia: number;
}

/** El cuadrado de la distancia de un punto a un segmento. */
const distancia2AlSegmento = (
  px: number,
  py: number,
  [ax, ay]: PuntoPlano,
  [bx, by]: PuntoPlano,
): number => {
  let x = ax;
  let y = ay;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = bx;
      y = by;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  return (px - x) ** 2 + (py - y) ** 2;
};

/** La distancia del punto al borde más cercano: positiva dentro del polígono y negativa fuera. */
export const distanciaConSigno = (x: number, y: number, poligono: PoligonoPlano): number => {
  let dentro = false;
  let minima = Number.POSITIVE_INFINITY;
  for (const anillo of poligono) {
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i, i++) {
      const a = anillo[i] ?? [0, 0];
      const b = anillo[j] ?? [0, 0];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
        dentro = !dentro;
      }
      minima = Math.min(minima, distancia2AlSegmento(x, y, a, b));
    }
  }
  return (dentro ? 1 : -1) * Math.sqrt(minima);
};

/** Una celda cuadrada de lado `2 * mitad` centrada en (`x`, `y`). */
interface Celda {
  readonly x: number;
  readonly y: number;
  readonly mitad: number;
  /** Distancia de su centro al borde. */
  readonly distancia: number;
  /** Lo más lejos del borde que puede quedar un punto de la celda. */
  readonly maximo: number;
}

const celda = (x: number, y: number, mitad: number, poligono: PoligonoPlano): Celda => {
  const distancia = distanciaConSigno(x, y, poligono);
  return { x, y, mitad, distancia, maximo: distancia + mitad * Math.SQRT2 };
};

/** Una cola de prioridad de celdas: sale primero la de mayor `maximo`. */
class Cola {
  private readonly celdas: Array<Celda> = [];

  meter(nueva: Celda): void {
    const celdas = this.celdas;
    celdas.push(nueva);
    let i = celdas.length - 1;
    while (i > 0) {
      const padre = (i - 1) >> 1;
      const arriba = celdas[padre];
      if (arriba === undefined || arriba.maximo >= nueva.maximo) break;
      celdas[i] = arriba;
      i = padre;
    }
    celdas[i] = nueva;
  }

  sacar(): Celda | undefined {
    const celdas = this.celdas;
    const primera = celdas[0];
    const ultima = celdas.pop();
    if (primera === undefined || ultima === undefined || celdas.length === 0) return primera;
    let i = 0;
    for (;;) {
      const izquierda = 2 * i + 1;
      const derecha = izquierda + 1;
      let mayor = i;
      let valor = ultima.maximo;
      const a = celdas[izquierda];
      const b = celdas[derecha];
      if (a !== undefined && a.maximo > valor) {
        mayor = izquierda;
        valor = a.maximo;
      }
      if (b !== undefined && b.maximo > valor) mayor = derecha;
      if (mayor === i) break;
      celdas[i] = celdas[mayor] ?? ultima;
      i = mayor;
    }
    celdas[i] = ultima;
    return primera;
  }
}

/** El centroide del anillo exterior, la primera apuesta. */
const centroide = (poligono: PoligonoPlano): PuntoPlano | undefined => {
  const anillo = poligono[0] ?? [];
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i, i++) {
    const [ax, ay] = anillo[i] ?? [0, 0];
    const [bx, by] = anillo[j] ?? [0, 0];
    const f = ax * by - bx * ay;
    cx += (ax + bx) * f;
    cy += (ay + by) * f;
    area += f * 3;
  }
  return area === 0 ? undefined : [cx / area, cy / area];
};

/**
 * El polo de inaccesibilidad de `poligono`, con `precision` en sus unidades: ningún punto del
 * polígono queda más de `precision` más lejos del borde que el devuelto.
 */
export const poloDeInaccesibilidad = (poligono: PoligonoPlano, precision: number): Polo => {
  const exterior = poligono[0] ?? [];
  const xs = exterior.map(([x]) => x);
  const ys = exterior.map(([, y]) => y);
  const oeste = Math.min(...xs);
  const sur = Math.min(...ys);
  const ancho = Math.max(...xs) - oeste;
  const alto = Math.max(...ys) - sur;
  const lado = Math.min(ancho, alto);
  if (lado === 0) return { x: oeste, y: sur, distancia: 0 };
  const cola = new Cola();
  for (let x = oeste; x < oeste + ancho; x += lado) {
    for (let y = sur; y < sur + alto; y += lado) {
      cola.meter(celda(x + lado / 2, y + lado / 2, lado / 2, poligono));
    }
  }
  const [cx, cy] = centroide(poligono) ?? [oeste, sur];
  let mejor = celda(cx, cy, 0, poligono);
  const medio = celda(oeste + ancho / 2, sur + alto / 2, 0, poligono);
  if (medio.distancia > mejor.distancia) mejor = medio;
  for (let actual = cola.sacar(); actual !== undefined; actual = cola.sacar()) {
    if (actual.distancia > mejor.distancia) mejor = actual;
    if (actual.maximo - mejor.distancia <= precision) continue;
    const mitad = actual.mitad / 2;
    cola.meter(celda(actual.x - mitad, actual.y - mitad, mitad, poligono));
    cola.meter(celda(actual.x + mitad, actual.y - mitad, mitad, poligono));
    cola.meter(celda(actual.x - mitad, actual.y + mitad, mitad, poligono));
    cola.meter(celda(actual.x + mitad, actual.y + mitad, mitad, poligono));
  }
  return { x: mejor.x, y: mejor.y, distancia: mejor.distancia };
};
