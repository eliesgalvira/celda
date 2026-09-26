import { assert, describe, it } from "@effect/vitest";

import { tokensDelTema } from "../pruebas/tema.ts";
import { comoRgb, contraste, leerOklch, type Rgb } from "./color.ts";

const oklch = (texto: string): Rgb => {
  const color = leerOklch(texto);
  assert.isNotNull(color, `no es OKLCH: ${texto}`);
  // SAFETY: la aserción anterior descarta null.
  return color as Rgb;
};

describe("leerOklch", () => {
  it("convierte a sRGB los extremos y un color conocido", () => {
    assert.strictEqual(comoRgb(oklch("oklch(100% 0 0)")), "rgb(255 255 255)");
    assert.strictEqual(comoRgb(oklch("oklch(0 0 0)")), "rgb(0 0 0)");
    assert.strictEqual(comoRgb(oklch("oklch(62.8% 0.2577 29.23)")), "rgb(255 0 0)");
    assert.strictEqual(comoRgb(oklch("oklch(55.1% 0.077 203.3)")), "rgb(47 127 134)");
    assert.strictEqual(comoRgb(oklch("oklch(29.9% 0.005 121.8 / 0.14)")), "rgb(45 46 43 / 0.14)");
  });

  it("no acepta otras sintaxis de color", () => {
    assert.isNull(leerOklch("#2f7f86"));
    assert.isNull(leerOklch("rgb(0 0 0)"));
  });
});

/** Pares de texto y fondo que la librería usa juntos. */
const PARES: ReadonlyArray<readonly [texto: string, fondo: string]> = [
  ["tinta", "fondo"],
  ["tinta", "superficie"],
  ["tinta", "superficie-alta"],
  ["tinta-suave", "superficie"],
  ["tinta-suave", "superficie-alta"],
  ["tinta-invertida", "superficie-invertida"],
  ["primario-fg", "primario"],
  ["primario-fg", "primario-hover"],
  ["primario-fg", "primario-activo"],
  ["verificado-fg", "verificado"],
  ["corregido-fg", "corregido"],
  ["nuevo-fg", "nuevo"],
  ["ejemplo-fg", "ejemplo"],
  ["qr-tinta", "qr-fondo"],
  ["aviso-tinta", "aviso-fondo"],
  ["referencia-fg", "referencia"],
  ["primario-texto", "superficie"],
  ["primario-texto", "superficie-alta"],
  ["primario-texto", "fondo"],
];

describe("contraste del tema", () => {
  for (const tema of ["claro", "oscuro"] as const) {
    it(`cumple WCAG AA (4,5:1) en el tema ${tema}`, () => {
      const tokens = tokensDelTema(tema);
      for (const [texto, fondo] of PARES) {
        const ratio = contraste(oklch(tokens.get(texto) ?? ""), oklch(tokens.get(fondo) ?? ""));
        assert.isAtLeast(ratio, 4.5, `--${texto} sobre --${fondo}: ${ratio.toFixed(2)}:1`);
      }
    });
  }
});
