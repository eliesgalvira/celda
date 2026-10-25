import * as NodeZlib from "node:zlib";

import { assert, describe, it } from "@effect/vitest";

import { codificarPng } from "./png.ts";

/** Los trozos de un PNG, por tipo. */
const trozos = (png: Uint8Array): Map<string, Uint8Array> => {
  const vista = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const salida = new Map<string, Uint8Array>();
  for (let i = 8; i < png.length;) {
    const largo = vista.getUint32(i);
    salida.set(
      String.fromCharCode(...png.subarray(i + 4, i + 8)),
      png.subarray(i + 8, i + 8 + largo),
    );
    i += 12 + largo;
  }
  return salida;
};

/** Un píxel RGBA por color, repetido. */
const imagen = (...colores: ReadonlyArray<readonly [number, number, number, number]>) =>
  new Uint8Array(colores.flat());

describe("codificador de PNG", () => {
  it("con pocos colores opacos va con paleta y los píxeles se recuperan", () => {
    const pixeles = imagen([10, 20, 30, 255], [200, 0, 0, 255], [10, 20, 30, 255], [0, 0, 0, 255]);
    const png = trozos(codificarPng(2, 2, pixeles));
    assert.strictEqual(png.get("IHDR")?.[9], 3);
    const paleta = png.get("PLTE") ?? new Uint8Array();
    const filas = NodeZlib.inflateSync(png.get("IDAT") ?? new Uint8Array());
    const recuperados: Array<number> = [];
    for (const fila of [0, 1]) {
      assert.strictEqual(filas[fila * 3], 0, "filtro de la fila");
      for (const columna of [1, 2]) {
        const indice = filas[fila * 3 + columna] ?? 0;
        recuperados.push(...paleta.subarray(indice * 3, indice * 3 + 3), 255);
      }
    }
    assert.deepStrictEqual(recuperados, [...pixeles]);
  });

  it("con algún píxel transparente va en RGBA", () => {
    const png = trozos(codificarPng(2, 1, imagen([0, 0, 0, 0], [0, 0, 0, 255])));
    assert.strictEqual(png.get("IHDR")?.[9], 6);
    assert.isFalse(png.has("PLTE"));
  });
});
