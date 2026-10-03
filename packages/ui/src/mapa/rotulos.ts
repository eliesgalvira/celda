import type {
  ExpressionSpecification,
  LayerSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";

import { conFoto, deClase, porZoom, visibleConFoto } from "./expresiones.ts";
import type { ColorDeToken, TokenMapa } from "./tokens.ts";

/**
 * Los rótulos del mapa base: los nombres de lugar por importancia y zoom, los de las vías y el
 * agua, y pocos puntos de interés (ADR 0022). Los de lugar no salen de fuera de España por debajo
 * del zoom 9 (ADR 0024).
 */

/** La letra de los rótulos. */
const LETRA = "Noto Sans Regular";
/** Madrid y las capitales de comunidad, y los números de las carreteras. */
const LETRA_NEGRITA = "Noto Sans Bold";
/** Los nombres del agua. */
const LETRA_CURSIVA = "Noto Sans Italic";

/**
 * Las letras de los rótulos que se ven de lejos, antes del zoom 13. Sus glifos se piden por
 * adelantado (`RECURSOS_INICIALES_MAPA_BASE`).
 */
export const LETRAS_DE_LEJOS: ReadonlyArray<string> = [LETRA, LETRA_NEGRITA, LETRA_CURSIVA];

/**
 * El contorno de España como geometría GeoJSON: el de `espana.json`, que escribe `pnpm run
 * espana` en `tools/capas`.
 */
export interface ContornoDeEspana {
  readonly type: "MultiPolygon";
  readonly coordinates: Array<Array<Array<Array<number>>>>;
}

/** El primer zoom en que se rotulan los lugares de fuera de España (ADR 0024). */
export const ZOOM_DE_FUERA = 9;

/**
 * Los lugares que se rotulan: los de dentro de España y, desde `ZOOM_DE_FUERA`, también los de
 * fuera. Los filtros se evalúan con el zoom entero de cada tesela, así que hasta el 8,99 no sale
 * ninguno de fuera. Gibraltar no sale nunca: OpenMapTiles lo da como capital de país y salía
 * desde el zoom 4 junto a las capitales de comunidad.
 */
const soloDeEspana = (espana: ContornoDeEspana): ExpressionSpecification => [
  "all",
  ["!=", ["get", "name"], "Gibraltar"],
  ["any", [">=", ["zoom"], ZOOM_DE_FUERA], ["within", espana]],
];

/**
 * El estado del estilo con los municipios que son zona de Celda, en minúsculas. Los cambia
 * `quitarRotulosDeMunicipios`; el filtro de las capas de lugares no cambia nunca.
 */
export const MUNICIPIOS_DE_CELDA = "municipiosDeCelda";

/**
 * Lo que quita Celda de las capas de lugares: los municipios que son zona, con su nombre bajo el
 * hexágono. Los dos nombres se pisarían. Se comparan en minúsculas, porque el mapa base escribe
 * «l'Hospitalet» y el IGN, «L'Hospitalet». Un nombre que no coincide deja los dos rótulos, que es
 * lo menos malo: quitar el del mapa base donde Celda no pone etiqueta dejaría esa parte del mapa
 * sin nombres.
 */
const SIN_LOS_DE_CELDA: ExpressionSpecification = [
  "!",
  ["in", ["downcase", ["to-string", ["get", "name"]]], ["global-state", MUNICIPIOS_DE_CELDA]],
];

/** El rango de capital de OpenMapTiles: 2 la del país, 4 las de comunidad, 6 las de provincia. */
const CAPITAL: ExpressionSpecification = ["coalesce", ["get", "capital"], 99];

/**
 * El halo de un rótulo. Sobre la foto aérea todos llevan el mismo, oscuro, con la letra en blanco
 * (`tinta`), como el modo híbrido de Google.
 */
const halo = (color: ColorDeToken, ancho: number) => ({
  "text-halo-color": conFoto(color("mapa-halo"), color("mapa-foto-halo")),
  "text-halo-width": conFoto(ancho, 1.6),
  "text-halo-blur": conFoto(0.3, 0.4),
});

/** El color de un rótulo: el suyo o, sobre la foto aérea, blanco. */
const tinta = (
  color: ColorDeToken,
  propio: string | ExpressionSpecification,
): ExpressionSpecification => conFoto(propio, color("mapa-foto-rotulo"));

/** Una capa de lugares: qué clase de lugar rotula, desde y hasta qué zoom y con qué letra. */
interface CapaDeLugares {
  readonly id: string;
  readonly propio: ExpressionSpecification;
  readonly desde: number;
  readonly hasta: number;
  readonly letra: string;
  readonly tamano: ExpressionSpecification;
  readonly color: TokenMapa;
  readonly halo: number;
  /** Píxeles de aire alrededor del rótulo; por defecto, 2. */
  readonly aire?: number;
}

/**
 * Las capas de lugares, de la más importante a la menos. MapLibre coloca antes los rótulos de
 * las capas de encima, así que en el estilo van al revés: una capital gana a un pueblo. A más
 * importancia, letra más grande y halo más ancho.
 */
const LUGARES: ReadonlyArray<CapaDeLugares> = [
  {
    id: "lugares-capitales",
    // Madrid y las capitales de comunidad, en negrita.
    propio: ["all", deClase("city"), ["<=", CAPITAL, 4]],
    desde: 4,
    hasta: 14,
    letra: LETRA_NEGRITA,
    tamano: [
      "interpolate",
      ["linear"],
      ["zoom"],
      5,
      ["match", CAPITAL, 2, 14, 12.5],
      8,
      ["match", CAPITAL, 2, 17, 15],
      11,
      ["match", CAPITAL, 2, 19.5, 17.5],
    ],
    color: "mapa-rotulo-capital",
    halo: 1.8,
  },
  {
    id: "lugares-grandes",
    // Las capitales de provincia y las ciudades grandes que no son capital de comunidad.
    propio: [
      "all",
      deClase("city"),
      [">", CAPITAL, 4],
      ["any", ["==", CAPITAL, 6], ["<=", ["get", "rank"], 7]],
    ],
    desde: 4.5,
    hasta: 14,
    letra: LETRA,
    tamano: porZoom(5, 11.5, 8, 13.5, 11, 16),
    color: "mapa-rotulo-ciudad",
    halo: 1.6,
  },
  {
    id: "lugares-ciudades",
    propio: ["all", deClase("city"), [">", CAPITAL, 6], [">", ["get", "rank"], 7]],
    desde: 7,
    hasta: 14,
    letra: LETRA,
    tamano: porZoom(7, 12, 10, 14, 12, 15.5),
    color: "mapa-rotulo-ciudad",
    halo: 1.6,
  },
  {
    id: "lugares-pueblos-grandes",
    propio: deClase("town"),
    desde: 8,
    hasta: 14,
    letra: LETRA,
    tamano: porZoom(8, 11.5, 10, 13, 12, 14.5),
    color: "mapa-rotulo-ciudad",
    halo: 1.5,
    aire: 4,
  },
  {
    id: "lugares-pueblos",
    propio: deClase("village"),
    desde: 10,
    hasta: 16,
    letra: LETRA,
    tamano: porZoom(10, 11, 13, 12.5, 15, 14),
    color: "mapa-rotulo-pueblo",
    halo: 1.5,
    aire: 3,
  },
  {
    id: "lugares-aldeas",
    propio: deClase("hamlet", "isolated_dwelling"),
    desde: 12,
    hasta: 17,
    letra: LETRA,
    tamano: porZoom(12, 10.5, 16, 12.5),
    color: "mapa-rotulo-aldea",
    halo: 1.5,
  },
];

/** Los nombres de las capas de lugares, cuyo filtro cambia `quitarRotulosDeMunicipios`. */
export const CAPAS_DE_LUGARES: ReadonlyArray<string> = LUGARES.map((capa) => capa.id);

const capaDeLugares = (
  fuente: string,
  color: ColorDeToken,
  espana: ContornoDeEspana,
  capa: CapaDeLugares,
): SymbolLayerSpecification => ({
  id: capa.id,
  type: "symbol",
  source: fuente,
  "source-layer": "place",
  minzoom: capa.desde,
  maxzoom: capa.hasta,
  filter: ["all", soloDeEspana(espana), capa.propio, SIN_LOS_DE_CELDA],
  layout: {
    "text-field": ["get", "name"],
    "text-font": [capa.letra],
    "text-size": capa.tamano,
    "symbol-sort-key": ["get", "rank"],
    "text-padding": capa.aire ?? 2,
  },
  paint: { "text-color": tinta(color, color(capa.color)), ...halo(color, capa.halo) },
});

/** Los nombres del agua, de las vías, los puntos de interés y los barrios. */
const capasDeNombres = (
  fuente: string,
  color: ColorDeToken,
): ReadonlyArray<SymbolLayerSpecification> => [
  {
    id: "nombres-de-rios",
    type: "symbol",
    source: fuente,
    "source-layer": "waterway",
    minzoom: 12,
    filter: deClase("river", "canal"),
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "name"],
      "text-font": [LETRA_CURSIVA],
      "text-size": 11.5,
      "text-letter-spacing": 0.05,
    },
    paint: { "text-color": tinta(color, color("mapa-rotulo-agua")), ...halo(color, 1.2) },
  },
  {
    id: "nombres-de-mares",
    type: "symbol",
    source: fuente,
    "source-layer": "water_name",
    filter: deClase("ocean", "sea", "bay", "strait"),
    layout: {
      "text-field": ["get", "name"],
      "text-font": [LETRA_CURSIVA],
      "text-size": 13,
      "text-letter-spacing": 0.12,
      "text-max-width": 7,
    },
    paint: { "text-color": tinta(color, color("mapa-rotulo-agua")), ...halo(color, 1) },
  },
  {
    id: "nombres-de-lagos",
    type: "symbol",
    source: fuente,
    "source-layer": "water_name",
    minzoom: 10,
    filter: deClase("lake", "reservoir"),
    layout: {
      "text-field": ["get", "name"],
      "text-font": [LETRA_CURSIVA],
      "text-size": 11.5,
      "text-max-width": 7,
    },
    paint: { "text-color": tinta(color, color("mapa-rotulo-agua")), ...halo(color, 1) },
  },
  {
    id: "nombres-de-calles",
    type: "symbol",
    source: fuente,
    "source-layer": "transportation_name",
    minzoom: 15,
    filter: [
      "any",
      deClase("minor", "service"),
      ["all", deClase("path"), ["==", ["get", "subclass"], "pedestrian"]],
    ],
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "name"],
      "text-font": [LETRA],
      "text-size": porZoom(15, 11, 18, 13.5),
    },
    paint: { "text-color": tinta(color, color("mapa-rotulo-calle")), ...halo(color, 1.6) },
  },
  {
    id: "nombres-de-avenidas",
    type: "symbol",
    source: fuente,
    "source-layer": "transportation_name",
    minzoom: 12,
    filter: deClase("primary", "secondary", "tertiary", "trunk"),
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "name"],
      "text-font": [LETRA],
      "text-size": porZoom(12, 10.5, 15, 12, 18, 14.5),
      "symbol-sort-key": ["match", ["get", "class"], ["trunk", "primary"], 0, "secondary", 1, 2],
    },
    paint: {
      "text-color": tinta(color, color("mapa-rotulo-ciudad")),
      ...halo(color, 1.8),
      "text-opacity": porZoom(12.5, 0, 13, 1),
    },
  },
  {
    // El número de las autopistas y las autovías (A-2, AP-7), sobre su propio amarillo.
    id: "numeros-de-carreteras",
    type: "symbol",
    source: fuente,
    "source-layer": "transportation_name",
    minzoom: 7,
    maxzoom: 14,
    filter: ["all", deClase("motorway", "trunk"), ["has", "ref"], ["<=", ["get", "ref_length"], 7]],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 400,
      "text-field": ["get", "ref"],
      "text-font": [LETRA_NEGRITA],
      "text-size": 10,
      "text-rotation-alignment": "viewport",
      "text-padding": 20,
    },
    paint: {
      "text-color": color("mapa-rotulo-carretera"),
      "text-halo-color": conFoto(color("mapa-autopista"), color("mapa-foto-autopista")),
      "text-halo-width": 2.6,
    },
  },
  {
    // Pocos, para no competir con los logos de Celda: estaciones, hospitales, ayuntamientos,
    // parques y lo que OpenStreetMap da como atracción, museo o estadio.
    id: "puntos-de-interes",
    type: "symbol",
    source: fuente,
    "source-layer": "poi",
    minzoom: 14,
    filter: [
      "all",
      ["has", "name"],
      ["<=", ["get", "rank"], 18],
      [
        "any",
        ["all", deClase("railway"), ["==", ["get", "subclass"], "station"]],
        deClase("hospital", "town_hall", "park", "attraction", "museum", "stadium"),
      ],
    ],
    layout: {
      "text-field": ["get", "name"],
      "text-font": [LETRA],
      "text-size": 11,
      "text-max-width": 8,
      "symbol-sort-key": ["get", "rank"],
      "text-padding": 6,
    },
    paint: {
      "text-color": tinta(color, [
        "match",
        ["get", "class"],
        "railway",
        color("mapa-pdi-transporte"),
        "hospital",
        color("mapa-pdi-salud"),
        "park",
        color("mapa-pdi-parque"),
        color("mapa-pdi-otro"),
      ]),
      ...halo(color, 1.4),
      "text-opacity": porZoom(14.5, 0, 15, 1),
    },
  },
  {
    id: "aeropuertos",
    type: "symbol",
    source: fuente,
    "source-layer": "aerodrome_label",
    minzoom: 9,
    filter: ["has", "iata"],
    layout: {
      "text-field": ["get", "name"],
      "text-font": [LETRA],
      "text-size": 11,
      "text-max-width": 8,
    },
    paint: { "text-color": tinta(color, color("mapa-pdi-transporte")), ...halo(color, 1.4) },
  },
  {
    id: "barrios",
    type: "symbol",
    source: fuente,
    "source-layer": "place",
    // Del 13 al 14 los barrios de Barcelona son zonas de Celda (`MarcadorZona`), con su nombre y
    // su número; los rótulos del mapa base se pisarían con ellas.
    minzoom: 14,
    filter: deClase("suburb", "quarter", "neighbourhood"),
    layout: {
      "text-field": ["get", "name"],
      "text-font": [LETRA],
      "text-size": porZoom(14, 11.5, 17, 13),
      "text-max-width": 7,
    },
    paint: { "text-color": tinta(color, color("mapa-rotulo-barrio")), ...halo(color, 1.5) },
  },
];

/** Los números de portal, que solo salen sobre la foto aérea y que busca «Ver el edificio». */
export const CAPA_PORTALES = "portales";

/**
 * Los números de portal, como en Google, desde el zoom 18: a 17 llenan las manzanas. Solo con la
 * foto aérea encendida, así que sin ella no cuestan nada. El zoom mínimo es 15 y no 17: por
 * encima de 15 MapLibre no vuelve a maquetar las teselas (`zoomsSinPartir` en la web), y una capa
 * que empieza más arriba no saldría nunca. No apartan a los demás rótulos.
 */
const capaDePortales = (fuente: string, color: ColorDeToken): SymbolLayerSpecification => ({
  id: CAPA_PORTALES,
  type: "symbol",
  source: fuente,
  "source-layer": "housenumber",
  minzoom: 15,
  layout: {
    visibility: visibleConFoto,
    "text-field": ["get", "housenumber"],
    "text-font": [LETRA],
    "text-size": 10.5,
    "text-ignore-placement": true,
  },
  paint: {
    "text-color": color("mapa-foto-rotulo"),
    "text-halo-color": color("mapa-foto-halo"),
    "text-halo-width": 1.6,
    "text-opacity": porZoom(17.5, 0, 18, 1),
  },
});

/**
 * Las capas de rótulos, de abajo arriba: los nombres, los números de portal y después los
 * lugares, de menos a más importantes.
 */
export const capasRotulos = (
  fuente: string,
  color: ColorDeToken,
  espana: ContornoDeEspana,
): ReadonlyArray<LayerSpecification> => [
  ...capasDeNombres(fuente, color),
  capaDePortales(fuente, color),
  ...LUGARES.toReversed().map((capa) => capaDeLugares(fuente, color, espana, capa)),
];

/** Lo que hace falta del mapa de MapLibre para quitar rótulos de lugar. */
export interface MapaConRotulos {
  readonly getLayer: (capa: string) => object | undefined;
  readonly setGlobalStateProperty: (nombre: string, valor: ReadonlyArray<string>) => void;
}

/**
 * Quita del mapa base los rótulos de lugar de los municipios de `nombres`, en todas las capas de
 * lugares: un municipio puede ser ciudad, pueblo o aldea en OpenStreetMap. Cambia un estado del
 * estilo y no los filtros: así no se vuelve a mandar a los workers el contorno de España de cada
 * capa, que costaba un tercio más de JavaScript por fotograma al acercar (#61). MapLibre no hace
 * nada si los nombres no cambian. Antes de que el estilo tenga sus capas no hace nada: MapLibre no
 * deja cambiar el estado todavía, y en la vista inicial no hay etiquetas de municipio.
 */
export const quitarRotulosDeMunicipios = (
  mapa: MapaConRotulos,
  nombres: ReadonlyArray<string>,
): void => {
  if (mapa.getLayer(CAPAS_DE_LUGARES[0] ?? "") === undefined) return;
  mapa.setGlobalStateProperty(
    MUNICIPIOS_DE_CELDA,
    nombres.map((nombre) => nombre.toLowerCase()),
  );
};
