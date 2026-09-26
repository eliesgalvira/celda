import * as Schema from "effect/Schema";

/**
 * Compañía que emite desde un emplazamiento, por su marca comercial. Las fuentes usan razones
 * sociales o códigos de red; cada extractor las traduce a estos valores.
 */
export const Compania = Schema.Literals(["movistar", "vodafone", "orange", "digi", "yoigo"]);
export type Compania = typeof Compania.Type;

/** Cómo se escribe cada compañía en los textos. */
export const NOMBRE_COMPANIA: Readonly<Record<Compania, string>> = {
  movistar: "Movistar",
  vodafone: "Vodafone",
  orange: "Orange",
  digi: "Digi",
  yoigo: "Yoigo",
};
