/**
 * El dibujo de la marca de Celda como datos. De aquí salen el SVG de la cabecera (`MarcaCelda`),
 * el favicon, los iconos PNG y el manifiesto (`iconos.ts`), así que cabecera e iconos no se
 * pueden separar.
 *
 * La marca es una Trifuerza reinterpretada, no la de Nintendo: tres triángulos que, en un mapa de
 * celdas, son emplazamientos y sus tres sectores de 120°. `B` es la vigente; `B1`, `B2` y `B3` son
 * el PROTOTIPO que la mejora, y se eligen con `?logo=`.
 *
 * Todo va en una caja de 32 × 32. Cada pieza lleva un tono y no un color: quien la pinta decide
 * con qué token (la cabecera con clases del tema, los iconos con los valores de `tema.css`).
 */

export type Punto = readonly [x: number, y: number];

/** `tinta` es la figura; `acento`, el detalle de color; `claro`, lo que se recorta en la figura. */
export type Tono = "tinta" | "acento" | "claro";

export interface Pieza {
  readonly tono: Tono;
  /** Uno o más contornos, rellenos par-impar: un contorno dentro de otro es un agujero. */
  readonly contornos: ReadonlyArray<ReadonlyArray<Punto>>;
}

export type VarianteMarca = "B" | "B1" | "B2" | "B3";

export interface Marca {
  readonly nombre: string;
  /** Qué cuenta el dibujo, en una frase. */
  readonly idea: string;
  /** Piezas en orden de pintado. */
  readonly piezas: ReadonlyArray<Pieza>;
}

const RAIZ3 = Math.sqrt(3);
const CENTRO: Punto = [16, 16];

const redondear = (valor: number): number => Math.round(valor * 100) / 100;

const polar = (centro: Punto, radio: number, grados: number): Punto => {
  const angulo = (grados * Math.PI) / 180;
  return [centro[0] + radio * Math.cos(angulo), centro[1] + radio * Math.sin(angulo)];
};

/** Hexágono con vértices arriba y abajo, como las agrupaciones del mapa. */
const hexagono = (centro: Punto, radio: number): ReadonlyArray<Punto> =>
  [-90, -30, 30, 90, 150, 210].map((grados) => polar(centro, radio, grados));

/** Un triángulo con el vértice arriba, inscrito en una circunferencia de `radio`. */
const triangulo = (centro: Punto, radio: number): ReadonlyArray<Punto> =>
  [-90, 30, 150].map((grados) => polar(centro, radio, grados));

interface Trifuerza {
  /** Los tres triángulos de las esquinas; el del centro queda hueco. */
  readonly triangulos: ReadonlyArray<ReadonlyArray<Punto>>;
  /** Los vértices del hueco, abajo, arriba a la izquierda y arriba a la derecha. */
  readonly hueco: ReadonlyArray<Punto>;
}

/** Un triángulo partido en cuatro, con su centro de gravedad en `centro`. */
const trifuerza = (centro: Punto, lado: number): Trifuerza => {
  const alto = (lado * RAIZ3) / 2;
  const [cx, cy] = centro;
  const arriba: Punto = [cx, cy - (2 * alto) / 3];
  const abajoIzquierda: Punto = [cx - lado / 2, cy + alto / 3];
  const abajoDerecha: Punto = [cx + lado / 2, cy + alto / 3];
  const medio = (a: Punto, b: Punto): Punto => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const medioIzquierda = medio(arriba, abajoIzquierda);
  const medioDerecha = medio(arriba, abajoDerecha);
  const medioAbajo = medio(abajoIzquierda, abajoDerecha);
  return {
    triangulos: [
      [arriba, medioDerecha, medioIzquierda],
      [medioIzquierda, medioAbajo, abajoIzquierda],
      [medioDerecha, abajoDerecha, medioAbajo],
    ],
    hueco: [medioAbajo, medioIzquierda, medioDerecha],
  };
};

/** Encoge o agranda una figura alrededor de un punto. */
const escalar = (
  figura: ReadonlyArray<Punto>,
  centro: Punto,
  factor: number,
): ReadonlyArray<Punto> =>
  figura.map(([x, y]) => [
    centro[0] + (x - centro[0]) * factor,
    centro[1] + (y - centro[1]) * factor,
  ]);

/** Un trazo recto de `a` a `b` como rectángulo, para que el rasterizador no necesite trazos. */
const segmento = (a: Punto, b: Punto, grosor: number): ReadonlyArray<Punto> => {
  const largo = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = (-(b[1] - a[1]) / largo) * (grosor / 2);
  const ny = ((b[0] - a[0]) / largo) * (grosor / 2);
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ];
};

const pieza = (tono: Tono, ...contornos: ReadonlyArray<ReadonlyArray<Punto>>): Pieza => ({
  tono,
  contornos: contornos.map((contorno) => contorno.map(([x, y]) => [redondear(x), redondear(y)])),
});

/** El hexágono oscuro con borde de color de las agrupaciones del mapa. */
const agrupacion = (): ReadonlyArray<Pieza> => [
  pieza("tinta", hexagono(CENTRO, 15.6)),
  pieza("acento", hexagono(CENTRO, 14.1), hexagono(CENTRO, 12.7)),
];

/** B, la vigente: el hexágono de las agrupaciones con la Trifuerza recortada dentro. */
const celda = (): Marca => ({
  nombre: "Celda",
  idea: "El hexágono de las agrupaciones con la Trifuerza recortada dentro.",
  piezas: [...agrupacion(), ...trifuerza([16, 16.6], 18).triangulos.map((t) => pieza("claro", t))],
});

/**
 * B1 · Emplazamiento en su celda. Como en los esquemas de celdas, el emplazamiento es un
 * triángulo en el centro de su hexágono. Aquí ese triángulo es la Trifuerza, oscura sobre una
 * celda clara con borde grueso.
 */
const emplazamientoEnSuCelda = (): Marca => ({
  nombre: "Emplazamiento en su celda",
  idea: "La celda clara con su emplazamiento en medio, que es la Trifuerza.",
  piezas: [
    pieza("tinta", hexagono(CENTRO, 15.6), hexagono(CENTRO, 12.4)),
    pieza("claro", hexagono(CENTRO, 12.4)),
    ...trifuerza([16, 16.9], 15.5).triangulos.map((t) => pieza("tinta", t)),
  ],
});

/**
 * B2 · Tres celdas vecinas. Tres celdas que se tocan en un punto, cada una con su emplazamiento.
 * El triángulo inscrito en un hexágono llega a sus vértices alternos, así que los tres triángulos
 * juntos forman la Trifuerza; encogidos, se leen a la vez como tres emplazamientos.
 */
const tresCeldas = (): Marca => {
  const radio = 8.9;
  // El punto donde se tocan las tres celdas, con la figura centrada en la caja.
  const encuentro: Punto = [16, 16 + (2 * radio - 1.5 * radio) / 2];
  const centros = [-90, 30, 150].map((grados) => polar(encuentro, radio, grados));
  return {
    nombre: "Tres celdas vecinas",
    idea: "Tres celdas que se tocan; sus tres emplazamientos juntos forman la Trifuerza.",
    piezas: centros.flatMap((centro) => [
      pieza("tinta", hexagono(centro, radio * 0.93)),
      pieza("acento", hexagono(centro, radio * 0.8), hexagono(centro, radio * 0.7)),
      pieza("claro", escalar(triangulo(centro, radio), centro, 0.66)),
    ]),
  };
};

/**
 * B3 · Tres sectores. La celda partida en sus tres sectores de 120°, con una línea desde cada
 * vértice del hueco de la Trifuerza hasta el borde: cada triángulo es el emplazamiento que da
 * servicio a su sector.
 */
const tresSectores = (): Marca => {
  const t = trifuerza(CENTRO, 17);
  const limites = t.hueco.map((vertice) => {
    const grados = (Math.atan2(vertice[1] - CENTRO[1], vertice[0] - CENTRO[0]) * 180) / Math.PI;
    return segmento(vertice, polar(CENTRO, 13.2, grados), 1.9);
  });
  return {
    nombre: "Tres sectores",
    idea: "La celda partida en tres sectores, cada uno con su triángulo de la Trifuerza.",
    piezas: [
      ...agrupacion(),
      ...limites.map((limite) => pieza("claro", limite)),
      ...t.triangulos.map((triangulo) => pieza("claro", triangulo)),
    ],
  };
};

export const VARIANTES_MARCA: ReadonlyArray<VarianteMarca> = ["B", "B1", "B2", "B3"];

export const MARCAS: Readonly<Record<VarianteMarca, Marca>> = {
  B: celda(),
  B1: emplazamientoEnSuCelda(),
  B2: tresCeldas(),
  B3: tresSectores(),
};

/** La marca de la web cuando la URL no pide otra. */
export const MARCA_VIGENTE: VarianteMarca = "B";

export const CAJA_MARCA = 32;

/** El atributo `d` de un polígono con varios contornos. */
export const trayecto = (contornos: ReadonlyArray<ReadonlyArray<Punto>>): string =>
  contornos.map((contorno) => `M${contorno.map(([x, y]) => `${x} ${y}`).join("L")}Z`).join("");

/** Dónde se sirven los iconos de cada variante. La vigente va sin prefijo de prototipo. */
export const carpetaDeIconos = (variante: VarianteMarca): string =>
  variante === MARCA_VIGENTE ? "/iconos" : `/iconos/prototipo-${variante.toLowerCase()}`;

export const ICONOS = {
  svg: "favicon.svg",
  png32: "favicon-32.png",
  toque: "apple-touch-icon.png",
  png192: "icono-192.png",
  png512: "icono-512.png",
  manifiesto: "manifest.webmanifest",
} as const;
