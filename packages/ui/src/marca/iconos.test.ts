import { assert, describe, it } from "@effect/vitest";

import tema from "../tema.css?raw";
import { MARCAS, VARIANTES_MARCA } from "./geometria.ts";
import { ficherosDeIconos, pixelesDeIcono, coloresDeIconos } from "./iconos.ts";

const ficheros = ficherosDeIconos(tema);

/** El alfa del píxel (x, y) de un icono RGBA. */
const alfa = (pixeles: Uint8Array, tamano: number, x: number, y: number) =>
  pixeles[(y * tamano + x) * 4 + 3] ?? 0;

describe("iconos de la marca", () => {
  it("cada variante tiene su favicon, sus PNG y su manifiesto", () => {
    for (const carpeta of [
      "iconos",
      "iconos/prototipo-a",
      "iconos/prototipo-b",
      "iconos/prototipo-c",
    ]) {
      for (const fichero of [
        "favicon.svg",
        "favicon-32.png",
        "apple-touch-icon.png",
        "icono-192.png",
        "icono-512.png",
        "manifest.webmanifest",
      ]) {
        assert.isTrue(ficheros.has(`${carpeta}/${fichero}`), `falta ${carpeta}/${fichero}`);
      }
    }
  });

  it("los colores salen de los tokens, en hexadecimal, sin oklch", () => {
    const svg = ficheros.get("iconos/prototipo-a/favicon.svg");
    assert.isString(svg);
    assert.notInclude(String(svg), "oklch");
    assert.match(String(svg), /fill="#[\da-f]{6}"/u);
    const manifiesto: unknown = JSON.parse(
      String(ficheros.get("iconos/prototipo-b/manifest.webmanifest")),
    );
    assert.deepInclude(manifiesto, { name: "Celda", lang: "es", start_url: "/" });
  });

  it("los PNG empiezan por la firma y dicen su tamaño", () => {
    const png = ficheros.get("iconos/apple-touch-icon.png");
    if (!(png instanceof Uint8Array)) throw new Error("el PNG no es binario");
    const bytes = png;
    assert.deepStrictEqual([...bytes.subarray(1, 4)], [0x50, 0x4e, 0x47]);
    const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.strictEqual(vista.getUint32(16), 180);
    assert.strictEqual(vista.getUint32(20), 180);
  });

  it("el icono de inicio va a sangre y el favicon deja ver la pestaña en las esquinas cortadas", () => {
    const colores = coloresDeIconos(tema);
    for (const variante of VARIANTES_MARCA) {
      const tapiz = pixelesDeIcono(variante, "tapiz", 64, colores);
      assert.strictEqual(alfa(tapiz, 64, 0, 0), 255, `${variante}: esquina del tapiz`);
      const favicon = pixelesDeIcono(variante, "favicon", 32, colores);
      assert.strictEqual(alfa(favicon, 32, 0, 0), 0, `${variante}: esquina del favicon`);
      // El centro de la figura siempre tiene algo pintado.
      assert.strictEqual(alfa(favicon, 32, 16, 20), 255, `${variante}: centro del favicon`);
    }
    assert.isFalse(MARCAS.B.baldosa);
  });
});
