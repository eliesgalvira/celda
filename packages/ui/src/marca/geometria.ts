/**
 * El dibujo de la marca de Celda como datos. De aquí salen el SVG de la cabecera (`MarcaCelda`),
 * el favicon, los iconos PNG y el manifiesto (`iconos.ts`), así que cabecera e iconos no se
 * pueden separar.
 *
 * La marca es la celda de un emplazamiento con sus tres sectores: el hexágono oscuro con borde de
 * color de las agrupaciones, partido en tres por líneas que salen del centro, con un triángulo en
 * cada sector. Los tres triángulos forman una Trifuerza reinterpretada, no la de Nintendo.
 *
 * Todo va en una caja de 32 × 32. Cada pieza lleva un tono y no un color: quien la pinta decide
 * con qué token (la cabecera con clases del tema, los iconos con los valores de `tema.css`).
 */

export type Punto = readonly [x: number, y: number];

/** `tinta` es la figura; `acento`, el borde de color; `claro`, lo que se recorta en la figura. */
export type Tono = "tinta" | "acento" | "claro";

export interface Pieza {
  readonly tono: Tono;
  /** Uno o más contornos, rellenos par-impar: un contorno dentro de otro es un agujero. */
  readonly contornos: ReadonlyArray<ReadonlyArray<Punto>>;
}

const RAIZ3 = Math.sqrt(3);
const CENTRO: Punto = [16, 16];

export const CAJA_MARCA = 32;

const redondear = (valor: number): number => Math.round(valor * 100) / 100;

const polar = (radio: number, grados: number): Punto => {
  const angulo = (grados * Math.PI) / 180;
  return [CENTRO[0] + radio * Math.cos(angulo), CENTRO[1] + radio * Math.sin(angulo)];
};

/** Hexágono con vértices arriba y abajo, como las agrupaciones del mapa. */
const hexagono = (radio: number): ReadonlyArray<Punto> =>
  [-90, -30, 30, 90, 150, 210].map((grados) => polar(radio, grados));

/**
 * Un triángulo partido en cuatro con su centro de gravedad en el de la caja: los tres de las
 * esquinas y los vértices del hueco del centro, que miran abajo, arriba a la izquierda y arriba a
 * la derecha.
 */
const trifuerza = (lado: number) => {
  const alto = (lado * RAIZ3) / 2;
  const [cx, cy] = CENTRO;
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

/** Un trazo de `desde` a `hasta` que se afila: `ancho` al empezar y `punta` al acabar. */
const trazoAfilado = (desde: Punto, hasta: Punto, ancho: number, punta: number) => {
  const largo = Math.hypot(hasta[0] - desde[0], hasta[1] - desde[1]);
  const nx = -(hasta[1] - desde[1]) / largo;
  const ny = (hasta[0] - desde[0]) / largo;
  return [
    [desde[0] + (nx * ancho) / 2, desde[1] + (ny * ancho) / 2],
    [hasta[0] + (nx * punta) / 2, hasta[1] + (ny * punta) / 2],
    [hasta[0] - (nx * punta) / 2, hasta[1] - (ny * punta) / 2],
    [desde[0] - (nx * ancho) / 2, desde[1] - (ny * ancho) / 2],
  ] as const;
};

const pieza = (tono: Tono, ...contornos: ReadonlyArray<ReadonlyArray<Punto>>): Pieza => ({
  tono,
  contornos: contornos.map((contorno) => contorno.map(([x, y]) => [redondear(x), redondear(y)])),
});

/**
 * Los límites entre sectores salen de los vértices del hueco y se afilan antes de llegar al
 * borde. Si lo tocaran, los tres rombos que quedan se leerían como un cubo.
 */
const piezas = (): ReadonlyArray<Pieza> => {
  const t = trifuerza(18);
  const limites = t.hueco.map((vertice) => {
    const grados = (Math.atan2(vertice[1] - CENTRO[1], vertice[0] - CENTRO[0]) * 180) / Math.PI;
    return trazoAfilado(vertice, polar(11.6, grados), 2, 0.5);
  });
  return [
    pieza("tinta", hexagono(15.6)),
    pieza("acento", hexagono(14.1), hexagono(12.7)),
    ...limites.map((limite) => pieza("claro", limite)),
    ...t.triangulos.map((triangulo) => pieza("claro", triangulo)),
  ];
};

/** Las piezas de la marca, en orden de pintado. */
export const MARCA: ReadonlyArray<Pieza> = piezas();

/** El atributo `d` de un polígono con varios contornos. */
export const trayecto = (contornos: ReadonlyArray<ReadonlyArray<Punto>>): string =>
  contornos.map((contorno) => `M${contorno.map(([x, y]) => `${x} ${y}`).join("L")}Z`).join("");

/** Dónde se sirven los iconos y cómo se llaman. */
export const CARPETA_ICONOS = "/iconos";

export const ICONOS = {
  svg: "favicon.svg",
  png32: "favicon-32.png",
  toque: "apple-touch-icon.png",
  png192: "icono-192.png",
  png512: "icono-512.png",
  manifiesto: "manifest.webmanifest",
} as const;
