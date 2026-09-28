/**
 * PROTOTIPO (logo y controles): el dibujo de la marca de Celda como datos. De aquí salen el SVG de
 * la cabecera (`MarcaCelda`), el favicon, los iconos PNG y el manifiesto (`iconos.ts`), así que
 * cabecera e iconos no se pueden separar.
 *
 * Las tres variantes reinterpretan la Trifuerza para el propósito de Celda sin copiarla: tres
 * triángulos alrededor de un hueco que, en un emplazamiento, son los tres sectores de 120°.
 *
 * Todo va en una caja de 32 × 32. Cada pieza lleva un tono y no un color: quien la pinta decide
 * con qué token (la cabecera con clases del tema, los iconos con los valores de `tema.css`).
 */

export type Punto = readonly [x: number, y: number];

/** `tinta` es la figura; `acento`, el detalle de color; `claro`, lo que se recorta en la figura. */
export type Tono = "tinta" | "acento" | "claro";

export type Pieza =
  | {
      readonly tipo: "poligono";
      readonly tono: Tono;
      /** Uno o más contornos, rellenos par-impar: un contorno dentro de otro es un agujero. */
      readonly contornos: ReadonlyArray<ReadonlyArray<Punto>>;
    }
  | {
      readonly tipo: "circulo";
      readonly tono: Tono;
      readonly centro: Punto;
      readonly radio: number;
    };

export type VarianteMarca = "actual" | "A" | "B" | "C";

export interface Marca {
  readonly nombre: string;
  /** Qué cuenta el dibujo, en una frase. */
  readonly idea: string;
  /**
   * Si el icono necesita una baldosa oscura detrás para verse en cualquier pestaña. La de la
   * celda ya es un hexágono oscuro y no la lleva.
   */
  readonly baldosa: boolean;
  /** Piezas en orden de pintado. */
  readonly piezas: ReadonlyArray<Pieza>;
}

const LADO = 32;
const RAIZ3 = Math.sqrt(3);

const redondear = (valor: number): number => Math.round(valor * 100) / 100;

/** Hexágono con vértices arriba y abajo, como las agrupaciones del mapa. */
const hexagono = (centro: Punto, radio: number): ReadonlyArray<Punto> =>
  [-90, -30, 30, 90, 150, 210].map((grados) => {
    const angulo = (grados * Math.PI) / 180;
    return [centro[0] + radio * Math.cos(angulo), centro[1] + radio * Math.sin(angulo)] as const;
  });

interface Trifuerza {
  readonly arriba: Punto;
  readonly abajoIzquierda: Punto;
  readonly abajoDerecha: Punto;
  readonly medioIzquierda: Punto;
  readonly medioDerecha: Punto;
  readonly medioAbajo: Punto;
}

/** Los seis vértices de un triángulo partido en cuatro, con su centro de gravedad en `centro`. */
const trifuerza = (centro: Punto, lado: number): Trifuerza => {
  const alto = (lado * RAIZ3) / 2;
  const [cx, cy] = centro;
  const arriba: Punto = [cx, cy - (2 * alto) / 3];
  const abajoIzquierda: Punto = [cx - lado / 2, cy + alto / 3];
  const abajoDerecha: Punto = [cx + lado / 2, cy + alto / 3];
  const medio = (a: Punto, b: Punto): Punto => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return {
    arriba,
    abajoIzquierda,
    abajoDerecha,
    medioIzquierda: medio(arriba, abajoIzquierda),
    medioDerecha: medio(arriba, abajoDerecha),
    medioAbajo: medio(abajoIzquierda, abajoDerecha),
  };
};

/** Los tres triángulos de las esquinas; el del centro queda hueco. */
const triangulos = (t: Trifuerza): ReadonlyArray<ReadonlyArray<Punto>> => [
  [t.arriba, t.medioDerecha, t.medioIzquierda],
  [t.medioIzquierda, t.medioAbajo, t.abajoIzquierda],
  [t.medioDerecha, t.abajoDerecha, t.medioAbajo],
];

/** Aleja un triángulo del centro, en la dirección de su propio centro de gravedad. */
const alejar = (
  triangulo: ReadonlyArray<Punto>,
  centro: Punto,
  distancia: number,
): ReadonlyArray<Punto> => {
  const gx = triangulo.reduce((suma, [x]) => suma + x, 0) / triangulo.length;
  const gy = triangulo.reduce((suma, [, y]) => suma + y, 0) / triangulo.length;
  const largo = Math.hypot(gx - centro[0], gy - centro[1]);
  const dx = ((gx - centro[0]) / largo) * distancia;
  const dy = ((gy - centro[1]) / largo) * distancia;
  return triangulo.map(([x, y]) => [x + dx, y + dy] as const);
};

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

const poligono = (tono: Tono, ...contornos: ReadonlyArray<ReadonlyArray<Punto>>): Pieza => ({
  tipo: "poligono",
  tono,
  contornos: contornos.map((contorno) => contorno.map(([x, y]) => [redondear(x), redondear(y)])),
});

const circulo = (tono: Tono, centro: Punto, radio: number): Pieza => ({
  tipo: "circulo",
  tono,
  centro: [redondear(centro[0]), redondear(centro[1])],
  radio,
});

/** La marca de hoy: un hexágono dentro de otro. */
const actual = (): Marca => {
  const centro: Punto = [16, 16];
  return {
    nombre: "Hexágono",
    idea: "La marca de hoy: un hexágono dentro de otro.",
    baldosa: true,
    piezas: [
      poligono("acento", hexagono(centro, 14.6), hexagono(centro, 12.8)),
      poligono("acento", hexagono(centro, 7.4)),
    ],
  };
};

/**
 * A · Tres sectores. La Trifuerza es un triángulo hueco con otro apuntando hacia fuera en cada
 * lado, a 120° uno de otro: los tres sectores de un emplazamiento. Se separan del centro, donde
 * queda el mástil como un hexágono pequeño.
 */
const sectores = (): Marca => {
  // Centro de gravedad bajado para que la figura, ya separada, quede centrada en la caja.
  const centro: Punto = [16, 20.2];
  const t = trifuerza(centro, 27);
  return {
    nombre: "Tres sectores",
    idea: "Los tres triángulos son los sectores de 120° de un emplazamiento, con el mástil en medio.",
    baldosa: true,
    piezas: [
      ...triangulos(t).map((triangulo) => poligono("tinta", alejar(triangulo, centro, 1.9))),
      poligono("acento", hexagono(centro, 3.3)),
    ],
  };
};

/**
 * B · Celda. El hexágono oscuro con borde de color de las agrupaciones, con la Trifuerza
 * recortada dentro: la celda y sus tres sectores.
 */
const celda = (): Marca => {
  const centro: Punto = [16, 16];
  const t = trifuerza([16, 16.6], 18);
  return {
    nombre: "Celda",
    idea: "El hexágono de las agrupaciones con los tres sectores recortados dentro.",
    baldosa: false,
    piezas: [
      poligono("tinta", hexagono(centro, 15.6)),
      poligono("acento", hexagono(centro, 14.1), hexagono(centro, 12.7)),
      ...triangulos(t).map((triangulo) => poligono("claro", triangulo)),
    ],
  };
};

/**
 * C · Triangulación. La Trifuerza como red: seis emplazamientos unidos con sus vecinos, como la
 * triangulación que acompaña a las celdas de Voronoi o un vértice geodésico. Los triángulos de
 * las esquinas van rellenos y el del centro queda hueco.
 */
const triangulacion = (): Marca => {
  const t = trifuerza([16, 19.4], 26);
  const nodos = [
    t.arriba,
    t.abajoIzquierda,
    t.abajoDerecha,
    t.medioIzquierda,
    t.medioDerecha,
    t.medioAbajo,
  ];
  const aristas: ReadonlyArray<readonly [Punto, Punto]> = [
    [t.arriba, t.abajoIzquierda],
    [t.abajoIzquierda, t.abajoDerecha],
    [t.abajoDerecha, t.arriba],
    [t.medioIzquierda, t.medioDerecha],
    [t.medioDerecha, t.medioAbajo],
    [t.medioAbajo, t.medioIzquierda],
  ];
  return {
    nombre: "Triangulación",
    idea: "Seis emplazamientos unidos con sus vecinos: una red de triángulos con el centro hueco.",
    baldosa: true,
    piezas: [
      ...triangulos(t).map((triangulo) => poligono("acento", triangulo)),
      ...aristas.map(([a, b]) => poligono("tinta", segmento(a, b, 2.3))),
      ...nodos.map((nodo) => circulo("tinta", nodo, 2.7)),
    ],
  };
};

export const VARIANTES_MARCA: ReadonlyArray<VarianteMarca> = ["actual", "A", "B", "C"];

export const MARCAS: Readonly<Record<VarianteMarca, Marca>> = {
  actual: actual(),
  A: sectores(),
  B: celda(),
  C: triangulacion(),
};

export const CAJA_MARCA = LADO;

/** El atributo `d` de un polígono con varios contornos. */
export const trayecto = (contornos: ReadonlyArray<ReadonlyArray<Punto>>): string =>
  contornos.map((contorno) => `M${contorno.map(([x, y]) => `${x} ${y}`).join("L")}Z`).join("");

/** Dónde se sirven los iconos de cada variante. La de hoy va sin prefijo de prototipo. */
export const carpetaDeIconos = (variante: VarianteMarca): string =>
  variante === "actual" ? "/iconos" : `/iconos/prototipo-${variante.toLowerCase()}`;

export const ICONOS = {
  svg: "favicon.svg",
  png32: "favicon-32.png",
  toque: "apple-touch-icon.png",
  png192: "icono-192.png",
  png512: "icono-512.png",
  manifiesto: "manifest.webmanifest",
} as const;
