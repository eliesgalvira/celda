import type { LimitesDeComunidadesYProvincias } from "@celda/dominio/limites";
import type { ExpressionSpecification, FilterSpecification, LayerSpecification } from "maplibre-gl";

import { conFoto, porZoom } from "./expresiones.ts";
import type { ColorDeToken } from "./tokens.ts";

/**
 * Los límites del mapa (ADR 0023), para que ningún zoom se quede sin ellos. La frontera terrestre
 * de España, las comunidades autónomas y las provincias salen de un fichero propio sacado de los
 * límites del IGN (`apps/web/src/mapa/limites.json`, a 1 km), que la web pone en `FUENTE_LIMITES`
 * al arrancar y cambia por el de detalle (`limites-detalle.json`, a 150 m) la primera vez que el
 * mapa pasa del zoom 7. Desde el 12,5 comunidades y provincias bajan al 60 % y mandan los
 * municipales. Las fronteras entre otros países y, de cerca, los municipios salen del mapa base.
 */

/** La fuente GeoJSON de las comunidades y las provincias, vacía hasta que llega el fichero. */
export const FUENTE_LIMITES = "limites";

/**
 * Qué separa una línea de `FUENTE_LIMITES`: España de otro país por tierra, dos comunidades o dos
 * provincias de la misma.
 */
export type TipoDeLimite = "pais" | "comunidad" | "provincia";

/** Una línea de `FUENTE_LIMITES`, con su tipo en `limite`. */
export interface LineaDeLimite {
  readonly type: "Feature";
  readonly properties: { readonly limite: TipoDeLimite };
  readonly geometry: {
    readonly type: "LineString";
    readonly coordinates: Array<[number, number]>;
  };
}

/** Lo que va en `FUENTE_LIMITES`. */
export interface LineasDeLimites {
  readonly type: "FeatureCollection";
  readonly features: Array<LineaDeLimite>;
}

/** Las líneas del fichero de límites, en grados, cada una con su tipo. */
export const lineasDeLimites = (limites: LimitesDeComunidadesYProvincias): LineasDeLimites => {
  const lineas = (de: ReadonlyArray<ReadonlyArray<number>>, limite: TipoDeLimite) =>
    de.map((linea): LineaDeLimite => {
      const coordinates: Array<[number, number]> = [];
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
      ...lineas(limites.pais, "pais"),
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

/** El código de España en `adm0_l` y `adm0_r` de OpenMapTiles. */
const ESPANA = "ESP";

/** Cómo se pinta una frontera, la de España y las de los demás. */
const pinturaDePais = (color: ColorDeToken) => ({
  "line-color": conFoto(color("mapa-limite-pais"), color("mapa-foto-linea")),
  "line-width": porZoom(4, 1, 8, 1.8, 14, 2.6),
});

/**
 * Comunidades y provincias, enteras hasta el zoom 11,5 y al 60 % desde el 12,5: entonces ya se
 * ven los municipios, que van a su escala. Sobre la foto aérea van en blanco, algo translúcidas
 * para no tapar la foto: las comunidades al 95 % y al 70 %, y las provincias al 80 % y al 55 %.
 * El prototipo las ponía al 85 % y al 60 %, y sobre la foto de una ciudad apenas se leían.
 */
const opacidadPropia = (conLaFoto: number, conLaFotoDeCerca: number) =>
  porZoom(11.5, conFoto(1, conLaFoto), 12.5, conFoto(0.6, conLaFotoDeCerca));

/**
 * Las capas de los límites, de abajo arriba: municipios, provincias, comunidades y países. Van
 * entre el suelo y las vías. Los municipios, discontinuos, entran del zoom 10,5 al 11,2; las
 * provincias son finas y discontinuas, y las comunidades, más gruesas y continuas. Con la foto
 * aérea encendida, todas van en blanco (`--mapa-foto-linea`).
 *
 * La frontera de España (`limites-pais`) sale del fichero propio y no del mapa base: en las
 * teselas de OpenFreeMap el Guadiana de Olivenza viene como disputado y la frontera de Melilla y
 * parte de la del Bidasoa y la de Ceuta como marítimas, y esas líneas no se pintan (05/10/2026).
 * Del mapa base solo quedan las fronteras entre otros países (`limites-paises`): se quitan las que
 * tocan España, que llevan `adm0_l` o `adm0_r` desde el zoom 5. En el 4 no llevan ninguno y las
 * dos se pintan juntas, a menos de un píxel.
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
      "line-color": conFoto(color("mapa-limite-municipio"), color("mapa-foto-linea")),
      "line-width": porZoom(11, 0.6, 16, 1.2),
      "line-dasharray": [3, 2],
      "line-opacity": porZoom(10.5, 0, 11.2, conFoto(1, 0.7)),
    },
  },
  {
    id: "limites-provincias",
    type: "line",
    source: FUENTE_LIMITES,
    filter: deTipo("provincia"),
    layout: { "line-join": "round" },
    paint: {
      "line-color": conFoto(color("mapa-limite-provincia"), color("mapa-foto-linea")),
      "line-width": porZoom(4, 0.6, 9, 1.1, 14, 1.6),
      "line-dasharray": [4, 2],
      "line-opacity": opacidadPropia(0.8, 0.55),
    },
  },
  {
    id: "limites-comunidades",
    type: "line",
    source: FUENTE_LIMITES,
    filter: deTipo("comunidad"),
    layout: { "line-join": "round" },
    paint: {
      "line-color": conFoto(color("mapa-limite-comunidad"), color("mapa-foto-linea")),
      "line-width": porZoom(4, 1, 9, 1.8, 14, 2.4),
      "line-opacity": opacidadPropia(0.95, 0.7),
    },
  },
  {
    id: "limites-paises",
    type: "line",
    source: fuente,
    "source-layer": "boundary",
    filter: deNivel(
      2,
      ["!=", ["get", "disputed"], 1],
      ["!=", ["get", "adm0_l"], ESPANA],
      ["!=", ["get", "adm0_r"], ESPANA],
    ),
    layout: { "line-join": "round" },
    paint: pinturaDePais(color),
  },
  {
    id: "limites-pais",
    type: "line",
    source: FUENTE_LIMITES,
    filter: deTipo("pais"),
    layout: { "line-join": "round" },
    paint: pinturaDePais(color),
  },
];
