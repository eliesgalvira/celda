import type {
  DataDrivenPropertyValueSpecification,
  FilterSpecification,
  LayerSpecification,
} from "maplibre-gl";

import { ZOOM_CELDAS } from "./celdas.ts";

/**
 * Cómo se dibuja en el mapa la celda del emplazamiento seleccionado, la variante «A · Degradado»
 * del prototipo v8: la celda dividida en sus sectores, el que da servicio relleno con un
 * degradado que se apaga con la distancia y los otros dos muy tenues, con cortes discontinuos
 * apenas visibles entre ellos. Sin punto de referencia, el degradado cubre la celda entera. Una
 * línea fina une el emplazamiento con el punto de referencia.
 */

/** La fuente GeoJSON de los sectores, el degradado y los cortes (`RasgoServicio`). */
export const FUENTE_SERVICIO = "servicio";

/** La fuente GeoJSON de la línea hasta el punto de referencia, que va aparte y sin esperar. */
export const FUENTE_SERVICIO_LINEA = "servicio-linea";

/**
 * Lo que lleva cada rasgo de `FUENTE_SERVICIO`:
 * - `banda`: un trozo del degradado, con la opacidad que le toca (`opacidadesDelDegradado`);
 * - `sector`: uno de los sectores que no dan servicio, que se rellena muy tenue;
 * - `corte`: una línea entre dos sectores, del emplazamiento al borde de la celda.
 */
export type PropiedadesServicio =
  | { readonly tipo: "banda"; readonly opacidad: number }
  | { readonly tipo: "sector" }
  | { readonly tipo: "corte" };

/** Las capas del servicio, por si otra vista tiene que apagarlas. */
export const CAPAS_SERVICIO = [
  "servicio-sectores",
  "servicio-degradado",
  "servicio-cortes",
  "servicio-linea",
] as const;

const [CAPA_SECTORES, CAPA_DEGRADADO, CAPA_CORTES, CAPA_LINEA] = CAPAS_SERVICIO;

/**
 * Opacidad del degradado según lo que se pierde respecto al pie del emplazamiento, en dB: casi la
 * mitad junto a él y muy poca a 40 dB, que en ciudad son unos 400 m. Entre medias, en línea recta.
 */
const PERFIL_DEGRADADO: ReadonlyArray<readonly [perdidaDb: number, opacidad: number]> = [
  [0, 0.5],
  [20, 0.22],
  [40, 0.06],
];

/** La opacidad que tiene que verse a `perdidaDb` del pie del emplazamiento. */
export const opacidadDelDegradado = (perdidaDb: number): number => {
  const [primero] = PERFIL_DEGRADADO;
  if (primero === undefined || perdidaDb <= primero[0]) return primero?.[1] ?? 0;
  for (let i = 1; i < PERFIL_DEGRADADO.length; i++) {
    const [d0, o0] = PERFIL_DEGRADADO[i - 1] ?? [0, 0];
    const [d1, o1] = PERFIL_DEGRADADO[i] ?? [0, 0];
    if (perdidaDb <= d1) return o0 + ((perdidaDb - d0) / (d1 - d0)) * (o1 - o0);
  }
  return PERFIL_DEGRADADO.at(-1)?.[1] ?? 0;
};

/**
 * La opacidad de cada banda del degradado. Las bandas se apilan (cada una contiene a las
 * anteriores), así que entre el borde de una y el de la siguiente se suman todas las de fuera.
 * Cada banda lleva lo justo para que la suma dé `opacidadDelDegradado` de su borde.
 */
export const opacidadesDelDegradado = (perdidas: ReadonlyArray<number>): Array<number> =>
  perdidas.map((perdida, k) => {
    const fuera = k + 1 < perdidas.length ? opacidadDelDegradado(perdidas[k + 1] ?? 0) : 0;
    return 1 - (1 - opacidadDelDegradado(perdida)) / (1 - fuera);
  });

/** Medio nivel de zoom en que aparece, como las celdas. */
const conFundido = (
  opacidad: number | DataDrivenPropertyValueSpecification<number>,
): DataDrivenPropertyValueSpecification<number> =>
  // SAFETY: MapLibre acepta una expresión de datos como salida de una interpolación por zoom.
  [
    "interpolate",
    ["linear"],
    ["zoom"],
    ZOOM_CELDAS,
    0,
    ZOOM_CELDAS + 0.5,
    opacidad,
  ] as DataDrivenPropertyValueSpecification<number>;

const deTipo = (tipo: PropiedadesServicio["tipo"]): FilterSpecification => [
  "==",
  ["get", "tipo"],
  tipo,
];

/** Los rellenos, que van por debajo de las líneas de las celdas. */
export const capasServicioDebajo = (color: string): ReadonlyArray<LayerSpecification> => [
  {
    id: CAPA_SECTORES,
    type: "fill",
    source: FUENTE_SERVICIO,
    minzoom: ZOOM_CELDAS,
    filter: deTipo("sector"),
    paint: { "fill-color": color, "fill-opacity": conFundido(0.07) },
  },
  {
    id: CAPA_DEGRADADO,
    type: "fill",
    source: FUENTE_SERVICIO,
    minzoom: ZOOM_CELDAS,
    filter: deTipo("banda"),
    // Sin borde suavizado: el de cada banda se notaría como un anillo.
    paint: {
      "fill-color": color,
      "fill-opacity": conFundido(["get", "opacidad"]),
      "fill-antialias": false,
    },
  },
];

/** Los cortes entre sectores y la línea hasta el punto, por encima de las celdas. */
export const capasServicioEncima = (
  color: string,
  colorReferencia: string,
): ReadonlyArray<LayerSpecification> => [
  {
    id: CAPA_CORTES,
    type: "line",
    source: FUENTE_SERVICIO,
    minzoom: ZOOM_CELDAS,
    filter: deTipo("corte"),
    paint: {
      "line-color": color,
      "line-width": 1,
      "line-dasharray": [2, 5],
      "line-opacity": conFundido(0.4),
    },
  },
  {
    id: CAPA_LINEA,
    type: "line",
    source: FUENTE_SERVICIO_LINEA,
    minzoom: ZOOM_CELDAS,
    layout: { "line-cap": "round" },
    paint: {
      "line-color": colorReferencia,
      "line-width": 1.6,
      "line-dasharray": [2, 2.5],
      "line-opacity": conFundido(1),
    },
  },
];
