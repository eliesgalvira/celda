/**
 * PROTOTIPO (logo y controles): un rasterizador mínimo para los iconos PNG, sin dependencias.
 * Rellena polígonos par-impar con suavizado: exacto en horizontal y con 16 muestras por fila de
 * píxeles en vertical. Los iconos solo tienen polígonos y círculos, así que no hace falta más.
 */
import type { Punto } from "./geometria.ts";

export interface Rgb {
  /** Canales sRGB entre 0 y 1. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Capa {
  readonly contornos: ReadonlyArray<ReadonlyArray<Punto>>;
  readonly color: Rgb;
}

const MUESTRAS = 16;

/** Dónde corta la línea horizontal `y` los bordes de los contornos, de izquierda a derecha. */
const cortesEn = (
  contornos: ReadonlyArray<ReadonlyArray<Punto>>,
  y: number,
  cortes: Array<number>,
): void => {
  cortes.length = 0;
  for (const contorno of contornos) {
    for (let i = 0; i < contorno.length; i += 1) {
      const a = contorno[i];
      const b = contorno[(i + 1) % contorno.length];
      if (a === undefined || b === undefined || a[1] === b[1]) continue;
      const [arriba, abajo] = a[1] < b[1] ? [a, b] : [b, a];
      if (y < arriba[1] || y >= abajo[1]) continue;
      cortes.push(arriba[0] + ((y - arriba[1]) * (abajo[0] - arriba[0])) / (abajo[1] - arriba[1]));
    }
  }
  cortes.sort((x, z) => x - z);
};

/** Suma a una fila de píxeles lo que cubre el tramo de `desde` a `hasta` en una muestra. */
const sumarTramo = (fila: Float32Array, desde: number, hasta: number): void => {
  const primero = Math.floor(desde);
  const ultimo = Math.min(fila.length - 1, Math.floor(hasta));
  const sumar = (x: number, cuanto: number) => {
    fila[x] = (fila[x] ?? 0) + cuanto / MUESTRAS;
  };
  if (primero === ultimo) {
    sumar(primero, hasta - desde);
    return;
  }
  sumar(primero, primero + 1 - desde);
  for (let x = primero + 1; x < ultimo; x += 1) sumar(x, 1);
  sumar(ultimo, hasta - ultimo);
};

/** Cuánto de cada píxel cubre la capa, de 0 a 1. */
const cobertura = (
  tamano: number,
  contornos: ReadonlyArray<ReadonlyArray<Punto>>,
): Float32Array => {
  const cubierto = new Float32Array(tamano * tamano);
  const cortes: Array<number> = [];
  for (let fila = 0; fila < tamano; fila += 1) {
    const pixeles = cubierto.subarray(fila * tamano, (fila + 1) * tamano);
    for (let muestra = 0; muestra < MUESTRAS; muestra += 1) {
      cortesEn(contornos, fila + (muestra + 0.5) / MUESTRAS, cortes);
      for (let i = 0; i + 1 < cortes.length; i += 2) {
        const desde = Math.max(0, cortes[i] ?? 0);
        const hasta = Math.min(tamano, cortes[i + 1] ?? 0);
        if (hasta > desde) sumarTramo(pixeles, desde, hasta);
      }
    }
  }
  return cubierto;
};

/** Pinta las capas en orden sobre un fondo transparente. Devuelve RGBA de 8 bits por canal. */
export const rasterizar = (tamano: number, capas: ReadonlyArray<Capa>): Uint8Array => {
  const color = new Float32Array(tamano * tamano * 3);
  const alfa = new Float32Array(tamano * tamano);
  for (const capa of capas) {
    const cubierto = cobertura(tamano, capa.contornos);
    for (let i = 0; i < cubierto.length; i += 1) {
      const nuevo = Math.min(1, cubierto[i] ?? 0);
      if (nuevo === 0) continue;
      const previo = alfa[i] ?? 0;
      const total = nuevo + previo * (1 - nuevo);
      const mezclar = (canal: number, valor: number) => {
        const indice = i * 3 + canal;
        color[indice] = (valor * nuevo + (color[indice] ?? 0) * previo * (1 - nuevo)) / total;
      };
      mezclar(0, capa.color.r);
      mezclar(1, capa.color.g);
      mezclar(2, capa.color.b);
      alfa[i] = total;
    }
  }
  const pixeles = new Uint8Array(tamano * tamano * 4);
  for (let i = 0; i < alfa.length; i += 1) {
    pixeles[i * 4] = Math.round((color[i * 3] ?? 0) * 255);
    pixeles[i * 4 + 1] = Math.round((color[i * 3 + 1] ?? 0) * 255);
    pixeles[i * 4 + 2] = Math.round((color[i * 3 + 2] ?? 0) * 255);
    pixeles[i * 4 + 3] = Math.round((alfa[i] ?? 0) * 255);
  }
  return pixeles;
};

/** Un círculo como polígono de 64 lados, para el rasterizador. */
export const circuloComoPoligono = (centro: Punto, radio: number): ReadonlyArray<Punto> =>
  Array.from({ length: 64 }, (_, i) => {
    const angulo = (i / 64) * 2 * Math.PI;
    return [centro[0] + radio * Math.cos(angulo), centro[1] + radio * Math.sin(angulo)] as const;
  });
