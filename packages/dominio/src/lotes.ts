import type { Coordenada } from "./area.ts";

/**
 * Emplazamientos por lote de fichas. Con las fichas reales de Barcelona y cinco bandas por
 * estación base, un lote de 128 pesa unos 210 KB y 9 KB con gzip: cabe en la ventana inicial de
 * TCP (unos 14 KB), así que llega en un viaje. Barcelona son 11 ficheros por versión y toda España
 * (unos 100.000 emplazamientos), unos 800. Las medidas están en el ADR 0004. Con las medidas de
 * exposición del ministerio, un lote crece unos 8 KB con gzip y ya no cabe (ADR 0016, #73).
 */
export const EMPLAZAMIENTOS_POR_LOTE = 128;

/** Bits por eje de la curva de Hilbert: celdas de unos 40 m en longitud. */
const ORDEN = 20;
const LADO = 2 ** ORDEN;

const cuantizar = (valor: number, minimo: number, maximo: number): number =>
  Math.min(LADO - 1, Math.max(0, Math.floor(((valor - minimo) / (maximo - minimo)) * LADO)));

/**
 * Posición de un punto a lo largo de la curva de Hilbert que recorre el mundo entero. Dos
 * emplazamientos cercanos en la curva también lo están en el mapa, y así un lote junta
 * emplazamientos vecinos.
 */
export const indiceDeHilbert = (posicion: Coordenada): number => {
  let x = cuantizar(posicion.longitud, -180, 180);
  let y = cuantizar(posicion.latitud, -90, 90);
  let indice = 0;
  for (let s = LADO / 2; s >= 1; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    indice += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = LADO - 1 - x;
        y = LADO - 1 - y;
      }
      [x, y] = [y, x];
    }
  }
  return indice;
};

/**
 * Reparte los emplazamientos en lotes de `tamano`, por orden a lo largo de la curva de Hilbert
 * y, a igual posición, por clave. Devuelve las claves de cada lote. Es una función pura: los
 * mismos emplazamientos dan siempre los mismos lotes, lleguen en el orden que lleguen.
 */
export const repartirEnLotes = (
  emplazamientos: ReadonlyArray<{ readonly clave: string; readonly posicion: Coordenada }>,
  tamano: number = EMPLAZAMIENTOS_POR_LOTE,
): ReadonlyArray<ReadonlyArray<string>> => {
  const ordenados = emplazamientos
    .map((e) => ({ clave: e.clave, indice: indiceDeHilbert(e.posicion) }))
    .sort((a, b) =>
      a.indice !== b.indice
        ? a.indice - b.indice
        : a.clave < b.clave
          ? -1
          : a.clave > b.clave
            ? 1
            : 0,
    );
  return Array.from({ length: Math.ceil(ordenados.length / tamano) }, (_, i) =>
    ordenados.slice(i * tamano, (i + 1) * tamano).map((e) => e.clave),
  );
};
