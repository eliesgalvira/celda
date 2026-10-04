import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

import { conFoto, ocultaConFoto, porZoom } from "../expresiones.ts";
import { BORDE, CLASES_DE_VIAS, valorEnZoom } from "../vias.ts";
import type { ColorDeToken } from "../tokens.ts";

/**
 * Las vías del mapa base de reserva. El IGN pone cada clase de vía en su propia capa de la tesela,
 * así que van en una capa del estilo por clase, con el grosor, el color y el borde de la clase de
 * OpenMapTiles que les toca en el principal (`CLASES_DE_VIAS`): si el principal cambia, la reserva
 * lo sigue. Las calles del IGN no tienen jerarquía y salen desde el zoom 13; las avenidas se
 * reconocen por el nombre, que el IGN escribe en castellano.
 */

/** Las vías en uso: sin las que están en obras o fuera de servicio. */
export const EN_USO: ExpressionSpecification = [
  "!",
  ["in", ["get", "estado"], ["literal", ["en_construcción", "fuera_de_servicio"]]],
];

/** El nombre de una vía del IGN. */
const NOMBRE: ExpressionSpecification = ["to-string", ["get", "nombre"]];

/**
 * Las calles que se pintan como avenidas: «Avenida Diagonal», «Gran Via de les Corts Catalanes»,
 * «Paseo Gracia». Se adivina por el nombre, y alguna avenida de barrio sale más ancha de lo que es.
 */
export const ES_AVENIDA: ExpressionSpecification = [
  "any",
  ...["Avenida ", "Gran Via ", "Gran Vía ", "Paseo ", "Rambla ", "Ronda ", "Bulevar "].map(
    (prefijo): ExpressionSpecification => ["==", ["index-of", prefijo, NOMBRE], 0],
  ),
];

/** Una capa de vías del IGN y la clase del principal con que se pinta. */
interface ViaDelIgn {
  readonly id: string;
  readonly capa: string;
  readonly clase: string;
  readonly filtro?: ExpressionSpecification;
}

/** De la menos importante a la más, como en el principal: así un cruce no se corta con un borde. */
const VIAS_DEL_IGN: ReadonlyArray<ViaDelIgn> = (
  [
    { id: "servicio", capa: "via_servicio_lin", clase: "service" },
    { id: "calles", capa: "via_urbana_lin", clase: "minor", filtro: ["!", ES_AVENIDA] },
    { id: "otras", capa: "carretera_otros_lin", clase: "minor" },
    { id: "locales", capa: "carretera_autonomica_3er_nivel_lin", clase: "tertiary" },
    { id: "comarcales", capa: "carretera_autonomica_2do_nivel_lin", clase: "secondary" },
    { id: "avenidas", capa: "via_urbana_lin", clase: "secondary", filtro: ES_AVENIDA },
    { id: "autonomicas", capa: "carretera_autonomica_1er_nivel_lin", clase: "primary" },
    { id: "nacionales", capa: "carretera_general_lin", clase: "primary" },
    { id: "autovias", capa: "autovia_lin", clase: "trunk" },
    { id: "autopistas", capa: "autopista_lin", clase: "motorway" },
  ] satisfies ReadonlyArray<ViaDelIgn>
).toSorted(
  (a, b) =>
    CLASES_DE_VIAS.findIndex((via) => via.clase === a.clase) -
    CLASES_DE_VIAS.findIndex((via) => via.clase === b.clase),
);

const REDONDO = { "line-cap": "round", "line-join": "round" } as const;

/**
 * Un valor que cambia con el zoom y con la foto aérea: en cada parada de los dos, el de cada uno.
 * Los dos se interpolan igual, con `base`.
 */
const porZoomYFoto = (
  base: number,
  sinFoto: ReadonlyArray<number>,
  conFotoEncendida: ReadonlyArray<number>,
): ExpressionSpecification => {
  const zooms = (pares: ReadonlyArray<number>) => pares.filter((_, k) => k % 2 === 0);
  const paradas = [...new Set([...zooms(sinFoto), ...zooms(conFotoEncendida)])].toSorted(
    (a, b) => a - b,
  );
  const redondo = (valor: number) => Math.round(valor * 100) / 100;
  return [
    "interpolate",
    base === 1 ? ["linear"] : ["exponential", base],
    ["zoom"],
    ...paradas.flatMap((zoom) => [
      zoom,
      conFoto(
        redondo(valorEnZoom(sinFoto, zoom, base)),
        redondo(valorEnZoom(conFotoEncendida, zoom, base)),
      ),
    ]),
  ];
};

/** El filtro de una vía: en uso y, si lo tiene, el suyo. */
const filtroDe = (via: ViaDelIgn): ExpressionSpecification =>
  via.filtro === undefined ? EN_USO : ["all", EN_USO, via.filtro];

/**
 * Las capas de las vías de reserva: el tren y los caminos, todos los bordes debajo y los rellenos
 * encima. Con la foto aérea los bordes se esconden y los rellenos pasan a la línea fina y clara de
 * cada clase sobre la foto, en la misma capa.
 */
export const capasViasDeReserva = (
  fuente: string,
  color: ColorDeToken,
): ReadonlyArray<LayerSpecification> => {
  const conClase = VIAS_DEL_IGN.flatMap((via) => {
    const clase = CLASES_DE_VIAS.find((una) => una.clase === via.clase);
    return clase === undefined ? [] : [{ via, clase }];
  });
  return [
    {
      id: "tren",
      type: "line",
      source: fuente,
      "source-layer": "ferrocarril_lin",
      minzoom: 9,
      filter: ["all", EN_USO, ["==", ["get", "clase"], "tren"], ["!=", ["get", "tunel"], "T"]],
      paint: {
        "line-color": conFoto(color("mapa-tren"), color("mapa-foto-linea")),
        "line-width": porZoom(9, 0.6, 14, 1.2, 18, 2),
        "line-opacity": conFoto(1, 0.45),
      },
    },
    ...["camino_lin", "senda_lin"].map((capa): LayerSpecification => ({
      id: `caminos-${capa}`,
      type: "line",
      source: fuente,
      "source-layer": capa,
      minzoom: 14,
      paint: {
        "line-color": conFoto(color("mapa-camino"), color("mapa-foto-linea")),
        "line-width": porZoom(14, 0.6, 18, 1.6),
        "line-dasharray": [2, 1.5],
        "line-opacity": porZoom(14, 0, 14.6, conFoto(1, 0.35)),
      },
    })),
    ...conClase.map(({ via, clase }): LayerSpecification => ({
      id: `vias-borde-${via.id}`,
      type: "line",
      source: fuente,
      "source-layer": via.capa,
      minzoom: clase.desde,
      filter: filtroDe(via),
      layout: { ...REDONDO, visibility: ocultaConFoto },
      paint: {
        "line-color": color(clase.borde),
        "line-width": [
          "interpolate",
          ["exponential", 1.5],
          ["zoom"],
          ...clase.grosor.map((valor, k) => (k % 2 === 0 ? valor : valor + BORDE)),
        ],
        "line-opacity": Number.isFinite(clase.bordeDesde)
          ? porZoom(clase.bordeDesde, 0, clase.bordeDesde + 1, 1)
          : 0,
      },
    })),
    ...conClase.map(({ via, clase }): LayerSpecification => ({
      id: `vias-${via.id}`,
      type: "line",
      source: fuente,
      "source-layer": via.capa,
      minzoom: clase.desde,
      filter: filtroDe(via),
      layout: REDONDO,
      paint: {
        "line-color": conFoto(color(clase.relleno), color(clase.sobreLaFoto.color)),
        "line-width": porZoomYFoto(1.5, clase.grosor, clase.sobreLaFoto.grosor),
        "line-opacity": porZoomYFoto(
          1,
          [clase.sobreLaFoto.opacidad[0] ?? 0, 1],
          clase.sobreLaFoto.opacidad,
        ),
      },
    })),
  ];
};
