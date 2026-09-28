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
  ["tinta-invertida-suave", "superficie-invertida"],
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
  // Las etiquetas de barrio, escritas sobre el mapa con un halo del color de su fondo.
  ["tinta", "mapa-halo"],
  ["primario-texto", "mapa-halo"],
  // Las etiquetas y los iconos de los controles claros.
  ["control-tinta", "control"],
  ["control-tinta", "control-hover"],
  ["prototipo-fg", "prototipo"],
];

/** Los fondos del mapa base sobre los que puede quedar un control. */
const FONDOS_DEL_MAPA = [
  "mapa-fondo",
  "mapa-parque",
  "mapa-agua",
  "mapa-edificio",
  "mapa-camino",
  "mapa-calle",
  "mapa-avenida",
] as const;

/**
 * Pares de piezas que no son texto y que tienen que distinguirse: 3:1, como pide WCAG 1.4.11
 * para los componentes de la interfaz. Los controles eran hexágonos oscuros como las
 * agrupaciones, los dos `superficie-invertida` (1:1): por eso ahora son claros.
 */
const PARES_NO_TEXTO: ReadonlyArray<readonly [pieza: string, fondo: string]> = [
  // El borde de un control claro frente a cualquier fondo del mapa.
  ...FONDOS_DEL_MAPA.map((fondo) => ["control-borde", fondo] as const),
  // El relleno de un control claro frente a una agrupación, que es oscura.
  ["control", "superficie-invertida"],
  // El favicon: lo recortado y el borde frente a la figura oscura.
  ["icono-figura", "icono-fondo"],
  ["icono-acento", "icono-fondo"],
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

describe("contraste de los controles frente al mapa y las agrupaciones", () => {
  for (const tema of ["claro", "oscuro"] as const) {
    it(`cumple WCAG AA para componentes (3:1) en el tema ${tema}`, () => {
      const tokens = tokensDelTema(tema);
      for (const [pieza, fondo] of PARES_NO_TEXTO) {
        const ratio = contraste(oklch(tokens.get(pieza) ?? ""), oklch(tokens.get(fondo) ?? ""));
        assert.isAtLeast(ratio, 3, `--${pieza} frente a --${fondo}: ${ratio.toFixed(2)}:1`);
      }
    });
  }
});
