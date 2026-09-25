import type { Credito } from "@celda/ui/Atribucion.tsx";

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

/** Si el navegador puede dibujar con WebGL, que MapLibre necesita. */
export const hayWebgl = (): boolean => {
  const lienzo = document.createElement("canvas");
  return lienzo.getContext("webgl2") !== null || lienzo.getContext("webgl") !== null;
};
