import type { LimitesDeComunidadesYProvincias } from "@celda/dominio/limites";
import type { ExpressionSpecification, FilterSpecification, LayerSpecification } from "maplibre-gl";

import { porZoom } from "./expresiones.ts";
import type { ColorDeToken } from "./tokens.ts";

/**
 * Los límites del mapa (ADR 0023), para que ningún zoom se quede sin ellos: el país y, de cerca,
 * los municipios salen del mapa base; las comunidades autónomas y las provincias, de un fichero
 * propio sacado de los límites del IGN (`apps/web/src/mapa/limites.json`), que la web pone en
 * `FUENTE_LIMITES` después del primer pintado. A 1 km de tolerancia, de cerca la línea se separa
 * del límite real, así que desde el zoom 11 ceden el sitio a los municipales.
 */

/** La fuente GeoJSON de las comunidades y las provincias, vacía hasta que llega el fichero. */
export const FUENTE_LIMITES = "limites";

/** Qué separa una línea de `FUENTE_LIMITES`: dos comunidades o dos provincias de la misma. */
export type TipoDeLimite = "comunidad" | "provincia";

/** Una línea de `FUENTE_LIMITES`, con su tipo en `limite`. */
export interface LineaDeLimite {
  readonly type: "Feature";
  readonly properties: { readonly limite: TipoDeLimite };
  readonly geometry: {
    readonly type: "LineString";
    readonly coordinates: ReadonlyArray<readonly [number, number]>;
  };
}

/** Lo que va en `FUENTE_LIMITES`. */
export interface LineasDeLimites {
  readonly type: "FeatureCollection";
  readonly features: ReadonlyArray<LineaDeLimite>;
}

/** Las líneas del fichero de límites, en grados, cada una con su tipo. */
export const lineasDeLimites = (limites: LimitesDeComunidadesYProvincias): LineasDeLimites => {
  const lineas = (de: ReadonlyArray<ReadonlyArray<number>>, limite: TipoDeLimite) =>
    de.map((linea): LineaDeLimite => {
      const coordinates: Array<readonly [number, number]> = [];
      let x = 0;
      let y = 0;
      for (let k = 0; k + 1 < linea.length; k += 2) {
        x += linea[k] ?? 0;
        y += linea[k + 1] ?? 0;
        coordinates.push([x / limites.unidadesPorGrado, y / limites.unidadesPorGrado]);
      }
      return {
        type: "Feature",
        properties: { limite },
        geometry: { type: "LineString", coordinates },
      };
    });
  return {
    type: "FeatureCollection",
    features: [
      ...lineas(limites.provincias, "provincia"),
      ...lineas(limites.comunidades, "comunidad"),
    ],
  };
};

/** Las líneas de un nivel de `boundary` de OpenMapTiles, sin las del mar. */
const deNivel = (
  nivel: number,
  ...mas: ReadonlyArray<ExpressionSpecification>
): FilterSpecification => [
  "all",
  ["==", ["get", "admin_level"], nivel],
  ["!=", ["get", "maritime"], 1],
  ...mas,
];

const deTipo = (tipo: TipoDeLimite): FilterSpecification => ["==", ["get", "limite"], tipo];

/**
 * Comunidades y provincias, enteras hasta el zoom 11,5 y al 60 % desde el 12,5: entonces ya se
 * ven los municipios, que van a su escala.
 */
const OPACIDAD_PROPIA = porZoom(11.5, 1, 12.5, 0.6);

/**
 * Las capas de los límites, de abajo arriba: municipios, provincias, comunidades y país. Van entre
 * el suelo y las vías. Los municipios, discontinuos, entran del zoom 10,5 al 11,2; las provincias
 * son finas y discontinuas, y las comunidades, más gruesas y continuas.
 */
export const capasLimites = (
  fuente: string,
  color: ColorDeToken,
): ReadonlyArray<LayerSpecification> => [
  {
    id: "limites-municipios",
    type: "line",
    source: fuente,
    "source-layer": "boundary",
    minzoom: 10.5,
    filter: deNivel(8),
    layout: { "line-join": "round" },
    paint: {
      "line-color": color("mapa-limite-municipio"),
      "line-width": porZoom(11, 0.6, 16, 1.2),
      "line-dasharray": [3, 2],
      "line-opacity": porZoom(10.5, 0, 11.2, 1),
    },
  },
  {
    id: "limites-provincias",
    type: "line",
    source: FUENTE_LIMITES,
    filter: deTipo("provincia"),
    layout: { "line-join": "round" },
    paint: {
      "line-color": color("mapa-limite-provincia"),
      "line-width": porZoom(4, 0.6, 9, 1.1, 14, 1.6),
      "line-dasharray": [4, 2],
      "line-opacity": OPACIDAD_PROPIA,
    },
  },
  {
    id: "limites-comunidades",
    type: "line",
    source: FUENTE_LIMITES,
    filter: deTipo("comunidad"),
    layout: { "line-join": "round" },
    paint: {
      "line-color": color("mapa-limite-comunidad"),
      "line-width": porZoom(4, 1, 9, 1.8, 14, 2.4),
      "line-opacity": OPACIDAD_PROPIA,
    },
  },
  {
    id: "limites-pais",
    type: "line",
    source: fuente,
    "source-layer": "boundary",
    filter: deNivel(2, ["!=", ["get", "disputed"], 1]),
    layout: { "line-join": "round" },
    paint: {
      "line-color": color("mapa-limite-pais"),
      "line-width": porZoom(4, 1, 8, 1.8, 14, 2.6),
    },
  },
];
