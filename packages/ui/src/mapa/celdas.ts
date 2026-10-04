import type {
  DataDrivenPropertyValueSpecification,
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
} from "maplibre-gl";

import { conFoto } from "./expresiones.ts";

/**
 * Cómo se dibujan las celdas en el mapa, como en el prototipo v8: un trazo fino del color primario
 * para todas y, al seleccionar un emplazamiento, su celda remarcada y las demás casi invisibles,
 * para que no se amontonen líneas alrededor de la que importa. El relleno de la seleccionada es el
 * degradado de `servicio.ts`.
 *
 * Sobre la foto aérea un trazo de 1 px del color primario se pierde: las líneas suben de opacidad
 * y llevan debajo un casco claro, de 3 px las de todas y de 5 px el de la seleccionada.
 *
 * Con un filtro de compañías, las celdas de la red usada (`redUsada` en sus propiedades) van a la
 * mitad de opacidad, como sus emplazamientos van más claros (ADR 0026). La seleccionada, no.
 */

/** La fuente GeoJSON de las celdas. Cada polígono lleva la `clave` de su emplazamiento. */
export const FUENTE_CELDAS = "celdas";

/**
 * A partir de este zoom se dibujan las celdas. En Barcelona la mitad de las celdas miden más de
 * 250 m de lado a lado y solo una de cada diez baja de 140 m. A zoom 15 esa décima parte ocupa
 * unos 80 px, casi el doble que un marcador, y las líneas no se amontonan; a 14 bajaba a 40 px.
 */
export const ZOOM_CELDAS = 15;

/** Medio nivel de zoom en que las líneas pasan de no verse a verse del todo, sin saltos. */
const FUNDIDO = 0.5;

const CAPA_BORDES = "celdas";
const CAPA_SELECCIONADA = "celda-seleccionada";
/** El contorno discontinuo de la seleccionada, que la sustituye con la vista de interferencia. */
const CAPA_SELECCIONADA_CONTORNO = "celda-seleccionada-contorno";
/** Los cascos claros, que solo se ven sobre la foto aérea. */
const CAPA_CASCO = "celdas-casco";
const CAPA_SELECCIONADA_CASCO = "celda-seleccionada-casco";

/** Si la celda es de un emplazamiento de la red usada. */
const DE_LA_RED_USADA: ExpressionSpecification = ["==", ["get", "redUsada"], true];

/** Una opacidad que va más clara en las celdas de la red usada. */
const conRedUsada = (
  propia: ExpressionSpecification,
  redUsada: ExpressionSpecification,
): ExpressionSpecification => ["case", DE_LA_RED_USADA, redUsada, propia];

/**
 * Opacidad de las líneas de todas las celdas, sin selección y con ella, y de su casco. Sin la foto
 * el casco no se ve. Las de la red usada, a la mitad.
 */
const OPACIDAD_BORDES = {
  normal: {
    bordes: conRedUsada(conFoto(0.45, 0.85), conFoto(0.22, 0.42)),
    casco: conRedUsada(conFoto(0, 0.5), conFoto(0, 0.25)),
  },
  apagada: {
    bordes: conRedUsada(conFoto(0.14, 0.22), conFoto(0.07, 0.11)),
    casco: conRedUsada(conFoto(0, 0.12), conFoto(0, 0.06)),
  },
} as const;

const conFundido = (
  opacidad: number | ExpressionSpecification,
): DataDrivenPropertyValueSpecification<number> => [
  "interpolate",
  ["linear"],
  ["zoom"],
  ZOOM_CELDAS,
  0,
  ZOOM_CELDAS + FUNDIDO,
  opacidad,
];

const deLaCelda = (clave: string | null): FilterSpecification => [
  "==",
  ["get", "clave"],
  clave ?? "",
];

/**
 * Las capas de las celdas, con el color que les da el tema y el del casco claro que llevan sobre
 * la foto aérea. Van por debajo de los nombres de las calles, que se siguen leyendo encima de las
 * líneas.
 */
export const capasCeldas = (
  color: string,
  colorCasco: string,
): ReadonlyArray<LayerSpecification> => [
  {
    id: CAPA_CASCO,
    type: "line",
    source: FUENTE_CELDAS,
    minzoom: ZOOM_CELDAS,
    layout: { "line-join": "round" },
    paint: {
      "line-color": colorCasco,
      "line-width": 3,
      "line-opacity": conFundido(OPACIDAD_BORDES.normal.casco),
    },
  },
  {
    id: CAPA_BORDES,
    type: "line",
    source: FUENTE_CELDAS,
    minzoom: ZOOM_CELDAS,
    layout: { "line-join": "round" },
    paint: {
      "line-color": color,
      "line-width": 1,
      "line-opacity": conFundido(OPACIDAD_BORDES.normal.bordes),
    },
  },
  {
    id: CAPA_SELECCIONADA_CASCO,
    type: "line",
    source: FUENTE_CELDAS,
    minzoom: ZOOM_CELDAS,
    filter: deLaCelda(null),
    layout: { "line-join": "round" },
    paint: {
      "line-color": colorCasco,
      "line-width": 5,
      "line-opacity": conFundido(conFoto(0, 0.85)),
    },
  },
  {
    id: CAPA_SELECCIONADA,
    type: "line",
    source: FUENTE_CELDAS,
    minzoom: ZOOM_CELDAS,
    filter: deLaCelda(null),
    layout: { "line-join": "round" },
    paint: { "line-color": color, "line-width": 2, "line-opacity": conFundido(1) },
  },
  {
    id: CAPA_SELECCIONADA_CONTORNO,
    type: "line",
    source: FUENTE_CELDAS,
    minzoom: ZOOM_CELDAS,
    filter: deLaCelda(null),
    layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
    paint: {
      "line-color": color,
      "line-width": 2,
      "line-dasharray": [2, 2],
      "line-opacity": conFundido(1),
    },
  },
];

/** Lo que hace falta del mapa de MapLibre para remarcar una celda. */
export interface MapaConCeldas {
  readonly setFilter: (capa: string, filtro: FilterSpecification) => void;
  readonly setPaintProperty: (
    capa: string,
    propiedad: "line-opacity",
    valor: DataDrivenPropertyValueSpecification<number>,
  ) => void;
}

/**
 * Remarca la celda del emplazamiento `clave` y apaga las demás, o las deja todas igual con
 * `null`. MapLibre funde el cambio de opacidad. Las opacidades llevan dentro las de la foto
 * aérea, así que encenderla o apagarla no pasa por aquí.
 */
export const remarcarCelda = (mapa: MapaConCeldas, clave: string | null): void => {
  for (const capa of [CAPA_SELECCIONADA, CAPA_SELECCIONADA_CONTORNO, CAPA_SELECCIONADA_CASCO]) {
    mapa.setFilter(capa, deLaCelda(clave));
  }
  const opacidad = clave === null ? OPACIDAD_BORDES.normal : OPACIDAD_BORDES.apagada;
  mapa.setPaintProperty(CAPA_BORDES, "line-opacity", conFundido(opacidad.bordes));
  mapa.setPaintProperty(CAPA_CASCO, "line-opacity", conFundido(opacidad.casco));
};

/** Lo que hace falta del mapa de MapLibre para ocultar las celdas. */
export interface MapaConCapasOcultables {
  readonly setLayoutProperty: (
    capa: string,
    propiedad: "visibility",
    valor: "visible" | "none",
  ) => void;
}

/**
 * Con `soloContorno`, oculta las celdas y deja de la seleccionada solo su contorno discontinuo: lo que se ve con la vista de interferencia encima. Sin él, las vuelve a
 * dibujar como siempre.
 */
export const ocultarCeldasSalvoContorno = (
  mapa: MapaConCapasOcultables,
  soloContorno: boolean,
): void => {
  const normal = soloContorno ? "none" : "visible";
  for (const capa of [CAPA_CASCO, CAPA_BORDES, CAPA_SELECCIONADA_CASCO, CAPA_SELECCIONADA]) {
    mapa.setLayoutProperty(capa, "visibility", normal);
  }
  mapa.setLayoutProperty(
    CAPA_SELECCIONADA_CONTORNO,
    "visibility",
    soloContorno ? "visible" : "none",
  );
};
