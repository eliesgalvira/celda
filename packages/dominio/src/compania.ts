import * as Schema from "effect/Schema";

/**
 * Compañía que emite desde un emplazamiento, por su marca comercial. Las fuentes usan razones
 * sociales o códigos de red; cada extractor las traduce a estos valores.
 */
export const Compania = Schema.Literals(["movistar", "vodafone", "orange", "digi", "yoigo"]);
export type Compania = typeof Compania.Type;
