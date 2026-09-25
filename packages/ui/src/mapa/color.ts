/**
 * MapLibre no entiende `oklch()`, así que los tokens del tema se pasan a sRGB
 * antes de llegar al estilo del mapa. Conversión de Björn Ottosson (OKLab).
 */

export interface Rgb {
  /** Canales sRGB entre 0 y 1. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alfa: number;
}

const OKLCH =
  /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/iu;

const numero = (texto: string | undefined, porcentaje: string | undefined): number => {
  const valor = Number(texto ?? "1");
  return porcentaje === "%" ? valor / 100 : valor;
};

const gamma = (lineal: number): number => {
  const recortado = Math.min(1, Math.max(0, lineal));
  return recortado <= 0.003_130_8 ? 12.92 * recortado : 1.055 * recortado ** (1 / 2.4) - 0.055;
};

/** Lee un color `oklch(L C H)` o `oklch(L C H / A)`; null si no tiene esa forma. */
export const leerOklch = (texto: string): Rgb | null => {
  const partes = OKLCH.exec(texto.trim());
  if (partes === null) return null;
  const claridad = numero(partes[1], partes[2]);
  const croma = Number(partes[3]);
  const tono = (Number(partes[4]) * Math.PI) / 180;
  const alfa = partes[5] === undefined ? 1 : numero(partes[5], partes[6]);

  const a = croma * Math.cos(tono);
  const b = croma * Math.sin(tono);
  const l = (claridad + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (claridad - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (claridad - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;

  return {
    r: gamma(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s),
    g: gamma(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s),
    b: gamma(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s),
    alfa,
  };
};

const canal = (valor: number): number => Math.round(valor * 255);

/** El color en la sintaxis `rgb()` que entiende MapLibre. */
export const comoRgb = (color: Rgb): string =>
  color.alfa === 1
    ? `rgb(${canal(color.r)} ${canal(color.g)} ${canal(color.b)})`
    : `rgb(${canal(color.r)} ${canal(color.g)} ${canal(color.b)} / ${color.alfa})`;

const lineal = (valor: number): number =>
  valor <= 0.040_45 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4;

/** Luminancia relativa de WCAG 2. */
export const luminancia = (color: Rgb): number =>
  0.2126 * lineal(color.r) + 0.7152 * lineal(color.g) + 0.0722 * lineal(color.b);

/** Contraste de WCAG 2 entre dos colores opacos, de 1 a 21. */
export const contraste = (uno: Rgb, otro: Rgb): number => {
  const [clara, oscura] = [luminancia(uno), luminancia(otro)].toSorted((x, y) => y - x);
  return ((clara ?? 0) + 0.05) / ((oscura ?? 0) + 0.05);
};
