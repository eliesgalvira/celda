import type {
  GeoJSONSourceSpecification,
  LayerSpecification,
  RasterSourceSpecification,
} from "maplibre-gl";

import { FOTO_AEREA } from "./expresiones.ts";
import type { ColorDeToken } from "./tokens.ts";

/**
 * La foto aérea (ADR 0022): la ortofoto PNOA del IGN bajo las vías y los rótulos, como el modo
 * híbrido de Google, y el edificio que resalta «Ver el edificio». Se enciende con el estado del
 * estilo `FOTO_AEREA`; cada capa del mapa base dice con `conFoto` cómo se ve sobre ella.
 */

/** La fuente de la ortofoto PNOA. */
export const FUENTE_FOTO = "foto-aerea";

/** La capa de la ortofoto, sobre la tierra y bajo el agua. */
export const CAPA_FOTO = "foto-aerea";

/**
 * Desde este zoom del mapa se ve la foto; más lejos, el mapa sigue como con ella apagada aunque
 * esté encendida. Hasta la tesela z13, el IGN sirve un mosaico Sentinel-2 de 10 m, que no deja
 * reconocer un edificio y en invierno trae el Pirineo nevado; la ortofoto empieza en la z14. Con
 * teselas de 256, MapLibre pide la z14 desde el zoom 12,5 del mapa.
 */
export const ZOOM_FOTO = 12.5;

/**
 * La ortofoto PNOA de máxima actualidad por su TMS, que sirve Amazon CloudFront y no Cloudflare
 * (ADR 0018). En los cascos urbanos es ortofoto verdadera de 25 cm. Las filas van de sur a norte
 * (`tms`). Fuera de España, con Canarias, no se pide nada: fuera el PNOA solo tiene imagen de baja
 * resolución. No se piden las teselas del mosaico Sentinel-2 (`ZOOM_FOTO`).
 */
export const fuenteFoto = (): RasterSourceSpecification => ({
  type: "raster",
  tiles: ["https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{y}.jpeg"],
  scheme: "tms",
  tileSize: 256,
  minzoom: 14,
  maxzoom: 19,
  bounds: [-18.4, 27.5, 4.5, 44],
});

/**
 * La capa de la ortofoto, en color natural. Escondida, MapLibre no pide ninguna tesela de la foto:
 * con ella apagada, una visita no hace ninguna petición al PNOA.
 *
 * Su visibilidad no lee el estado del estilo: la pone `ponerFotoAerea`. MapLibre toma una
 * visibilidad que lee el estado por maquetación y, con cada cambio del estado, recarga la fuente
 * de la capa y vacía su caché de teselas. Con la foto fuera de los vuelos (#67), volver a una
 * vista ya vista pedía otra vez su foto entera. Una capa de imagen escondida con
 * `setLayoutProperty` no recarga su fuente.
 */
export const capaFoto = (): LayerSpecification => ({
  id: CAPA_FOTO,
  type: "raster",
  source: FUENTE_FOTO,
  layout: { visibility: "none" },
  // Pasa de transparente a opaca de golpe, a la vez que las vías y los rótulos (`prepararFotoAerea`).
  paint: { "raster-opacity": 1, "raster-opacity-transition": { duration: 0, delay: 0 } },
});

/** Lo que dice de la foto el estado del estilo. */
export interface EstadoConFoto {
  [FOTO_AEREA]?: boolean;
}

/** Lo que hace falta del mapa de MapLibre para encender o apagar la foto. */
export interface MapaConFoto {
  readonly getGlobalState: () => Readonly<EstadoConFoto>;
  readonly setGlobalStateProperty: (nombre: string, valor: boolean) => void;
  readonly setLayoutProperty: (
    capa: string,
    propiedad: "visibility",
    valor: "visible" | "none",
  ) => void;
  readonly setPaintProperty: (capa: string, propiedad: "raster-opacity", valor: number) => void;
}

/**
 * Enciende o apaga la foto aérea: el estado del estilo, que leen las capas que cambian sobre la
 * foto, y la visibilidad de la capa de la foto. Ni `setStyle` ni capas nuevas, así que las capas
 * de Celda, las celdas y la ficha abierta se quedan como estaban. Si ya estaba así no toca el
 * mapa, que con cualquier cambio de estado se vuelve a pintar.
 */
export const ponerFotoAerea = (mapa: MapaConFoto, encendida: boolean): void => {
  if ((mapa.getGlobalState()[FOTO_AEREA] ?? false) === encendida) return;
  mapa.setGlobalStateProperty(FOTO_AEREA, encendida);
  mapa.setLayoutProperty(CAPA_FOTO, "visibility", encendida ? "visible" : "none");
  if (encendida) mapa.setPaintProperty(CAPA_FOTO, "raster-opacity", 1);
};

/**
 * Pide la foto de la vista sin enseñarla: su capa visible pero transparente, y el estado del estilo
 * sin tocar, así que el mapa se sigue viendo como sin foto. Cuando han llegado sus teselas,
 * `ponerFotoAerea` la enseña de una vez, sin los huecos de las teselas que faltan.
 */
export const prepararFotoAerea = (mapa: MapaConFoto): void => {
  if (mapa.getGlobalState()[FOTO_AEREA] === true) return;
  mapa.setPaintProperty(CAPA_FOTO, "raster-opacity", 0);
  mapa.setLayoutProperty(CAPA_FOTO, "visibility", "visible");
};

/** Deja de pedir la foto preparada que no se ha llegado a enseñar. */
export const dejarDePrepararFoto = (mapa: MapaConFoto): void => {
  if (mapa.getGlobalState()[FOTO_AEREA] === true) return;
  mapa.setLayoutProperty(CAPA_FOTO, "visibility", "none");
};

/**
 * La fuente del edificio resaltado: su polígono y, si lo tiene, el punto de su número de portal
 * con `numero`.
 */
export const FUENTE_EDIFICIO = "edificio";

export const fuenteEdificio = (): GeoJSONSourceSpecification => ({
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
});

/**
 * El edificio resaltado: un relleno tenue y un contorno del color de las celdas sobre un casco
 * claro. Van encima de las celdas y bajo los rótulos; el número va aparte (`capaNumeroDelEdificio`).
 */
export const capasEdificio = (color: ColorDeToken): ReadonlyArray<LayerSpecification> => [
  {
    id: "edificio-relleno",
    type: "fill",
    source: FUENTE_EDIFICIO,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": color("mapa-celda"), "fill-opacity": 0.16 },
  },
  {
    id: "edificio-casco",
    type: "line",
    source: FUENTE_EDIFICIO,
    filter: ["==", ["geometry-type"], "Polygon"],
    layout: { "line-join": "round" },
    paint: { "line-color": color("mapa-foto-linea"), "line-width": 5, "line-opacity": 0.85 },
  },
  {
    id: "edificio-contorno",
    type: "line",
    source: FUENTE_EDIFICIO,
    filter: ["==", ["geometry-type"], "Polygon"],
    layout: { "line-join": "round" },
    paint: { "line-color": color("mapa-celda"), "line-width": 2.2 },
  },
];

/**
 * El número de portal del edificio resaltado, en negrita, en tinta sobre blanco. Va justo encima de
 * la capa de portales: MapLibre lo coloca antes y el mismo número de esa capa, que no se puede
 * pisar con otro, deja de pintarse debajo. No se aparta por nada.
 */
export const capaNumeroDelEdificio = (color: ColorDeToken): LayerSpecification => ({
  id: "edificio-numero",
  type: "symbol",
  source: FUENTE_EDIFICIO,
  filter: ["==", ["geometry-type"], "Point"],
  layout: {
    "text-field": ["get", "numero"],
    "text-font": ["Noto Sans Bold"],
    "text-size": 15,
    "text-allow-overlap": true,
  },
  paint: {
    "text-color": color("mapa-foto-tinta"),
    "text-halo-color": color("mapa-foto-rotulo"),
    "text-halo-width": 2.4,
  },
});
