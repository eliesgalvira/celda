/**
 * Un rasterizador mínimo para los PNG de la marca, sin dependencias: los iconos y la imagen para
 * compartir (`compartir.ts`).
 * Rellena polígonos con suavizado: exacto en horizontal y con 16 muestras por fila de píxeles en
 * vertical. Pinta además discos con su borde suavizado, cada uno encima del anterior, para que
 * muchos juntos se lean como densidad.
 */
import type { Punto } from "./geometria.ts";

export interface Rgb {
  /** Canales sRGB entre 0 y 1. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Polígonos de un color. Con `par-impar`, la regla por defecto, un contorno dentro de otro es un
 * agujero. Con `no-cero`, los contornos que van en el mismo sentido se suman: así se unen los
 * tramos de un trazo, que se solapan en las juntas.
 */
export interface CapaDePoligonos {
  readonly contornos: ReadonlyArray<ReadonlyArray<Punto>>;
  readonly color: Rgb;
  readonly regla?: "par-impar" | "no-cero";
}

/** Discos de un color, con sus centros en pares `x, y`. */
export interface CapaDeDiscos {
  readonly centros: ArrayLike<number>;
  readonly radio: number;
  readonly color: Rgb;
  /** Lo que tapa cada disco. Donde se juntan varios, se tapan unos a otros. */
  readonly opacidad: number;
}

export type Capa = CapaDePoligonos | CapaDeDiscos;

const MUESTRAS = 16;

interface Borde {
  readonly arriba: number;
  readonly abajo: number;
  /** La x en `arriba`. */
  readonly x: number;
  readonly pendiente: number;
  /** 1 si el contorno baja por este borde, -1 si sube. */
  readonly sentido: 1 | -1;
}

const bordesDe = (contornos: ReadonlyArray<ReadonlyArray<Punto>>): Array<Borde> => {
  const bordes: Array<Borde> = [];
  for (const contorno of contornos) {
    for (let i = 0; i < contorno.length; i += 1) {
      const a = contorno[i];
      const b = contorno[(i + 1) % contorno.length];
      if (a === undefined || b === undefined || a[1] === b[1]) continue;
      const [arriba, abajo] = a[1] < b[1] ? [a, b] : [b, a];
      bordes.push({
        arriba: arriba[1],
        abajo: abajo[1],
        x: arriba[0],
        pendiente: (abajo[0] - arriba[0]) / (abajo[1] - arriba[1]),
        sentido: a[1] < b[1] ? 1 : -1,
      });
    }
  }
  return bordes.sort((p, q) => p.arriba - q.arriba);
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

interface Corte {
  readonly x: number;
  readonly sentido: number;
}

/** Dónde corta la línea horizontal `y` los bordes activos, de izquierda a derecha. */
const cortesEn = (activos: ReadonlyArray<Borde>, y: number): Array<Corte> =>
  activos
    .filter((borde) => y >= borde.arriba && y < borde.abajo)
    .map((borde) => ({ x: borde.x + (y - borde.arriba) * borde.pendiente, sentido: borde.sentido }))
    .sort((p, q) => p.x - q.x);

/** Los tramos de una muestra que quedan dentro, según la regla. */
const tramosDentro = (cortes: ReadonlyArray<Corte>, noCero: boolean): Array<[number, number]> => {
  const tramos: Array<[number, number]> = [];
  let vueltas = 0;
  let desde = 0;
  for (const corte of cortes) {
    const antes = vueltas;
    vueltas = noCero ? vueltas + corte.sentido : vueltas === 0 ? 1 : 0;
    if (antes === 0 && vueltas !== 0) desde = corte.x;
    else if (antes !== 0 && vueltas === 0) tramos.push([desde, corte.x]);
  }
  return tramos;
};

/**
 * Cuánto de cada píxel cubre una capa de polígonos, de 0 a 1. Cada fila solo mira los bordes que
 * la cruzan.
 */
const cobertura = (ancho: number, alto: number, capa: CapaDePoligonos): Float32Array => {
  const cubierto = new Float32Array(ancho * alto);
  const bordes = bordesDe(capa.contornos);
  const noCero = capa.regla === "no-cero";
  let activos: Array<Borde> = [];
  let siguiente = 0;
  for (let fila = 0; fila < alto; fila += 1) {
    for (
      let borde = bordes[siguiente];
      borde !== undefined && borde.arriba < fila + 1;
      borde = bordes[siguiente]
    ) {
      activos.push(borde);
      siguiente += 1;
    }
    activos = activos.filter((borde) => borde.abajo > fila);
    if (activos.length === 0) continue;
    const pixeles = cubierto.subarray(fila * ancho, (fila + 1) * ancho);
    for (let muestra = 0; muestra < MUESTRAS; muestra += 1) {
      const y = fila + (muestra + 0.5) / MUESTRAS;
      for (const [desde, hasta] of tramosDentro(cortesEn(activos, y), noCero)) {
        const d = Math.max(0, desde);
        const h = Math.min(ancho, hasta);
        if (h > d) sumarTramo(pixeles, d, h);
      }
    }
  }
  return cubierto;
};

/** Pinta las capas en orden sobre un fondo transparente. Devuelve RGBA de 8 bits por canal. */
export const rasterizar = (ancho: number, alto: number, capas: ReadonlyArray<Capa>): Uint8Array => {
  const color = new Float32Array(ancho * alto * 3);
  const alfa = new Float32Array(ancho * alto);
  const mezclar = (i: number, capa: Rgb, nuevo: number) => {
    const previo = alfa[i] ?? 0;
    const total = nuevo + previo * (1 - nuevo);
    const canal = (indice: number, valor: number) => {
      color[indice] = (valor * nuevo + (color[indice] ?? 0) * previo * (1 - nuevo)) / total;
    };
    canal(i * 3, capa.r);
    canal(i * 3 + 1, capa.g);
    canal(i * 3 + 2, capa.b);
    alfa[i] = total;
  };
  for (const capa of capas) {
    if ("centros" in capa) {
      const { centros, radio, opacidad } = capa;
      for (let k = 0; k + 1 < centros.length; k += 2) {
        const cx = centros[k] ?? 0;
        const cy = centros[k + 1] ?? 0;
        const y0 = Math.max(0, Math.floor(cy - radio - 1));
        const y1 = Math.min(alto - 1, Math.ceil(cy + radio + 1));
        const x0 = Math.max(0, Math.floor(cx - radio - 1));
        const x1 = Math.min(ancho - 1, Math.ceil(cx + radio + 1));
        for (let y = y0; y <= y1; y += 1) {
          for (let x = x0; x <= x1; x += 1) {
            // El borde se suaviza a lo largo de un píxel, centrado en el radio.
            const tapa = Math.min(1, radio + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
            if (tapa > 0) mezclar(y * ancho + x, capa.color, tapa * opacidad);
          }
        }
      }
      continue;
    }
    const cubierto = cobertura(ancho, alto, capa);
    for (let i = 0; i < cubierto.length; i += 1) {
      const nuevo = Math.min(1, cubierto[i] ?? 0);
      if (nuevo > 0) mezclar(i, capa.color, nuevo);
    }
  }
  const pixeles = new Uint8Array(ancho * alto * 4);
  for (let i = 0; i < alfa.length; i += 1) {
    pixeles[i * 4] = Math.round((color[i * 3] ?? 0) * 255);
    pixeles[i * 4 + 1] = Math.round((color[i * 3 + 1] ?? 0) * 255);
    pixeles[i * 4 + 2] = Math.round((color[i * 3 + 2] ?? 0) * 255);
    pixeles[i * 4 + 3] = Math.round((alfa[i] ?? 0) * 255);
  }
  return pixeles;
};
