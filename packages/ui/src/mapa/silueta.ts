import type {
  GeoJSONSourceSpecification,
  LayerSpecification,
  SourceSpecification,
} from "maplibre-gl";

import { porZoom } from "./expresiones.ts";
import type { ContornoDeEspana } from "./rotulos.ts";
import type { ColorDeToken } from "./tokens.ts";

/**
 * La silueta de España que tapa el mapa base mientras carga. Va en el estilo desde el primer
 * fotograma, con el contorno del IGN que ya lleva el código del mapa (`espana.json`), así que los
 * hexágonos nunca salen sobre un fondo sin geografía. Encima de ella se ven ya los límites de
 * comunidades y provincias. Cuando llega el callejero, la web la funde (`levantarSilueta`) y el
 * mapa base aparece debajo. Sirve igual con el mapa base de reserva del IGN.
 */

/** La fuente de la silueta: el contorno de España. */
export const FUENTE_SILUETA = "silueta";

/** La fuente de lo que queda fuera: un rectángulo que cubre el mundo. */
export const FUENTE_SILUETA_FUERA = "silueta-fuera";

/** Las capas de la silueta, de abajo arriba. */
export const CAPAS_SILUETA = ["silueta-fuera", "silueta-espana", "silueta-costa"] as const;

/** Lo que tarda en fundirse cuando llega el callejero. */
export const FUNDIDO_SILUETA_MS = 400;

/** Un rectángulo que cubre el mundo hasta donde llega Mercator. */
const MUNDO: GeoJSONSourceSpecification["data"] = {
  type: "Polygon",
  coordinates: [
    [
      [-180, -85],
      [180, -85],
      [180, 85],
      [-180, 85],
      [-180, -85],
    ],
  ],
};

/** Las dos fuentes de la silueta, con sus datos dentro: no piden nada a la red. */
export const fuentesSilueta = (espana: ContornoDeEspana) =>
  ({
    [FUENTE_SILUETA_FUERA]: { type: "geojson", data: MUNDO },
    [FUENTE_SILUETA]: { type: "geojson", data: espana },
  }) satisfies Record<string, SourceSpecification>;

const fundido = { duration: FUNDIDO_SILUETA_MS, delay: 0 };

/**
 * Las capas de la silueta: lo de fuera, la tierra de España con el color del suelo y su costa con
 * el color de la frontera. Van entre el suelo y los límites, así que tapan el suelo del callejero
 * hasta que se funden, y las comunidades, las provincias, las vías y los rótulos quedan encima.
 */
export const capasSilueta = (color: ColorDeToken): ReadonlyArray<LayerSpecification> => [
  {
    id: "silueta-fuera",
    type: "fill",
    source: FUENTE_SILUETA_FUERA,
    paint: {
      "fill-color": color("mapa-silueta-fuera"),
      "fill-opacity": 1,
      "fill-opacity-transition": fundido,
    },
  },
  {
    id: "silueta-espana",
    type: "fill",
    source: FUENTE_SILUETA,
    paint: {
      "fill-color": color("mapa-fondo"),
      "fill-opacity": 1,
      "fill-opacity-transition": fundido,
    },
  },
  {
    id: "silueta-costa",
    type: "line",
    source: FUENTE_SILUETA,
    layout: { "line-join": "round" },
    paint: {
      "line-color": color("mapa-limite-pais"),
      "line-width": porZoom(4, 1, 8, 1.8, 14, 2.6),
      "line-opacity": 1,
      "line-opacity-transition": fundido,
    },
  },
];

/** Lo que hace falta del mapa de MapLibre para fundir la silueta. */
export interface MapaConSilueta {
  setPaintProperty(capa: string, propiedad: "fill-opacity" | "line-opacity", valor: number): void;
  setLayoutProperty(capa: string, propiedad: "visibility", valor: "none"): void;
  once(evento: "idle", escuchador: () => void): void;
}

/**
 * Funde la silueta y, cuando el mapa queda quieto, la apaga: así no se sigue pintando a
 * transparencia cero. Con `sinFundido` (la preferencia de reducir movimiento) la apaga ya.
 */
export const levantarSilueta = (mapa: MapaConSilueta, sinFundido: boolean): void => {
  const apagar = () => {
    for (const capa of CAPAS_SILUETA) mapa.setLayoutProperty(capa, "visibility", "none");
  };
  if (sinFundido) {
    apagar();
    return;
  }
  mapa.setPaintProperty("silueta-fuera", "fill-opacity", 0);
  mapa.setPaintProperty("silueta-espana", "fill-opacity", 0);
  mapa.setPaintProperty("silueta-costa", "line-opacity", 0);
  mapa.once("idle", apagar);
};
