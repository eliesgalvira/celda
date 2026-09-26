/**
 * Las decisiones de la hoja inferior del móvil, sin DOM: qué altura toca tras un toque, un
 * arrastre o una tecla, y cuántos píxeles mide cada una.
 */

/** Las tres alturas de la hoja, de la más baja a la más alta. */
export const ALTURAS_HOJA = ["resumen", "media", "completa"] as const;
export type AlturaHoja = (typeof ALTURAS_HOJA)[number];

/** Alto del resumen: el tirador, la cabecera de la ficha y los logos. */
export const ALTO_RESUMEN = 188;
/** Lo que deja libre arriba la hoja completa: la cabecera del mapa sigue a la vista. */
const HUECO_ARRIBA = 64;
/** Fracción de la ventana que ocupa la altura media: el mapa y la ficha a la vez. */
const FRACCION_MEDIA = 0.56;
/** Límites mientras se arrastra: ni se esconde del todo ni tapa la barra del navegador. */
const ALTO_MINIMO_ARRASTRE = 120;
const HUECO_MINIMO_ARRASTRE = 40;
/** Por encima de esta velocidad (px/ms) soltar es lanzar: sigue hacia donde iba. */
const VELOCIDAD_DE_LANZAMIENTO = 0.4;

/** Píxeles que mide la hoja en `altura` con una ventana de `altoVentana` px de alto. */
export const pixelesDeAltura = (altura: AlturaHoja, altoVentana: number): number => {
  const resumen = Math.min(ALTO_RESUMEN, Math.round(altoVentana * 0.4));
  const media = Math.max(resumen + 40, Math.round(altoVentana * FRACCION_MEDIA));
  const completa = Math.min(altoVentana, Math.max(media, altoVentana - HUECO_ARRIBA));
  switch (altura) {
    case "resumen":
      return resumen;
    case "media":
      return Math.min(media, completa);
    case "completa":
      return completa;
  }
};

const indice = (altura: AlturaHoja): number => ALTURAS_HOJA.indexOf(altura);
const enIndice = (i: number): AlturaHoja =>
  ALTURAS_HOJA[Math.max(0, Math.min(ALTURAS_HOJA.length - 1, i))] ?? "resumen";

/** Un toque en el tirador sube una altura; desde la completa vuelve al resumen. */
export const alturaTrasToque = (actual: AlturaHoja): AlturaHoja =>
  actual === "completa" ? "resumen" : enIndice(indice(actual) + 1);

/** Alto de la hoja mientras el dedo la arrastra `desplazamiento` px hacia arriba. */
export const altoDuranteArrastre = (
  inicio: number,
  desplazamiento: number,
  altoVentana: number,
): number =>
  Math.max(
    ALTO_MINIMO_ARRASTRE,
    Math.min(altoVentana - HUECO_MINIMO_ARRASTRE, inicio + desplazamiento),
  );

export interface Arrastre {
  /** Alto de la hoja al soltar, en píxeles. */
  readonly pixeles: number;
  /** Velocidad al soltar en px/ms, positiva hacia arriba. */
  readonly velocidad: number;
  readonly altoVentana: number;
}

/**
 * La altura en la que se queda la hoja al soltarla. Despacio, la más cercana. Lanzada, la
 * siguiente en la dirección en que iba, aunque otra esté más cerca.
 */
export const alturaTrasArrastre = (arrastre: Arrastre): AlturaHoja => {
  const { pixeles, velocidad, altoVentana } = arrastre;
  const alturas = ALTURAS_HOJA.map((altura) => ({
    altura,
    pixeles: pixelesDeAltura(altura, altoVentana),
  }));
  if (velocidad >= VELOCIDAD_DE_LANZAMIENTO) {
    return alturas.find((a) => a.pixeles > pixeles)?.altura ?? "completa";
  }
  if (velocidad <= -VELOCIDAD_DE_LANZAMIENTO) {
    return alturas.findLast((a) => a.pixeles < pixeles)?.altura ?? "resumen";
  }
  const cercana = alturas.reduce((mejor, a) =>
    Math.abs(a.pixeles - pixeles) < Math.abs(mejor.pixeles - pixeles) ? a : mejor,
  );
  return cercana.altura;
};

/**
 * La altura tras pulsar una tecla en el tirador: las flechas suben y bajan una, Inicio y Fin van
 * a los extremos. Cualquier otra tecla no hace nada.
 */
export const alturaConTecla = (actual: AlturaHoja, tecla: string): AlturaHoja | undefined => {
  switch (tecla) {
    case "ArrowUp":
      return enIndice(indice(actual) + 1);
    case "ArrowDown":
      return enIndice(indice(actual) - 1);
    case "Home":
      return "resumen";
    case "End":
      return "completa";
    default:
      return undefined;
  }
};
