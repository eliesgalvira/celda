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
  // Un aviso sin su fondo, como la fecha de los datos que fallan.
  ["aviso-tinta", "superficie"],
  ["aviso-tinta", "superficie-alta"],
  ["referencia-fg", "referencia"],
  ["primario-texto", "superficie"],
  ["primario-texto", "superficie-alta"],
  ["primario-texto", "fondo"],
  // El nombre de una zona, bajo su hexágono, con un halo del color del fondo del mapa.
  ["tinta-suave", "mapa-halo"],
  // Los rótulos del mapa base, con su halo.
  ["mapa-rotulo-capital", "mapa-halo"],
  ["mapa-rotulo-ciudad", "mapa-halo"],
  ["mapa-rotulo-pueblo", "mapa-halo"],
  ["mapa-rotulo-aldea", "mapa-halo"],
  ["mapa-rotulo-barrio", "mapa-halo"],
  ["mapa-rotulo-calle", "mapa-halo"],
  ["mapa-rotulo-agua", "mapa-halo"],
  ["mapa-pdi-transporte", "mapa-halo"],
  ["mapa-pdi-salud", "mapa-halo"],
  ["mapa-pdi-parque", "mapa-halo"],
  ["mapa-pdi-otro", "mapa-halo"],
  // El número de una autopista, con su amarillo de halo. Sobre la foto aérea va en tinta oscura.
  ["mapa-rotulo-carretera", "mapa-autopista"],
  ["mapa-foto-tinta", "mapa-foto-autopista"],
  // El número de portal del edificio resaltado, sobre su halo blanco.
  ["mapa-foto-tinta", "mapa-foto-rotulo"],
  // Los rótulos sobre la foto aérea, con su halo oscuro.
  ["mapa-foto-rotulo", "mapa-foto-halo"],
  // Las etiquetas y los iconos de los controles claros.
  ["control-tinta", "control"],
  ["control-tinta", "control-hover"],
  // La línea de debajo del aviso del filtro de compañías (ADR 0026).
  ["tinta-suave", "control"],
];

/** Los fondos del mapa base sobre los que puede quedar un control. */
const FONDOS_DEL_MAPA = [
  "mapa-fondo",
  "mapa-urbano",
  "mapa-bosque",
  "mapa-parque",
  "mapa-agua",
  "mapa-edificio",
  "mapa-camino",
  "mapa-calle",
  "mapa-autovia",
  "mapa-autopista",
] as const;

/**
 * Pares de piezas que no son texto y que tienen que distinguirse: 3:1, como pide WCAG 1.4.11
 * para los componentes de la interfaz. Los controles eran hexágonos oscuros como las
 * agrupaciones, los dos `superficie-invertida` (1:1): por eso ahora son claros.
 */
const PARES_NO_TEXTO: ReadonlyArray<readonly [pieza: string, fondo: string]> = [
  // El borde de un control claro frente a cualquier fondo del mapa.
  ...FONDOS_DEL_MAPA.map((fondo) => ["control-borde", fondo] as const),
  // El relleno de un control frente a una agrupación: claro y oscura en el tema claro, al revés en
  // el oscuro.
  ["control", "superficie-invertida"],
  // Los datos frente a cualquier fondo del mapa: el hexágono de las agrupaciones y las zonas, el
  // anillo del seleccionado, el edificio resaltado y el punto de referencia con su línea. En el
  // tema oscuro, las autopistas claras se comían esas líneas y la naranja.
  ...[
    "superficie-invertida",
    "primario",
    "mapa-resaltado",
    "referencia",
    "mapa-referencia",
  ].flatMap((pieza) => FONDOS_DEL_MAPA.map((fondo) => [pieza, fondo] as const)),
  // Los hexágonos del eje de frecuencias frente al panel: los dos extremos de la barra. Los de en
  // medio son mezclas en OKLab entre ellos.
  ["eje-lejos", "superficie"],
  ["primario", "superficie"],
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

describe("los dos temas", () => {
  it("el oscuro tiene cada color del claro salvo los de las compañías, que no cambian", () => {
    const claro = tokensDelTema("claro");
    const oscuro = tokensDelTema("oscuro");
    const colores = [...claro].filter(([, valor]) => leerOklch(valor) !== null);
    assert.isAbove(colores.length, 50);
    for (const [token] of colores) {
      if (token.startsWith("compania-")) continue;
      assert.isTrue(oscuro.has(token), `falta --${token} en el tema oscuro`);
    }
    for (const token of oscuro.keys()) {
      assert.isTrue(claro.has(token), `--${token} solo está en el tema oscuro`);
    }
  });
});

describe("contraste de los controles y los datos frente al mapa", () => {
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
