import type { Credito } from "@celda/ui/Atribucion.tsx";

/**
 * La foto aérea como función aparte (ADR 0022): apagada al abrir, la enciende la persona con su
 * control, con la pista «Ver foto» o con «Ver el edificio» en la ficha.
 */

/** Desde este zoom, a pie de calle, la pista ofrece la foto para reconocer el edificio. */
export const ZOOM_VER_FOTO = 16;

/** El zoom al que vuela «Ver el edificio»: el máximo del mapa, con la foto de 25 cm entera. */
export const ZOOM_EDIFICIO = 18.5;

/**
 * El crédito de la ortofoto PNOA, a pie de mapa solo mientras la foto está encendida. Es la
 * fórmula de la etiqueta `AccessConstraints` del servicio (ADR 0021).
 */
export const CREDITO_FOTO_AEREA: Credito = {
  texto: "PNOA · CC BY 4.0 scne.es",
  enlace: "https://pnoa.ign.es/",
  detalle: "Foto aérea: ortofoto PNOA del Instituto Geográfico Nacional",
};

/** Si el mapa está a pie de calle, donde la pista ofrece la foto. */
export const aPieDeCalle = (zoom: number): boolean => zoom >= ZOOM_VER_FOTO;

/** Lo que mira la pista «Ver foto». */
export interface SituacionDeLaFoto {
  readonly encendida: boolean;
  /** Si hay un emplazamiento seleccionado. */
  readonly seleccionado: boolean;
  /** Si el mapa está a pie de calle (`aPieDeCalle`). */
  readonly aPieDeCalle: boolean;
  /** Si está abierta la vista de interferencia, que tiene prioridad. */
  readonly vistaActiva: boolean;
}

/**
 * Si la pista pregunta cuál es el edificio y ofrece la foto: con un emplazamiento seleccionado, a
 * pie de calle y con la foto apagada. Con la vista de interferencia no, como las demás pistas.
 */
export const pideVerFoto = (situacion: SituacionDeLaFoto): boolean =>
  !situacion.vistaActiva && !situacion.encendida && situacion.seleccionado && situacion.aPieDeCalle;
