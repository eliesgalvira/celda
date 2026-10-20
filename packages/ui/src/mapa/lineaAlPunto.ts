import type { LayerSpecification } from "maplibre-gl";

/**
 * La línea fina y discontinua que une el emplazamiento seleccionado con el punto de referencia.
 * Sale de las dos posiciones, así que dice de verdad hacia dónde queda el emplazamiento.
 */

/** La fuente GeoJSON de la línea, que la web llena con cada movimiento del punto. */
export const FUENTE_LINEA_AL_PUNTO = "linea-al-punto";

/** Desde el zoom de los logos, donde cada emplazamiento se ve suelto, en medio nivel de fundido. */
export const ZOOM_LINEA_AL_PUNTO = 15;

/** La capa de la línea, con el color del punto de referencia. */
export const capasLineaAlPunto = (colorReferencia: string): ReadonlyArray<LayerSpecification> => [
  {
    id: FUENTE_LINEA_AL_PUNTO,
    type: "line",
    source: FUENTE_LINEA_AL_PUNTO,
    minzoom: ZOOM_LINEA_AL_PUNTO,
    layout: { "line-cap": "round" },
    paint: {
      "line-color": colorReferencia,
      "line-width": 1.6,
      "line-dasharray": [2, 2.5],
      "line-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        ZOOM_LINEA_AL_PUNTO,
        0,
        ZOOM_LINEA_AL_PUNTO + 0.5,
        1,
      ],
    },
  },
];
