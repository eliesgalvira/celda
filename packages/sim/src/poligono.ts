/**
 * Polígonos en el plano local de la malla, en metros. Un polígono es un `Float64Array` con sus
 * vértices seguidos, este y norte alternos (`[e₀, n₀, e₁, n₁, …]`), sin repetir el primero al
 * final. Las celdas los dan en sentido antihorario. Vacío, si no tiene área.
 */
export type Poligono = Float64Array;

/** Cuántos vértices tiene el polígono. */
export const verticesDe = (poligono: Poligono): number => poligono.length / 2;

/** Área con signo por la fórmula del lazo: positiva si los vértices van en sentido antihorario. */
export const areaConSigno = (poligono: Poligono): number => {
  const n = verticesDe(poligono);
  let doble = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    doble +=
      (poligono[2 * i] ?? 0) * (poligono[2 * j + 1] ?? 0) -
      (poligono[2 * j] ?? 0) * (poligono[2 * i + 1] ?? 0);
  }
  return doble / 2;
};

/** Área del polígono en metros cuadrados. */
export const area = (poligono: Poligono): number => Math.abs(areaConSigno(poligono));

/**
 * Si el punto `(este, norte)` cae dentro del polígono, por el recuento de cruces de un rayo. Vale
 * también para polígonos no convexos, como un sector de una celda. En el borde puede dar
 * cualquiera de las dos respuestas.
 */
export const contiene = (poligono: Poligono, este: number, norte: number): boolean => {
  const n = verticesDe(poligono);
  let dentro = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ei = poligono[2 * i] ?? 0;
    const ni = poligono[2 * i + 1] ?? 0;
    const ej = poligono[2 * j] ?? 0;
    const nj = poligono[2 * j + 1] ?? 0;
    if (ni > norte !== nj > norte && este < ((ej - ei) * (norte - ni)) / (nj - ni) + ei) {
      dentro = !dentro;
    }
  }
  return dentro;
};

/**
 * La parte de un polígono convexo con `a · este + b · norte ≤ c` (Sutherland y Hodgman con un
 * solo semiplano). Trabaja sobre arrays normales porque se llama muchas veces al calcular una
 * celda: si no recorta nada, devuelve el mismo array. Con menos de tres vértices queda vacío.
 */
export const recortar = (
  poligono: ReadonlyArray<number>,
  a: number,
  b: number,
  c: number,
): ReadonlyArray<number> => {
  const n = poligono.length / 2;
  let fuera = false;
  for (let i = 0; i < n; i++) {
    if (a * (poligono[2 * i] ?? 0) + b * (poligono[2 * i + 1] ?? 0) > c) {
      fuera = true;
      break;
    }
  }
  if (!fuera) return poligono;
  const resultado: Array<number> = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const e1 = poligono[2 * i] ?? 0;
    const n1 = poligono[2 * i + 1] ?? 0;
    const e2 = poligono[2 * j] ?? 0;
    const n2 = poligono[2 * j + 1] ?? 0;
    const s1 = a * e1 + b * n1 - c;
    const s2 = a * e2 + b * n2 - c;
    if (s1 <= 0) resultado.push(e1, n1);
    if ((s1 < 0 && s2 > 0) || (s1 > 0 && s2 < 0)) {
      const t = s1 / (s1 - s2);
      resultado.push(e1 + t * (e2 - e1), n1 + t * (n2 - n1));
    }
  }
  return resultado.length < 6 ? [] : resultado;
};
