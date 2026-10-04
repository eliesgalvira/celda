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

/**
 * Lo que la interfaz dice de los logos: Celda los usa solo para decir de qué compañía es cada
 * estación base (ver `docs/patterns/ui.md`, «Marcadores y logos»).
 */
export const AVISO_DE_MARCAS =
  "Las marcas y los logotipos de las compañías pertenecen a sus titulares. Celda no está afiliada a ninguna de ellas.";

/**
 * La cita que piden las condiciones de DIGI para reproducir su logotipo sin ánimo de lucro: la
 * fuente, con un enlace a su web (ver «De dónde salen los logos», en la librería de componentes).
 */
export const CITA_DEL_LOGO_DE_DIGI = {
  texto: "Logotipo de DIGI:",
  sitio: "digimobil.es",
  enlace: "https://www.digimobil.es/",
} as const;
