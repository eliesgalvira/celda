/**
 * Si un punto cae dentro de un polígono. Va aparte, sin dependencias, para que lo puedan importar
 * el contorno de la Comunitat Valenciana, que la web descarga aparte, y los límites de barrio sin
 * arrastrar nada más. Los polígonos van en grados, con cada vértice como `[longitud, latitud]`.
 */

/** Un punto, longitud y latitud. */
interface Punto {
  readonly longitud: number;
  readonly latitud: number;
}

/** Un anillo: sus vértices, repitiendo o no el primero al final. */
type AnilloEnGrados = ReadonlyArray<readonly [number, number]>;

/** El anillo exterior y, detrás, sus agujeros. */
export type PoligonoEnGrados = ReadonlyArray<AnilloEnGrados>;

/**
 * Si el punto cae dentro del anillo, por el número de cruces de un rayo hacia el este. Los
 * bordes son semiabiertos: un punto sobre el lado que comparten dos anillos vecinos cae en uno
 * solo de ellos. El corte con cada lado se calcula siempre desde su vértice más al sur, así que
 * da el mismo número aunque cada vecino recorra el lado en un sentido.
 */
const dentroDelAnillo = (x: number, y: number, anillo: AnilloEnGrados): boolean => {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i, i++) {
    const [xi = 0, yi = 0] = anillo[i] ?? [];
    const [xj = 0, yj = 0] = anillo[j] ?? [];
    if (yi > y !== yj > y) {
      const surEsI = yi < yj;
      const xa = surEsI ? xi : xj;
      const ya = surEsI ? yi : yj;
      const xb = surEsI ? xj : xi;
      const yb = surEsI ? yj : yi;
      if (x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) dentro = !dentro;
    }
  }
  return dentro;
};

/** Si el punto cae dentro del polígono: en su anillo exterior y fuera de sus agujeros. */
export const dentroDelPoligono = (punto: Punto, poligono: PoligonoEnGrados): boolean => {
  const [exterior, ...agujeros] = poligono;
  const { longitud: x, latitud: y } = punto;
  return (
    exterior !== undefined &&
    dentroDelAnillo(x, y, exterior) &&
    !agujeros.some((agujero) => dentroDelAnillo(x, y, agujero))
  );
};
