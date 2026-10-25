/**
 * Un codificador de PNG mínimo, sin dependencias, para los iconos y la imagen para compartir.
 */
import * as NodeZlib from "node:zlib";

const trozo = (tipo: string, datos: Uint8Array): Uint8Array => {
  const cabecera = Buffer.alloc(8);
  cabecera.writeUInt32BE(datos.length, 0);
  cabecera.write(tipo, 4, "ascii");
  const cola = Buffer.alloc(4);
  cola.writeUInt32BE(NodeZlib.crc32(Buffer.concat([cabecera.subarray(4), datos])), 0);
  return Buffer.concat([cabecera, datos, cola]);
};

/** El predictor de Paeth del formato PNG: el vecino, de los tres, más cerca de su estimación. */
const paeth = (izquierda: number, arriba: number, diagonal: number): number => {
  const p = izquierda + arriba - diagonal;
  const pi = Math.abs(p - izquierda);
  const pa = Math.abs(p - arriba);
  const pd = Math.abs(p - diagonal);
  return pi <= pa && pi <= pd ? izquierda : pa <= pd ? arriba : diagonal;
};

/**
 * Las filas con el filtro de PNG que deja los números más pequeños en cada una (ninguno, resta del
 * de la izquierda, del de arriba, de la media o Paeth), que es lo que mejor comprime después.
 */
const filasFiltradas = (ancho: number, alto: number, pixeles: Uint8Array): Uint8Array => {
  const largo = ancho * 4;
  const salida = new Uint8Array(alto * (largo + 1));
  const candidata = new Uint8Array(largo);
  for (let fila = 0; fila < alto; fila += 1) {
    const actual = pixeles.subarray(fila * largo, (fila + 1) * largo);
    const previa = fila > 0 ? pixeles.subarray((fila - 1) * largo, fila * largo) : undefined;
    let mejor = Infinity;
    for (let filtro = 0; filtro < 5; filtro += 1) {
      let suma = 0;
      for (let i = 0; i < largo; i += 1) {
        const x = actual[i] ?? 0;
        const a = i >= 4 ? (actual[i - 4] ?? 0) : 0;
        const b = previa?.[i] ?? 0;
        const c = i >= 4 ? (previa?.[i - 4] ?? 0) : 0;
        const prediccion =
          filtro === 0
            ? 0
            : filtro === 1
              ? a
              : filtro === 2
                ? b
                : filtro === 3
                  ? (a + b) >> 1
                  : paeth(a, b, c);
        const valor = (x - prediccion) & 0xff;
        candidata[i] = valor;
        suma += valor < 128 ? valor : 256 - valor;
      }
      if (suma < mejor) {
        mejor = suma;
        const inicio = fila * (largo + 1);
        salida[inicio] = filtro;
        salida.set(candidata, inicio + 1);
      }
    }
  }
  return salida;
};

/** Las filas con el filtro 0, ninguno: un byte de filtro y la fila tal cual. */
const filasSinFiltro = (ancho: number, alto: number, indices: Uint8Array): Uint8Array => {
  const salida = new Uint8Array(alto * (ancho + 1));
  for (let fila = 0; fila < alto; fila += 1) {
    salida.set(indices.subarray(fila * ancho, (fila + 1) * ancho), fila * (ancho + 1) + 1);
  }
  return salida;
};

/**
 * Los índices de una paleta de 256 colores o menos, si todos los píxeles son opacos y no hay más
 * colores.
 */
const enPaleta = (
  pixeles: Uint8Array,
): { readonly paleta: Uint8Array; readonly indices: Uint8Array } | undefined => {
  const colores = new Map<number, number>();
  const indices = new Uint8Array(pixeles.length / 4);
  for (let i = 0; i < indices.length; i += 1) {
    if (pixeles[i * 4 + 3] !== 255) return undefined;
    const color =
      ((pixeles[i * 4] ?? 0) << 16) | ((pixeles[i * 4 + 1] ?? 0) << 8) | (pixeles[i * 4 + 2] ?? 0);
    let indice = colores.get(color);
    if (indice === undefined) {
      if (colores.size === 256) return undefined;
      indice = colores.size;
      colores.set(color, indice);
    }
    indices[i] = indice;
  }
  const paleta = new Uint8Array(colores.size * 3);
  for (const [color, indice] of colores) {
    paleta[indice * 3] = color >> 16;
    paleta[indice * 3 + 1] = (color >> 8) & 0xff;
    paleta[indice * 3 + 2] = color & 0xff;
  }
  return { paleta, indices };
};

/**
 * Un PNG de 8 bits a partir de píxeles RGBA. Si todos son opacos y caben en 256 colores va con
 * paleta, un byte por píxel en vez de cuatro.
 */
export const codificarPng = (ancho: number, alto: number, pixeles: Uint8Array): Uint8Array => {
  const indexado = enPaleta(pixeles);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr.writeUInt8(8, 8);
  // Tipo de color: 3 es con paleta y 6, RGBA.
  ihdr.writeUInt8(indexado === undefined ? 6 : 3, 9);
  // Con paleta, los filtros no ayudan: los índices vecinos no tienen por qué parecerse.
  const filas =
    indexado === undefined
      ? filasFiltradas(ancho, alto, pixeles)
      : filasSinFiltro(ancho, alto, indexado.indices);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    ...(indexado === undefined ? [] : [trozo("PLTE", indexado.paleta)]),
    trozo("IDAT", NodeZlib.deflateSync(filas, { level: 9 })),
    trozo("IEND", new Uint8Array()),
  ]);
};
