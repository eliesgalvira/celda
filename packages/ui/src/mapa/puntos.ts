import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSourceSpecification,
  LayerSpecification,
  Map as MapaMapLibre,
} from "maplibre-gl";

import { conFoto, porZoom } from "./expresiones.ts";

/**
 * La vista de puntos (ADR 0028): cada emplazamiento de España es un punto pequeño y
 * semitransparente del verde azulado de Celda, sin agrupar. La densidad sola dibuja las ciudades,
 * las costas y las carreteras. Es la variante «fina» del prototipo de la rama `prototipo/puntos`,
 * la que eligió el usuario el 08/10/2026.
 *
 * Los puntos van en el estilo, bajo los rótulos del mapa base, en capas de MapLibre y no en el
 * DOM. Su fuente empieza vacía y la web la llena con los puntos de toda España. Como el resto de lo
 * que pinta Celda, pasan al mapa base de reserva del IGN con lo que la web les ha cambiado: sus
 * datos, su filtro, si se ven y su opacidad.
 */

/** La fuente con un punto por emplazamiento: `c` es la máscara de sus compañías y el `id`, su fila. */
export const FUENTE_PUNTOS = "puntos";

/** La fuente con el emplazamiento elegido, o el que se acaba de tocar mientras llega su ficha. */
export const FUENTE_PUNTO_ELEGIDO = "punto-elegido";

const CAPA_PUNTOS = "puntos";
const CAPA_PUNTOS_RED_USADA = "puntos-red-usada";
const CAPA_ELEGIDO = "punto-elegido";
const CAPA_ELEGIDO_ANILLO = "punto-elegido-anillo";

/** Las capas que se pueden tocar. */
export const CAPAS_DE_PUNTOS_TOCABLES: ReadonlyArray<string> = [CAPA_PUNTOS, CAPA_PUNTOS_RED_USADA];

const TODAS = [CAPA_PUNTOS_RED_USADA, CAPA_PUNTOS, CAPA_ELEGIDO_ANILLO, CAPA_ELEGIDO] as const;

/** Una curva por zoom: pares de zoom y valor, de menos a más zoom. */
type Curva = ReadonlyArray<readonly [zoom: number, valor: number]>;

/**
 * El radio de cada punto en píxeles CSS: crece con el zoom hasta el de los logos y algo más,
 * por si el mapa se queda ahí mientras llegan.
 */
const RADIO: Curva = [
  [4, 1.3],
  [6, 1.6],
  [8, 2],
  [10, 2.5],
  [12, 3.1],
  [14, 4],
  [15, 4.6],
  [17, 5.4],
];

/**
 * La opacidad de cada punto. Donde se juntan se suman y una ciudad sale casi opaca; uno suelto
 * en el campo se sigue viendo. Baja algo a media distancia, donde una ciudad son cientos, y sube
 * de cerca, donde ya van separados.
 */
const OPACIDAD: Curva = [
  [4, 0.8],
  [7, 0.7],
  [9, 0.6],
  [11, 0.55],
  [13, 0.7],
  [14.5, 0.9],
];

/** El valor de una curva a un zoom, en línea recta entre sus paradas, como `interpolate`. */
const enCurva = (curva: Curva, zoom: number): number => {
  const primera = curva[0] ?? [0, 0];
  if (zoom <= primera[0]) return primera[1];
  for (let i = 1; i < curva.length; i++) {
    const [z0, v0] = curva[i - 1] ?? primera;
    const [z1, v1] = curva[i] ?? primera;
    if (zoom <= z1) return v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0);
  }
  return curva.at(-1)?.[1] ?? primera[1];
};

/** El radio de un punto a un zoom, en píxeles CSS: el mismo que dibuja MapLibre. */
export const radioDePunto = (zoom: number): number => enCurva(RADIO, zoom);

/** La opacidad de un punto a un zoom: la misma que dibuja MapLibre. */
export const opacidadDePunto = (zoom: number): number => enCurva(OPACIDAD, zoom);

/** Lo que pesa la red usada frente a lo propio: sale más clara, como sus logos (ADR 0026). */
const PESO_RED_USADA = 0.4;

/** Lo que tardan los puntos en irse cuando salen los logos, y en volver. */
export const FUNDIDO_DE_PUNTOS_MS = 250;

const deCurva = (curva: Curva, factor = 1): ExpressionSpecification =>
  porZoom(...curva.flatMap(([zoom, valor]) => [zoom, valor * factor]));

/** Sobre la foto aérea cada punto lleva un borde claro: el verde azulado solo se pierde en ella. */
const BORDE_CON_FOTO: ExpressionSpecification = conFoto(0, 1);

/** Las máscaras de compañías (1 a 31) que cumplen `cumple`: el filtro no tiene operaciones de bits. */
const mascaras = (cumple: (mascara: number) => boolean): Array<number> =>
  Array.from({ length: 31 }, (_, i) => i + 1).filter(cumple);

const enMascaras = (lista: ReadonlyArray<number>): FilterSpecification => [
  "in",
  ["get", "c"],
  ["literal", [...lista]],
];

/** Ningún punto. */
const NINGUNO: FilterSpecification = ["==", ["get", "c"], -1];

/** Los filtros de las dos capas de puntos. */
export interface FiltrosDePuntos {
  readonly propios: FilterSpecification;
  readonly redUsada: FilterSpecification;
}

/**
 * Los filtros de las dos capas para un filtro de compañías, con sus máscaras (`mascarasDeFiltro`
 * de `@celda/dominio/filtro`): los de las compañías del filtro y, aparte y más claros, los de la
 * red que usan. Sin filtro, todos son propios.
 */
export const filtrosDePuntos = (propias: number, usadas: number): FiltrosDePuntos => ({
  propios: propias === 0 ? ["has", "c"] : enMascaras(mascaras((m) => (m & propias) !== 0)),
  redUsada:
    propias === 0 || usadas === 0
      ? NINGUNO
      : enMascaras(mascaras((m) => (m & propias) === 0 && (m & usadas) !== 0)),
});

const VACIA: GeoJSONSourceSpecification = {
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
};

/** Las fuentes de los puntos, vacías hasta que la web las llena. */
export const fuentesPuntos = () =>
  ({
    // Un punto no ocupa más que su radio: el margen de las teselas puede ser pequeño.
    [FUENTE_PUNTOS]: { ...VACIA, buffer: 8 },
    [FUENTE_PUNTO_ELEGIDO]: VACIA,
  }) satisfies Readonly<Record<string, GeoJSONSourceSpecification>>;

/** La opacidad de los puntos cuando se ven, por zoom, y la de los de la red usada. */
const opacidadDe = (capa: string): ExpressionSpecification =>
  deCurva(OPACIDAD, capa === CAPA_PUNTOS_RED_USADA ? PESO_RED_USADA : 1);

const transicion = { duration: FUNDIDO_DE_PUNTOS_MS, delay: 0 };

/**
 * Las capas de los puntos, escondidas hasta que la web elige la vista de puntos: los de la red
 * usada y los propios, bajo los rótulos del mapa base. `color` es `--mapa-punto` y `claro`, el
 * borde sobre la foto aérea (`--mapa-foto-linea`).
 */
export const capasPuntos = (color: string, claro: string): ReadonlyArray<LayerSpecification> => {
  const punto = (id: string, filter: FilterSpecification): LayerSpecification => ({
    id,
    type: "circle",
    source: FUENTE_PUNTOS,
    filter,
    layout: { visibility: "none" },
    paint: {
      "circle-radius": deCurva(RADIO),
      "circle-color": color,
      "circle-opacity": opacidadDe(id),
      "circle-opacity-transition": transicion,
      "circle-stroke-color": claro,
      "circle-stroke-width": BORDE_CON_FOTO,
      "circle-stroke-opacity": opacidadDe(id),
      "circle-stroke-opacity-transition": transicion,
    },
  });
  return [punto(CAPA_PUNTOS_RED_USADA, NINGUNO), punto(CAPA_PUNTOS, ["has", "c"])];
};

/**
 * Las capas del emplazamiento elegido, un punto mayor con un anillo, encima de todo, también de
 * los rótulos: es lo que dice qué ficha está abierta. `halo` es `--mapa-halo`.
 */
export const capasPuntoElegido = (
  color: string,
  halo: string,
): ReadonlyArray<LayerSpecification> => [
  {
    id: CAPA_ELEGIDO_ANILLO,
    type: "circle",
    source: FUENTE_PUNTO_ELEGIDO,
    layout: { visibility: "none" },
    paint: {
      "circle-radius": 11,
      "circle-opacity": 0,
      "circle-stroke-color": color,
      "circle-stroke-width": 2.5,
      "circle-stroke-opacity": 1,
      "circle-stroke-opacity-transition": transicion,
    },
  },
  {
    id: CAPA_ELEGIDO,
    type: "circle",
    source: FUENTE_PUNTO_ELEGIDO,
    layout: { visibility: "none" },
    paint: {
      "circle-radius": 6,
      "circle-color": color,
      "circle-opacity": 1,
      "circle-opacity-transition": transicion,
      "circle-stroke-color": halo,
      "circle-stroke-width": 2,
      "circle-stroke-opacity": 1,
      "circle-stroke-opacity-transition": transicion,
    },
  },
];

/** Lo que hace falta del mapa para cambiar los puntos. `Map` de MapLibre lo cumple. */
export type MapaDePuntos = Pick<
  MapaMapLibre,
  "getLayer" | "setFilter" | "setLayoutProperty" | "setPaintProperty"
>;

/**
 * Enseña o esconde los puntos: con la vista agrupada no se ven. MapLibre no hace nada si ya
 * estaban así, y con ellos escondidos no dibuja ni coloca nada de su fuente.
 */
export const mostrarPuntos = (mapa: MapaDePuntos, visibles: boolean): void => {
  for (const id of TODAS) {
    if (mapa.getLayer(id) === undefined) continue;
    mapa.setLayoutProperty(id, "visibility", visibles ? "visible" : "none");
  }
};

/**
 * Apaga los puntos con un fundido mientras salen los logos, o los vuelve a encender. Solo cambia
 * su opacidad, que no depende de cada punto: MapLibre no vuelve a maquetar sus teselas.
 */
export const apagarPuntos = (mapa: MapaDePuntos, apagados: boolean): void => {
  for (const id of [CAPA_PUNTOS_RED_USADA, CAPA_PUNTOS]) {
    if (mapa.getLayer(id) === undefined) continue;
    const opacidad = apagados ? 0 : opacidadDe(id);
    mapa.setPaintProperty(id, "circle-opacity", opacidad);
    mapa.setPaintProperty(id, "circle-stroke-opacity", opacidad);
  }
  for (const id of [CAPA_ELEGIDO_ANILLO, CAPA_ELEGIDO]) {
    if (mapa.getLayer(id) === undefined) continue;
    if (id === CAPA_ELEGIDO) mapa.setPaintProperty(id, "circle-opacity", apagados ? 0 : 1);
    mapa.setPaintProperty(id, "circle-stroke-opacity", apagados ? 0 : 1);
  }
};

/** Pone en las dos capas los filtros de un filtro de compañías (`filtrosDePuntos`). */
export const filtrarPuntos = (mapa: MapaDePuntos, filtros: FiltrosDePuntos): void => {
  if (mapa.getLayer(CAPA_PUNTOS) === undefined) return;
  mapa.setFilter(CAPA_PUNTOS, filtros.propios);
  mapa.setFilter(CAPA_PUNTOS_RED_USADA, filtros.redUsada);
};

/** Lo que va en la fuente del elegido: su punto, o ninguno. */
export const datosDelElegido = (
  posicion: { readonly longitud: number; readonly latitud: number } | undefined,
): Exclude<GeoJSONSourceSpecification["data"], string> => ({
  type: "FeatureCollection",
  features:
    posicion === undefined
      ? []
      : [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [posicion.longitud, posicion.latitud] },
            properties: {},
          },
        ],
});
