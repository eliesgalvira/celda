import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

import { ocultarCeldasSalvoContorno } from "./celdas.ts";

/**
 * Cómo se dibuja la vista de interferencia, como en el prototipo v8: una trama de hexágonos
 * coloreados por la señal frente a interferencia, del verde azulado de la señal limpia al naranja
 * oscuro donde domina la interferencia. Mientras se ve, las celdas no se dibujan y la del
 * emplazamiento seleccionado queda como un contorno discontinuo, para no cruzar capas.
 */

/**
 * La fuente GeoJSON de la trama. Cada hexágono lleva `sinr`, la señal frente a interferencia de
 * su centro en dB.
 */
export const FUENTE_INTERFERENCIA = "interferencia";

const CAPA_INTERFERENCIA = "interferencia";

/**
 * Los cortes de la escala en dB. Por debajo del primero manda la interferencia; por encima del
 * último la señal es limpia. Son seis tramos, uno por color (`--mapa-sinr-1` a `--mapa-sinr-6`).
 */
export const CORTES_SINR = [0, 5, 10, 15, 20] as const;

/** Los seis colores de la escala, del peor tramo al mejor. */
export type ColoresSinr = readonly [string, string, string, string, string, string];

/** Opacidad de la trama: deja leer las calles de debajo. */
const OPACIDAD = 0.62;

const colorPorTramo = (colores: ColoresSinr): ExpressionSpecification => [
  "step",
  ["get", "sinr"],
  colores[0],
  CORTES_SINR[0],
  colores[1],
  CORTES_SINR[1],
  colores[2],
  CORTES_SINR[2],
  colores[3],
  CORTES_SINR[3],
  colores[4],
  CORTES_SINR[4],
  colores[5],
];

/** La capa de la trama, escondida hasta que se activa la vista. Va debajo de las celdas. */
export const capasInterferencia = (colores: ColoresSinr): ReadonlyArray<LayerSpecification> => [
  {
    id: CAPA_INTERFERENCIA,
    type: "fill",
    source: FUENTE_INTERFERENCIA,
    layout: { visibility: "none" },
    paint: { "fill-color": colorPorTramo(colores), "fill-opacity": OPACIDAD },
  },
];

/** Lo que hace falta del mapa de MapLibre para enseñar u ocultar la vista. */
export interface MapaConInterferencia {
  readonly setLayoutProperty: (
    capa: string,
    propiedad: "visibility",
    valor: "visible" | "none",
  ) => void;
}

/**
 * Enseña u oculta la trama. Con ella a la vista, las celdas se ocultan y la del emplazamiento
 * seleccionado queda como contorno discontinuo.
 */
export const mostrarInterferencia = (mapa: MapaConInterferencia, activa: boolean): void => {
  mapa.setLayoutProperty(CAPA_INTERFERENCIA, "visibility", activa ? "visible" : "none");
  ocultarCeldasSalvoContorno(mapa, activa);
};
