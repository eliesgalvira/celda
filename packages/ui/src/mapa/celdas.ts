import type {
  DataDrivenPropertyValueSpecification,
  FilterSpecification,
  LayerSpecification,
} from "maplibre-gl";

/**
 * Cómo se dibujan las celdas en el mapa, como en el prototipo v8: un trazo fino del color primario
 * para todas y, al seleccionar un emplazamiento, su celda remarcada y las demás casi invisibles,
 * para que no se amontonen líneas alrededor de la que importa. El relleno de la seleccionada es el
 * degradado de `servicio.ts`.
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

/** Opacidad de las líneas de todas las celdas, sin selección y con ella. */
const OPACIDAD_BORDES = { normal: 0.45, apagada: 0.14 } as const;

const conFundido = (opacidad: number): DataDrivenPropertyValueSpecification<number> => [
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
 * Las capas de las celdas, con el color que les da el tema. Van por debajo de los nombres de las
 * calles, que se siguen leyendo encima de las líneas.
 */
export const capasCeldas = (color: string): ReadonlyArray<LayerSpecification> => [
  {
    id: CAPA_BORDES,
    type: "line",
    source: FUENTE_CELDAS,
    minzoom: ZOOM_CELDAS,
    layout: { "line-join": "round" },
    paint: {
      "line-color": color,
      "line-width": 1,
      "line-opacity": conFundido(OPACIDAD_BORDES.normal),
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
 * `null`. MapLibre funde el cambio de opacidad.
 */
export const remarcarCelda = (mapa: MapaConCeldas, clave: string | null): void => {
  mapa.setFilter(CAPA_SELECCIONADA, deLaCelda(clave));
  mapa.setFilter(CAPA_SELECCIONADA_CONTORNO, deLaCelda(clave));
  mapa.setPaintProperty(
    CAPA_BORDES,
    "line-opacity",
    conFundido(clave === null ? OPACIDAD_BORDES.normal : OPACIDAD_BORDES.apagada),
  );
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
  for (const capa of [CAPA_BORDES, CAPA_SELECCIONADA]) {
    mapa.setLayoutProperty(capa, "visibility", normal);
  }
  mapa.setLayoutProperty(
    CAPA_SELECCIONADA_CONTORNO,
    "visibility",
    soloContorno ? "visible" : "none",
  );
};
