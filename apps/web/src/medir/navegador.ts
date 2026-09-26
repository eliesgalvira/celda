import type { DatosDelNavegador } from "./dispositivo.ts";

/**
 * Las pistas de cliente de Chromium (`navigator.userAgentData`). No están en los tipos del DOM
 * porque Firefox y Safari no las tienen.
 */
interface PistasDelNavegador {
  readonly platform: string;
  readonly getHighEntropyValues: (
    pistas: ReadonlyArray<"model">,
  ) => Promise<{ readonly model?: string }>;
}

const pistas = (): PistasDelNavegador | undefined =>
  // SAFETY: solo Chromium define `userAgentData`, con esta forma; en el resto no existe.
  (navigator as Navigator & { readonly userAgentData?: PistasDelNavegador }).userAgentData;

/** Lo que el navegador dice de sí mismo al momento, sin el modelo. */
export const leerNavegador = (): DatosDelNavegador => ({
  userAgent: navigator.userAgent,
  puntosTactiles: navigator.maxTouchPoints,
  plataforma: pistas()?.platform,
});

/**
 * El modelo del móvil, que Chromium solo da si se le pide y un momento después. Fuera de
 * Chromium, o si no lo da, es `undefined`.
 */
export const leerModelo = async (): Promise<string | undefined> => {
  const disponibles = pistas();
  if (disponibles === undefined) return undefined;
  try {
    const { model } = await disponibles.getHighEntropyValues(["model"]);
    return model === "" ? undefined : model;
  } catch {
    // El navegador puede negarse a darlo; entonces la marca se elige a mano.
    return undefined;
  }
};
