import type {
  ExpressionSpecification,
  LayerSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";

import { conFoto, porZoom, soloConFoto, textoDeRotulo } from "../expresiones.ts";
import { capaHuecos } from "../huecos.ts";
import { CAPA_PORTALES, MUNICIPIOS_DE_CELDA, ZOOM_DE_FUERA } from "../rotulos.ts";
import type { ColorDeToken, TokenMapa } from "../tokens.ts";
import { NOMBRE_DEL_IGN, SE_ROTULA } from "./nombres.ts";
import { ES_AVENIDA, EN_USO } from "./vias.ts";

/**
 * Los rótulos del mapa base de reserva, con la letra, los tamaños, los colores y los zooms del
 * principal (`../rotulos.ts`, ADR 0022). Los nombres de lugar escriben el nombre de lugar
 * (`NOMBRE_DEL_IGN`, ADR 0025), y los de fuera de España no salen de lejos ni Gibraltar en ningún
 * zoom (ADR 0024): el IGN marca con `esp` lo que es de España. Las calles salen como las escribe
 * el IGN, en castellano y sin tildes («Calle Arago»).
 *
 * El IGN no da rango a los lugares: todos los municipios llevan la misma `jerarquia`. La importancia
 * sale de la clase (capital del Estado, de comunidad, de provincia, de municipio) y de la capa de
 * contexto, que de lejos solo trae las ciudades grandes.
 */

/** Las letras, las mismas que el principal y con el mismo nombre en los glifos del IGN. */
const LETRA = "Noto Sans Regular";
const LETRA_NEGRITA = "Noto Sans Bold";
const LETRA_CURSIVA = "Noto Sans Italic";

/** Las clases de los lugares en `nombre_poblacion_construccion_pto`. */
const CAPITAL_DEL_ESTADO = "capital_estado";
const CAPITAL_DE_COMUNIDAD = "capital_comunidad_autonoma_ciudad_autonoma";

const CLASE: ExpressionSpecification = ["get", "clase"];

const deClase = (...clases: ReadonlyArray<string>): ExpressionSpecification => [
  "in",
  CLASE,
  ["literal", clases],
];

/** Un nombre que no está vacío. */
const CON_NOMBRE: ExpressionSpecification = ["!=", ["coalesce", ["get", "nombre"], ""], ""];

/** Lo de España en las capas de contexto, que traen también lo de fuera. */
const DE_ESPANA: ExpressionSpecification = ["==", ["get", "esp"], 1];

/**
 * Gibraltar no se rotula en ningún zoom (ADR 0024). La capa de contexto del IGN lo trae como lugar
 * de España (`esp`), así que se quita en todas las de lugares.
 */
const NO_GIBRALTAR: ExpressionSpecification = ["!=", NOMBRE_DEL_IGN, "Gibraltar"];

/** El halo de un rótulo; sobre la foto aérea, oscuro, como en el principal. */
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

/** Sin los municipios que son zona de Celda, que ya escribe su nombre bajo el hexágono. */
const sinLosDeCelda = (nombre: ExpressionSpecification): ExpressionSpecification => [
  "!",
  ["in", ["downcase", nombre], ["global-state", MUNICIPIOS_DE_CELDA]],
];

/** Una capa de lugares, como las del principal. */
interface CapaDeLugares {
  readonly id: string;
  readonly capa: "nombre_poblacion_construccion_pto" | "contexto_nombre_poblacion_pto";
  readonly propio: ExpressionSpecification;
  readonly desde: number;
  readonly hasta: number;
  readonly letra: string;
  readonly tamano: ExpressionSpecification;
  readonly color: TokenMapa;
  readonly halo: number;
  readonly aire?: number;
}

const TAMANO_DE_CAPITALES: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  ["match", CLASE, CAPITAL_DEL_ESTADO, 14, 12.5],
  8,
  ["match", CLASE, CAPITAL_DEL_ESTADO, 17, 15],
  11,
  ["match", CLASE, CAPITAL_DEL_ESTADO, 19.5, 17.5],
];
const TAMANO_DE_GRANDES = porZoom(5, 11.5, 8, 13.5, 11, 16);
const TAMANO_DE_CIUDADES = porZoom(7, 12, 10, 14, 12, 15.5);

/**
 * De la menos importante a la más: MapLibre coloca antes los rótulos de las capas de encima. Las
 * de contexto dan los lugares de lejos, hasta que entran los de la capa de lugares del IGN; donde
 * coinciden, el mismo nombre en el mismo punto se aparta solo.
 */
const LUGARES: ReadonlyArray<CapaDeLugares> = [
  {
    id: "lugares-aldeas",
    capa: "nombre_poblacion_construccion_pto",
    propio: deClase(
      "entidad_singular",
      "nucleo_poblacion",
      "entidad_menor_poblacion",
      "capital_eatim",
      "eatim",
    ),
    desde: 12,
    hasta: 17,
    letra: LETRA,
    tamano: porZoom(12, 10.5, 16, 12.5),
    color: "mapa-rotulo-aldea",
    halo: 1.5,
  },
  {
    // Todos los municipios, sin rango: de cerca, como los pueblos del principal.
    id: "lugares-pueblos",
    capa: "nombre_poblacion_construccion_pto",
    propio: deClase("capital_municipio"),
    desde: 10,
    hasta: 16,
    letra: LETRA,
    tamano: porZoom(10, 11, 13, 12.5, 15, 14),
    color: "mapa-rotulo-pueblo",
    halo: 1.5,
    aire: 3,
  },
  {
    id: "lugares-de-fuera",
    capa: "contexto_nombre_poblacion_pto",
    propio: ["!", DE_ESPANA],
    desde: ZOOM_DE_FUERA,
    hasta: 14,
    letra: LETRA,
    tamano: TAMANO_DE_CIUDADES,
    color: "mapa-rotulo-ciudad",
    halo: 1.6,
  },
  {
    // Las ciudades grandes que no son capital (Sabadell, Móstoles, Getafe), las únicas que el IGN
    // distingue de los demás municipios.
    id: "lugares-ciudades",
    capa: "contexto_nombre_poblacion_pto",
    propio: ["all", DE_ESPANA, ["==", CLASE, "nucleo_poblacion"]],
    desde: 7,
    hasta: 14,
    letra: LETRA,
    tamano: TAMANO_DE_CIUDADES,
    color: "mapa-rotulo-ciudad",
    halo: 1.6,
  },
  {
    // De lejos, las capitales de provincia y las ciudades grandes van en la misma capa de contexto.
    id: "lugares-grandes-lejos",
    capa: "contexto_nombre_poblacion_pto",
    propio: ["all", DE_ESPANA, ["==", CLASE, "nucleo_poblacion"]],
    desde: 4.5,
    hasta: 7,
    letra: LETRA,
    tamano: TAMANO_DE_GRANDES,
    color: "mapa-rotulo-ciudad",
    halo: 1.6,
  },
  {
    id: "lugares-grandes",
    capa: "nombre_poblacion_construccion_pto",
    propio: deClase("capital_provincia"),
    desde: 7,
    hasta: 14,
    letra: LETRA,
    tamano: TAMANO_DE_GRANDES,
    color: "mapa-rotulo-ciudad",
    halo: 1.6,
  },
  {
    id: "lugares-capitales-lejos",
    capa: "contexto_nombre_poblacion_pto",
    propio: ["all", DE_ESPANA, ["==", CLASE, CAPITAL_DEL_ESTADO]],
    desde: 4,
    hasta: 7,
    letra: LETRA_NEGRITA,
    tamano: TAMANO_DE_CAPITALES,
    color: "mapa-rotulo-capital",
    halo: 1.8,
  },
  {
    // Madrid y las capitales de comunidad, en negrita. El mismo nombre que la primera capa de
    // lugares del principal: `quitarRotulosDeMunicipios` la busca para saber si el estilo está.
    id: "lugares-capitales",
    capa: "nombre_poblacion_construccion_pto",
    propio: deClase(CAPITAL_DEL_ESTADO, CAPITAL_DE_COMUNIDAD),
    desde: 7,
    hasta: 14,
    letra: LETRA_NEGRITA,
    tamano: TAMANO_DE_CAPITALES,
    color: "mapa-rotulo-capital",
    halo: 1.8,
  },
];

/**
 * Las capas de ciudades que Celda copia encima de sus datos, como las del principal
 * (`CAPAS_DE_CIUDADES`), con las de lejos del IGN. Se colocan antes que los huecos de los
 * marcadores; las de debajo, pueblos y lugares de fuera, los esquivan.
 */
export const CAPAS_DE_CIUDADES_DE_RESERVA: ReadonlyArray<string> = [
  "lugares-capitales",
  "lugares-capitales-lejos",
  "lugares-grandes",
  "lugares-grandes-lejos",
  "lugares-ciudades",
];

const capaDeLugares = (
  fuente: string,
  color: ColorDeToken,
  capa: CapaDeLugares,
): SymbolLayerSpecification => {
  const nombre = NOMBRE_DEL_IGN;
  const pintura: NonNullable<SymbolLayerSpecification["paint"]> = {
    "text-color": tinta(color, color(capa.color)),
    ...halo(color, capa.halo),
  };
  // Las ciudades se colocan pero no se pintan: Celda las copia encima de sus datos (ADR 0024).
  if (CAPAS_DE_CIUDADES_DE_RESERVA.includes(capa.id)) pintura["text-opacity"] = 0;
  return {
    id: capa.id,
    type: "symbol",
    source: fuente,
    "source-layer": capa.capa,
    minzoom: capa.desde,
    maxzoom: capa.hasta,
    filter: ["all", capa.propio, CON_NOMBRE, SE_ROTULA, NO_GIBRALTAR, sinLosDeCelda(nombre)],
    layout: {
      "text-field": textoDeRotulo(nombre),
      "text-font": [capa.letra],
      "text-size": capa.tamano,
      "text-padding": capa.aire ?? 2,
    },
    paint: pintura,
  };
};

/** Un rótulo a lo largo de una línea, como las calles y los ríos. */
const aLoLargo = (
  id: string,
  fuente: string,
  capa: string,
  minzoom: number,
  filtro: ExpressionSpecification,
  aspecto: { readonly letra: string; readonly tamano: number | ExpressionSpecification },
) => ({
  id,
  type: "symbol" as const,
  source: fuente,
  "source-layer": capa,
  minzoom,
  filter: ["all", CON_NOMBRE, filtro] satisfies ExpressionSpecification,
  layout: {
    "symbol-placement": "line" as const,
    "text-field": ["get", "nombre"] satisfies ExpressionSpecification,
    "text-font": [aspecto.letra],
    "text-size": aspecto.tamano,
  },
});

/** Los nombres del agua, de las vías, de los puntos de interés y de los barrios. */
const capasDeNombres = (
  fuente: string,
  color: ColorDeToken,
): ReadonlyArray<SymbolLayerSpecification> => [
  {
    ...aLoLargo(
      "nombres-de-rios",
      fuente,
      "hidrografia_lin",
      12,
      ["==", ["get", "clase"], "curso_natural"],
      { letra: LETRA_CURSIVA, tamano: 11.5 },
    ),
    paint: { "text-color": tinta(color, color("mapa-rotulo-agua")), ...halo(color, 1.2) },
  },
  {
    id: "nombres-de-mares",
    type: "symbol",
    source: fuente,
    "source-layer": "contexto_nombre_hidrografia_pol",
    filter: deClase("mar", "golfo_bahia"),
    layout: {
      "text-field": ["get", "nombre"],
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
    "source-layer": "lamina_agua_pol",
    minzoom: 10,
    filter: ["all", CON_NOMBRE, deClase("embalse", "lago")],
    layout: {
      "text-field": ["get", "nombre"],
      "text-font": [LETRA_CURSIVA],
      "text-size": 11.5,
      "text-max-width": 7,
    },
    paint: { "text-color": tinta(color, color("mapa-rotulo-agua")), ...halo(color, 1) },
  },
  {
    ...aLoLargo(
      "nombres-de-calles",
      fuente,
      "via_urbana_lin",
      15,
      ["all", EN_USO, ["!", ES_AVENIDA]],
      {
        letra: LETRA,
        tamano: porZoom(15, 11, 18, 13.5),
      },
    ),
    paint: { "text-color": tinta(color, color("mapa-rotulo-calle")), ...halo(color, 1.6) },
  },
  {
    ...aLoLargo("nombres-de-avenidas", fuente, "via_urbana_lin", 13, ["all", EN_USO, ES_AVENIDA], {
      letra: LETRA,
      tamano: porZoom(13, 11, 15, 12, 18, 14.5),
    }),
    paint: { "text-color": tinta(color, color("mapa-rotulo-ciudad")), ...halo(color, 1.8) },
  },
  // El número de las autopistas y las autovías (A-2, AP-7), sobre su propio amarillo.
  ...["autopista_lin", "autovia_lin"].map((capa): SymbolLayerSpecification => ({
    id: `numeros-de-carreteras-${capa}`,
    type: "symbol",
    source: fuente,
    "source-layer": capa,
    minzoom: 7,
    maxzoom: 14,
    filter: [
      "all",
      EN_USO,
      ["!=", ["coalesce", ["get", "ref"], ""], ""],
      ["<=", ["length", ["to-string", ["get", "ref"]]], 7],
    ],
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
      // Sobre la foto, el amarillo es el mismo en los dos temas y el número va en tinta oscura.
      "text-color": conFoto(color("mapa-rotulo-carretera"), color("mapa-foto-tinta")),
      "text-halo-color": conFoto(color("mapa-autopista"), color("mapa-foto-autopista")),
      "text-halo-width": 2.6,
    },
  })),
  // Pocos puntos de interés, como en el principal: estaciones, hospitales, ayuntamientos, museos
  // y parques.
  ...(
    [
      [
        "estaciones",
        "estacion_ferrocarril_pto",
        deClase("estacion_ferrocarril"),
        "mapa-pdi-transporte",
      ],
      ["salud", "servicio_instalacion_pto", deClase("instalacion_sanitaria"), "mapa-pdi-salud"],
      ["servicios", "servicio_instalacion_pto", deClase("ayuntamiento", "museo"), "mapa-pdi-otro"],
      ["parques", "zona_verde_pol", deClase("parque_jardin"), "mapa-pdi-parque"],
    ] as const satisfies ReadonlyArray<
      readonly [string, string, ExpressionSpecification, TokenMapa]
    >
  ).map(([id, capa, filtro, token]): SymbolLayerSpecification => ({
    id: `puntos-de-interes-${id}`,
    type: "symbol",
    source: fuente,
    "source-layer": capa,
    minzoom: 14,
    filter: ["all", CON_NOMBRE, filtro],
    layout: {
      "text-field": ["get", "nombre"],
      "text-font": [LETRA],
      "text-size": 11,
      "text-max-width": 8,
      "text-padding": 6,
    },
    paint: {
      "text-color": tinta(color, color(token)),
      ...halo(color, 1.4),
      "text-opacity": porZoom(14.5, 0, 15, 1),
    },
  })),
  {
    // Los aeropuertos con código OACI; el IGN no da el IATA.
    id: "aeropuertos",
    type: "symbol",
    source: fuente,
    "source-layer": "aerodromo_pol",
    minzoom: 9,
    filter: [
      "all",
      CON_NOMBRE,
      ["==", CLASE, "aerodromo"],
      ["in", "ICAO:", ["to-string", ["get", "ref"]]],
    ],
    layout: {
      "text-field": ["get", "nombre"],
      "text-font": [LETRA],
      "text-size": 11,
      "text-max-width": 8,
    },
    paint: { "text-color": tinta(color, color("mapa-pdi-transporte")), ...halo(color, 1.4) },
  },
  {
    // Como en el principal, desde el 14: del 13 al 14 los barrios de Barcelona son zonas de Celda.
    id: "barrios",
    type: "symbol",
    source: fuente,
    "source-layer": "nombre_poblacion_construccion_pto",
    minzoom: 14,
    filter: ["all", ["==", CLASE, "barrio"], CON_NOMBRE, SE_ROTULA],
    layout: {
      "text-field": textoDeRotulo(NOMBRE_DEL_IGN),
      "text-font": [LETRA],
      "text-size": porZoom(14, 11.5, 17, 13),
      "text-max-width": 7,
    },
    paint: { "text-color": tinta(color, color("mapa-rotulo-barrio")), ...halo(color, 1.5) },
  },
];

/**
 * Los números de portal de CartoCiudad, solo con la foto aérea y con el mismo filtro que en el
 * principal. La capa se llama igual, porque «Ver el edificio» la busca; el IGN da el número en
 * `ref`.
 */
const capaDePortales = (fuente: string, color: ColorDeToken): SymbolLayerSpecification => ({
  id: CAPA_PORTALES,
  type: "symbol",
  source: fuente,
  "source-layer": "portal_pto",
  minzoom: 15,
  filter: soloConFoto,
  layout: {
    "text-field": ["get", "ref"],
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
 * Las capas de rótulos de reserva, de abajo arriba, como las del principal: los nombres, los
 * números de portal, lo que tenga que ir `sobreLosPortales` y los lugares, de menos a más
 * importantes, con los huecos de los marcadores antes de las ciudades (ADR 0024).
 */
export const capasRotulosDeReserva = (
  fuente: string,
  color: ColorDeToken,
  sobreLosPortales: ReadonlyArray<LayerSpecification> = [],
): ReadonlyArray<LayerSpecification> => [
  ...capasDeNombres(fuente, color),
  capaDePortales(fuente, color),
  ...sobreLosPortales,
  ...LUGARES.flatMap((capa) => [
    ...(capa.id === CAPAS_DE_CIUDADES_DE_RESERVA.at(-1) ? [capaHuecos()] : []),
    capaDeLugares(fuente, color, capa),
  ]),
];
