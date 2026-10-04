import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

import { conFoto, porZoom } from "../expresiones.ts";
import { CAPA_EDIFICIOS } from "../suelo.ts";
import type { ColorDeToken, TokenMapa } from "../tokens.ts";

/**
 * El suelo del mapa base de reserva, sobre las teselas del IGN, con los colores y las opacidades
 * del principal (`../suelo.ts`). El IGN no tiene polígonos de mar: el fondo es el agua y encima va
 * la tierra, la de España por comunidades y la de fuera hasta el zoom 12. A partir del 13 el IGN
 * no trae nada de fuera, y Francia, Portugal o Marruecos se ven como mar.
 */

/** Un valor de un atributo `clase` del IGN, de entre estas. */
const deClase = (...clases: ReadonlyArray<string>): ExpressionSpecification => [
  "in",
  ["get", "clase"],
  ["literal", clases],
];

/** El filtro que no quita nada. */
const SIN_FILTRO: ExpressionSpecification = ["all"];

/** Un relleno de una capa del IGN con un color del tema. */
const relleno = (
  id: string,
  fuente: string,
  capa: string,
  color: string,
  opciones: {
    readonly filtro?: ExpressionSpecification;
    readonly opacidad?: number | ExpressionSpecification;
    readonly desde?: number;
    readonly hasta?: number;
  } = {},
): LayerSpecification => ({
  id,
  type: "fill",
  source: fuente,
  "source-layer": capa,
  minzoom: opciones.desde ?? 0,
  maxzoom: opciones.hasta ?? 24,
  filter: opciones.filtro ?? SIN_FILTRO,
  paint: { "fill-color": color, "fill-opacity": opciones.opacidad ?? 1 },
});

/** Las zonas urbanas, como `usos` del principal: más tenues al acercar, bajo las manzanas. */
const OPACIDAD_URBANA = porZoom(10, 1, 12, 0.88, 13, 0.82, 15, 0.7);

/** Los usos que se tiñen de cerca, desde el zoom 12, como en el principal. */
const USOS: ReadonlyArray<readonly [capa: string, clases: ReadonlyArray<string>, TokenMapa]> = [
  ["zona_dotacional_pol", ["cementerio"], "mapa-cementerio"],
  ["instalacion_educativa_pol", ["instalacion_educativa"], "mapa-educacion"],
];

/** Las clases de `cubierta_vegetal_pol`, de cerca, con el verde que les toca. */
const VERDES_DE_CERCA: ReadonlyArray<readonly [ReadonlyArray<string>, TokenMapa]> = [
  [["bosque_coniferas", "bosque_frondosas", "bosque_mixto", "bosque_arbolado"], "mapa-bosque"],
  [["matorral", "pastizal_herbazal", "combinacion_vegetacion"], "mapa-hierba"],
  [["playa_duna_arenal"], "mapa-arena"],
];

/**
 * Las capas del suelo de reserva, de abajo arriba, como las del principal. `bajoElAgua` va entre la
 * tierra y el agua: la foto aérea.
 */
export const capasSueloDeReserva = (
  fuente: string,
  color: ColorDeToken,
  bajoElAgua: ReadonlyArray<LayerSpecification> = [],
): ReadonlyArray<LayerSpecification> => [
  { id: "fondo", type: "background", paint: { "background-color": color("mapa-agua") } },
  // La tierra de fuera de España, y de lejos también la de España. Llega hasta el zoom 12.
  relleno("tierra-fuera", fuente, "contexto_territorios_pol", color("mapa-fondo"), {
    filtro: ["==", ["get", "clase"], "tierra_firme"],
  }),
  // La de España, por comunidades, desde el 5 y a cualquier zoom.
  relleno("tierra", fuente, "comunidad_autonoma_pol", color("mapa-fondo"), { desde: 5 }),
  relleno("nucleos", fuente, "nucleo_urbano_pol", color("mapa-urbano"), {
    opacidad: OPACIDAD_URBANA,
  }),
  relleno("industria", fuente, "zona_industrial_pol", color("mapa-urbano"), {
    opacidad: OPACIDAD_URBANA,
  }),
  // Las manzanas de CartoCiudad: lo único que dibuja la ciudad entre el 12 y el 13, sin calles.
  relleno("manzanas", fuente, "manzana_pol", color("mapa-urbano"), {
    opacidad: porZoom(12, 0.6, 14, 0.8, 16, 0.5),
  }),
  ...USOS.map(([capa, clases, token]) =>
    relleno(`usos-${capa}`, fuente, capa, color(token), {
      filtro: deClase(...clases),
      desde: 12,
      opacidad: porZoom(12, 0, 13, 1, 15, 0.9),
    }),
  ),
  // El bosque de lejos, que el IGN da hasta el 12; de cerca, la cubierta por clases.
  relleno("bosques", fuente, "cubierta_vegetal_bosque_pol", color("mapa-bosque"), {
    hasta: 13,
    opacidad: porZoom(5, 0.6, 10, 0.8),
  }),
  ...VERDES_DE_CERCA.map(([clases, token], indice) =>
    relleno(`verdes-${indice}`, fuente, "cubierta_vegetal_pol", color(token), {
      filtro: deClase(...clases),
      desde: 13,
      opacidad: token === "mapa-bosque" ? 0.88 : 0.8,
    }),
  ),
  relleno("espacios-naturales", fuente, "espacio_natural_protegido_pol", color("mapa-parque"), {
    filtro: deClase("parque_nacional", "parque_natural"),
    opacidad: porZoom(5, 0.35, 10, 0.3, 13, 0.15),
  }),
  relleno("parques", fuente, "zona_verde_pol", color("mapa-parque")),
  ...bajoElAgua,
  // Sobre la foto deja ver algo de la costa y los puertos, como en el principal.
  relleno("agua-lejos", fuente, "contexto_lamina_agua_pol", color("mapa-agua"), {
    hasta: 9,
    opacidad: conFoto(1, 0.88),
  }),
  relleno("agua", fuente, "lamina_agua_pol", color("mapa-agua"), {
    filtro: ["!", deClase("piscina", "abrevadero")],
    opacidad: conFoto(1, 0.88),
  }),
  relleno("cauces", fuente, "hidrografia_pol", color("mapa-agua"), {
    opacidad: conFoto(1, 0.88),
  }),
  {
    id: "rios",
    type: "line",
    source: fuente,
    "source-layer": "hidrografia_lin",
    minzoom: 8,
    filter: [
      "all",
      ["==", ["get", "clase"], "curso_natural"],
      ["!=", ["get", "situacion"], "subterraneo"],
      ["in", ["get", "orden"], ["literal", ["primero", "segundo", "tercero_cuarto"]]],
    ],
    paint: { "line-color": color("mapa-agua"), "line-width": porZoom(8, 0.6, 12, 1.4, 16, 4) },
  },
  {
    id: "arroyos",
    type: "line",
    source: fuente,
    "source-layer": "hidrografia_lin",
    minzoom: 12,
    filter: [
      "all",
      ["!=", ["get", "situacion"], "subterraneo"],
      [
        "any",
        ["==", ["get", "clase"], "canal"],
        [
          "all",
          ["==", ["get", "clase"], "curso_natural"],
          ["!", ["in", ["get", "orden"], ["literal", ["primero", "segundo", "tercero_cuarto"]]]],
        ],
      ],
    ],
    paint: {
      "line-color": color("mapa-agua"),
      "line-width": porZoom(12, 0.3, 16, 1.6),
      "line-opacity": porZoom(12, 0, 13, 1),
    },
  },
  {
    // El mismo nombre que en el principal: «Ver el edificio» los busca aquí. El IGN los da desde
    // el 15; en el 14 se ven las manzanas.
    id: CAPA_EDIFICIOS,
    type: "fill",
    source: fuente,
    "source-layer": "edificio_pol",
    minzoom: 14,
    paint: {
      "fill-color": color("mapa-edificio"),
      "fill-outline-color": color("mapa-edificio-borde"),
      "fill-opacity": porZoom(14, 0, 15, conFoto(1, 0)),
    },
  },
];
