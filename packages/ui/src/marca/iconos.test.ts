import { assert, describe, it } from "@effect/vitest";

import tema from "../tema.css?raw";
import {
  coloresDeLaBarra,
  DESCRIPCION,
  ficherosDeIconos,
  etiquetasAlCompartir,
  pixelesDeIcono,
  coloresDeIconos,
} from "./iconos.ts";

const ficheros = ficherosDeIconos(tema);

/** El alfa del píxel (x, y) de un icono RGBA. */
const alfa = (pixeles: Uint8Array, tamano: number, x: number, y: number) =>
  pixeles[(y * tamano + x) * 4 + 3] ?? 0;

describe("iconos de la marca", () => {
  it("hay favicon, PNG y manifiesto, y nada más", () => {
    assert.deepStrictEqual([...ficheros.keys()].toSorted(), [
      "iconos/apple-touch-icon.png",
      "iconos/favicon-32.png",
      "iconos/favicon.svg",
      "iconos/icono-192.png",
      "iconos/icono-512.png",
      "iconos/manifest.webmanifest",
    ]);
  });

  it("los colores salen de los tokens, en hexadecimal, sin oklch", () => {
    const svg = ficheros.get("iconos/favicon.svg");
    assert.isString(svg);
    assert.notInclude(String(svg), "oklch");
    assert.match(String(svg), /fill="#[\da-f]{6}"/u);
    const manifiesto: unknown = JSON.parse(String(ficheros.get("iconos/manifest.webmanifest")));
    assert.deepInclude(manifiesto, {
      name: "Celda",
      lang: "es",
      start_url: "/",
      description: DESCRIPCION,
    });
    assert.isAtMost(DESCRIPCION.length, 160);
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

  it("el icono de inicio va a sangre y el favicon deja ver la pestaña fuera del hexágono", () => {
    const colores = coloresDeIconos(tema);
    const tapiz = pixelesDeIcono("tapiz", 64, colores);
    assert.strictEqual(alfa(tapiz, 64, 0, 0), 255, "esquina del tapiz");
    const favicon = pixelesDeIcono("favicon", 32, colores);
    assert.strictEqual(alfa(favicon, 32, 0, 0), 0, "esquina del favicon");
    assert.strictEqual(alfa(favicon, 32, 16, 10), 255, "figura del favicon");
  });

  it("la barra del navegador lleva la superficie de cada tema", () => {
    const barra = coloresDeLaBarra(tema);
    assert.match(barra.claro, /^#[\da-f]{6}$/u);
    assert.match(barra.oscuro, /^#[\da-f]{6}$/u);
    assert.notStrictEqual(barra.claro, barra.oscuro);
  });

  it("el HTML enlaza la imagen para compartir con su URL entera y pide la tarjeta grande", () => {
    const etiquetas = etiquetasAlCompartir();
    const valor = (clave: string) =>
      etiquetas.find((e) => Object.values(e.attrs).includes(clave))?.attrs.content;
    assert.strictEqual(valor("og:image"), "https://celda.elies.site/iconos/compartir.png");
    assert.strictEqual(valor("og:image:width"), "1200");
    assert.strictEqual(valor("og:image:height"), "630");
    assert.strictEqual(valor("og:description"), DESCRIPCION);
    assert.strictEqual(valor("twitter:card"), "summary_large_image");
  });
});
