import { AVISO_DE_MARCAS, CITA_DEL_LOGO_DE_DIGI } from "@celda/dominio/compania";
import type { Credito } from "@celda/ui/Atribucion.tsx";

import { SALVEDAD_DE_LAS_CELDAS } from "../celdas/celdas.ts";

/** Por qué no se puede enseñar el mapa base. */
export type MotivoFallo = "sin-webgl" | "sin-respuesta" | "interno";

export type EstadoMapa =
  | { readonly tipo: "cargando" }
  | { readonly tipo: "listo" }
  | { readonly tipo: "fallo"; readonly motivo: MotivoFallo };

/** Los créditos que exige el mapa base de OpenFreeMap. */
export const CREDITOS_MAPA_BASE: ReadonlyArray<Credito> = [
  { texto: "OpenFreeMap", enlace: "https://openfreemap.org" },
  { texto: "OpenMapTiles", enlace: "https://www.openmaptiles.org/" },
  { texto: "OpenStreetMap", enlace: "https://www.openstreetmap.org/copyright" },
];

/**
 * El crédito del mapa base de reserva del IGN, mientras está puesto (ADR 0021). Es la fórmula de
 * la etiqueta `AccessConstraints` del servicio. Va plegado tras la «i» como los demás, por
 * decisión del usuario (05/10/2026).
 */
export const CREDITOS_RESERVA: ReadonlyArray<Credito> = [
  {
    texto: "Sistema Cartográfico Nacional · CC BY 4.0 scne.es",
    corto: "CC BY 4.0 scne.es",
    enlace: "https://www.scne.es/",
    detalle: "Mapa base del IGN, que Celda usa cuando no carga el de OpenFreeMap",
  },
];

/** Que las marcas de los logos son de sus compañías, mientras el mapa enseña alguno. */
export const CREDITO_DE_MARCAS: Credito = {
  texto: AVISO_DE_MARCAS,
  corto: "Las marcas son de sus titulares y Celda no está afiliada",
  aviso: true,
};

/**
 * La salvedad de las celdas, entre los créditos mientras se ven: en la pista sale una sola vez
 * por dispositivo, y aquí se puede volver a leer.
 */
export const CREDITO_DE_LAS_CELDAS: Credito = {
  texto: SALVEDAD_DE_LAS_CELDAS,
  corto: "Las celdas solo aproximan la cobertura",
  aviso: true,
};

/** La cita del logotipo de DIGI que piden sus condiciones, mientras el mapa puede enseñarlo. */
export const CREDITO_DEL_LOGO_DE_DIGI: Credito = {
  texto: `${CITA_DEL_LOGO_DE_DIGI.texto} ${CITA_DEL_LOGO_DE_DIGI.sitio}`,
  enlace: CITA_DEL_LOGO_DE_DIGI.enlace,
  aviso: true,
};

/** Si el navegador puede dibujar con WebGL, que MapLibre necesita. */
export const hayWebgl = (): boolean => {
  const lienzo = document.createElement("canvas");
  return lienzo.getContext("webgl2") !== null || lienzo.getContext("webgl") !== null;
};
