import type { LayerSpecification, LineLayerSpecification } from "maplibre-gl";

import { alAcercar, deClase, porZoom } from "./expresiones.ts";
import type { ColorDeToken, TokenMapa } from "./tokens.ts";

/**
 * Las vías del mapa base por clase, como en Google Maps: cada clase con su color, su grosor y
 * el zoom desde el que sale. Las autopistas y las autovías, en amarillo, se ven desde lejos y
 * dejan seguir una carretera hasta una ciudad; las demás van en blanco y las distingue el grosor
 * y el borde. Todo de la capa `transportation` de OpenMapTiles.
 */

/** Grosor del relleno de cada clase, en píxeles: pares de zoom y grosor. */
const GROSOR = {
  autopista: [5, 0.45, 7, 0.8, 9, 1.4, 10, 2, 13, 4.5, 16, 10, 18.5, 26],
  autovia: [5, 0.3, 7, 0.6, 9, 1.1, 10, 1.6, 13, 4, 16, 9, 18.5, 22],
  principal: [7, 0.5, 9, 1, 12, 2.4, 16, 8, 18.5, 20],
  secundaria: [9, 0.4, 12, 1.6, 16, 7, 18.5, 18],
  terciaria: [11, 0.4, 13, 1.4, 16, 6, 18.5, 16],
  calle: [12, 0.4, 14, 1.4, 16, 4.5, 18.5, 13],
  servicio: [14, 0.5, 16, 2, 18.5, 7],
} as const satisfies Record<string, ReadonlyArray<number>>;

/** Lo que el borde sobresale del relleno, sumando los dos lados, en píxeles. */
const BORDE = 1.6;

/** El grosor del borde: el del relleno más `BORDE` en cada parada. */
const conBorde = (pares: ReadonlyArray<number>): Array<number> =>
  pares.map((valor, k) => (k % 2 === 0 ? valor : valor + BORDE));

const REDONDO = { "line-cap": "round", "line-join": "round" } as const;

/** Una clase de vía con su relleno y su borde. */
interface ClaseDeVia {
  readonly id: string;
  readonly clases: ReadonlyArray<string>;
  /** El zoom desde el que sale. */
  readonly desde: number;
  readonly grosor: ReadonlyArray<number>;
  readonly relleno: TokenMapa;
  readonly borde: TokenMapa;
  /** El zoom desde el que se ve el borde: de lejos una vía es solo su relleno. */
  readonly bordeDesde: number;
}

/** De la menos importante a la más: así una autopista se pinta encima de la calle que cruza. */
const CLASES: ReadonlyArray<ClaseDeVia> = [
  {
    id: "servicio",
    clases: ["service"],
    desde: 14,
    grosor: GROSOR.servicio,
    relleno: "mapa-calle",
    borde: "mapa-calle-borde",
    bordeDesde: 15,
  },
  {
    id: "calles",
    clases: ["minor"],
    desde: 12,
    grosor: GROSOR.calle,
    relleno: "mapa-calle",
    borde: "mapa-calle-borde",
    bordeDesde: 14,
  },
  {
    id: "terciarias",
    clases: ["tertiary"],
    desde: 11,
    grosor: GROSOR.terciaria,
    relleno: "mapa-calle",
    borde: "mapa-secundaria-borde",
    bordeDesde: 12,
  },
  {
    id: "secundarias",
    clases: ["secondary"],
    desde: 9,
    grosor: GROSOR.secundaria,
    relleno: "mapa-calle",
    borde: "mapa-secundaria-borde",
    bordeDesde: 11,
  },
  {
    id: "principales",
    clases: ["primary"],
    desde: 7,
    grosor: GROSOR.principal,
    relleno: "mapa-calle",
    borde: "mapa-principal-borde",
    bordeDesde: 10,
  },
  {
    id: "autovias",
    clases: ["trunk"],
    desde: 5,
    grosor: GROSOR.autovia,
    relleno: "mapa-autovia",
    borde: "mapa-autovia-borde",
    bordeDesde: 8.5,
  },
  {
    id: "autopistas",
    clases: ["motorway"],
    desde: 4,
    grosor: GROSOR.autopista,
    relleno: "mapa-autopista",
    borde: "mapa-autopista-borde",
    bordeDesde: 8,
  },
];

const borde = (fuente: string, color: ColorDeToken, via: ClaseDeVia): LineLayerSpecification => ({
  id: `${via.id}-borde`,
  type: "line",
  source: fuente,
  "source-layer": "transportation",
  minzoom: via.desde,
  filter: deClase(...via.clases),
  layout: REDONDO,
  paint: {
    "line-color": color(via.borde),
    "line-width": alAcercar(...conBorde(via.grosor)),
    "line-opacity": porZoom(via.bordeDesde, 0, via.bordeDesde + 1, 1),
  },
});

const relleno = (fuente: string, color: ColorDeToken, via: ClaseDeVia): LineLayerSpecification => ({
  id: via.id,
  type: "line",
  source: fuente,
  "source-layer": "transportation",
  minzoom: via.desde,
  filter: deClase(...via.clases),
  layout: REDONDO,
  paint: { "line-color": color(via.relleno), "line-width": alAcercar(...via.grosor) },
});

/**
 * Las capas de las vías: el tren y los caminos, todos los bordes debajo y los rellenos de la
 * menos importante a la más, para que los cruces no se corten con un borde.
 */
export const capasVias = (
  fuente: string,
  color: ColorDeToken,
): ReadonlyArray<LayerSpecification> => [
  {
    id: "tren",
    type: "line",
    source: fuente,
    "source-layer": "transportation",
    minzoom: 9,
    filter: ["all", deClase("rail"), ["!=", ["get", "brunnel"], "tunnel"]],
    paint: { "line-color": color("mapa-tren"), "line-width": porZoom(9, 0.6, 14, 1.2, 18, 2) },
  },
  {
    id: "caminos",
    type: "line",
    source: fuente,
    "source-layer": "transportation",
    minzoom: 14,
    filter: ["all", deClase("path", "track"), ["!=", ["get", "subclass"], "pedestrian"]],
    paint: {
      "line-color": color("mapa-camino"),
      "line-width": porZoom(14, 0.6, 18, 1.6),
      "line-dasharray": [2, 1.5],
      "line-opacity": porZoom(14, 0, 14.6, 1),
    },
  },
  ...CLASES.map((via) => borde(fuente, color, via)),
  {
    // Las calles peatonales llegan como caminos (`path`): se pintan como calles, sin borde.
    id: "peatonales",
    type: "line",
    source: fuente,
    "source-layer": "transportation",
    minzoom: 14,
    filter: ["all", deClase("path"), ["==", ["get", "subclass"], "pedestrian"]],
    layout: REDONDO,
    paint: {
      "line-color": color("mapa-calle"),
      "line-width": alAcercar(...GROSOR.servicio),
      "line-opacity": porZoom(14, 0, 14.6, 1),
    },
  },
  ...CLASES.map((via) => relleno(fuente, color, via)),
];
