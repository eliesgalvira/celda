import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

import { conFoto, deClase, ocultaConFoto, porZoom, visibleConFoto } from "./expresiones.ts";
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

/**
 * Sobre la foto aérea las vías son líneas finas y claras, como en el modo híbrido de Google:
 * grosor y opacidad por clase, pares de zoom y valor, en línea recta.
 */
const SOBRE_LA_FOTO = {
  autopista: {
    grosor: [5, 0.7, 10, 1.6, 13, 2.4, 16, 3.5, 18.5, 7],
    opacidad: [5, 0.75, 16, 0.7, 18, 0.55],
  },
  principal: {
    grosor: [7, 0.5, 13, 1.4, 16, 2.6, 18.5, 5],
    opacidad: [7, 0.45, 16, 0.6, 18, 0.45],
  },
  secundaria: { grosor: [9, 0.4, 13, 1, 16, 2, 18.5, 4], opacidad: [9, 0.35, 16, 0.5, 18, 0.35] },
  calle: { grosor: [12, 0.3, 16, 1.4, 18.5, 3], opacidad: [12, 0, 13, 0.3, 16, 0.4, 18, 0.25] },
} as const satisfies Record<
  string,
  { readonly grosor: ReadonlyArray<number>; readonly opacidad: ReadonlyArray<number> }
>;

/** Lo que el borde sobresale del relleno, sumando los dos lados, en píxeles. */
export const BORDE = 1.6;

const REDONDO = { "line-cap": "round", "line-join": "round" } as const;

/** Una clase de vía con su relleno y su borde. */
interface ClaseDeVia {
  /** La `class` de OpenMapTiles. */
  readonly clase: string;
  /** El zoom desde el que sale: un entero, porque se filtra con el zoom de la tesela. */
  readonly desde: number;
  readonly grosor: ReadonlyArray<number>;
  readonly relleno: TokenMapa;
  readonly borde: TokenMapa;
  /** El zoom desde el que se ve el borde: de lejos una vía es solo su relleno. */
  readonly bordeDesde: number;
  /** Cómo se ve sobre la foto aérea: una línea fina, sin borde. */
  readonly sobreLaFoto: {
    readonly color: TokenMapa;
    readonly grosor: ReadonlyArray<number>;
    readonly opacidad: ReadonlyArray<number>;
  };
}

/**
 * De la menos importante a la más: así una autopista se pinta encima de la calle que cruza. Las
 * calles peatonales llegan como caminos (`path`) y van como una calle de servicio sin borde.
 */
export const CLASES_DE_VIAS: ReadonlyArray<ClaseDeVia> = [
  {
    clase: "path",
    desde: 14,
    grosor: GROSOR.servicio,
    relleno: "mapa-calle",
    borde: "mapa-calle-borde",
    bordeDesde: Infinity,
    sobreLaFoto: { color: "mapa-foto-linea", ...SOBRE_LA_FOTO.calle },
  },
  {
    clase: "service",
    desde: 14,
    grosor: GROSOR.servicio,
    relleno: "mapa-calle",
    borde: "mapa-calle-borde",
    bordeDesde: 15,
    sobreLaFoto: { color: "mapa-foto-linea", ...SOBRE_LA_FOTO.calle },
  },
  {
    clase: "minor",
    desde: 12,
    grosor: GROSOR.calle,
    relleno: "mapa-calle",
    borde: "mapa-calle-borde",
    bordeDesde: 14,
    sobreLaFoto: { color: "mapa-foto-linea", ...SOBRE_LA_FOTO.calle },
  },
  {
    clase: "tertiary",
    desde: 11,
    grosor: GROSOR.terciaria,
    relleno: "mapa-calle",
    borde: "mapa-secundaria-borde",
    bordeDesde: 12,
    sobreLaFoto: { color: "mapa-foto-linea", ...SOBRE_LA_FOTO.secundaria },
  },
  {
    clase: "secondary",
    desde: 9,
    grosor: GROSOR.secundaria,
    relleno: "mapa-calle",
    borde: "mapa-secundaria-borde",
    bordeDesde: 11,
    sobreLaFoto: { color: "mapa-foto-linea", ...SOBRE_LA_FOTO.secundaria },
  },
  {
    clase: "primary",
    desde: 7,
    grosor: GROSOR.principal,
    relleno: "mapa-calle",
    borde: "mapa-principal-borde",
    bordeDesde: 10,
    sobreLaFoto: { color: "mapa-foto-linea", ...SOBRE_LA_FOTO.principal },
  },
  {
    clase: "trunk",
    desde: 5,
    grosor: GROSOR.autovia,
    relleno: "mapa-autovia",
    borde: "mapa-autovia-borde",
    bordeDesde: 8.5,
    sobreLaFoto: { color: "mapa-foto-autopista", ...SOBRE_LA_FOTO.autopista },
  },
  {
    clase: "motorway",
    desde: 4,
    grosor: GROSOR.autopista,
    relleno: "mapa-autopista",
    borde: "mapa-autopista-borde",
    bordeDesde: 8,
    sobreLaFoto: { color: "mapa-foto-autopista", ...SOBRE_LA_FOTO.autopista },
  },
];

/**
 * El valor en `zoom` de una interpolación exponencial de pares de zoom y valor, como la calcula
 * MapLibre. Fuera de las paradas, el de la más cercana.
 */
export const valorEnZoom = (pares: ReadonlyArray<number>, zoom: number, base: number): number => {
  const n = pares.length / 2;
  if (zoom <= (pares[0] ?? 0)) return pares[1] ?? 0;
  for (let k = 1; k < n; k++) {
    const z1 = pares[2 * k] ?? 0;
    if (zoom > z1) continue;
    const z0 = pares[2 * k - 2] ?? 0;
    const v0 = pares[2 * k - 1] ?? 0;
    const v1 = pares[2 * k + 1] ?? 0;
    const t =
      base === 1 ? (zoom - z0) / (z1 - z0) : (base ** (zoom - z0) - 1) / (base ** (z1 - z0) - 1);
    return v0 + t * (v1 - v0);
  }
  return pares.at(-1) ?? 0;
};

/** Las paradas de zoom de todas las clases juntas, ordenadas y sin repetir. */
const paradas = (de: (via: ClaseDeVia) => ReadonlyArray<number>): Array<number> =>
  [...new Set(CLASES_DE_VIAS.flatMap((via) => de(via).filter((_, k) => k % 2 === 0)))].toSorted(
    (a, b) => a - b,
  );

/** Lo que puede dar un caso de un `match`. */
type Salida = string | number | boolean | ExpressionSpecification;

/** Un valor por clase de vía: el de su `class`, o el de por defecto. */
const porClase = (valor: (via: ClaseDeVia) => Salida, defecto: Salida): ExpressionSpecification => {
  const [primera, ...resto] = CLASES_DE_VIAS;
  return [
    "match",
    ["get", "class"],
    primera?.clase ?? "",
    primera === undefined ? defecto : valor(primera),
    ...resto.flatMap((via) => [via.clase, valor(via)]),
    defecto,
  ];
};

/**
 * Una propiedad que cambia con el zoom y con la clase: en cada parada de cualquier clase, el valor
 * de cada una. Solo en `vias-foto`, que solo existe con la foto encendida.
 */
const porZoomYClase = (
  base: number,
  pares: (via: ClaseDeVia) => ReadonlyArray<number>,
): ExpressionSpecification => [
  "interpolate",
  base === 1 ? ["linear"] : ["exponential", base],
  ["zoom"],
  ...paradas(pares).flatMap((zoom) => [
    zoom,
    porClase((via) => Math.round(valorEnZoom(pares(via), zoom, base) * 100) / 100, 0),
  ]),
];

/** El grosor del borde: el del relleno más `BORDE` en cada parada. */
const conBorde = (pares: ReadonlyArray<number>): Array<number> =>
  pares.map((valor, k) => (k % 2 === 0 ? valor : valor + BORDE));

/** El orden dentro de `vias-foto`: la clase más importante, encima. */
const ORDEN = porClase((via) => CLASES_DE_VIAS.indexOf(via), 0);

/** Las vías de una clase; las calles peatonales llegan como caminos (`path`) peatonales. */
const deLaClase = (via: ClaseDeVia): ExpressionSpecification =>
  via.clase === "path"
    ? ["all", ["==", ["get", "class"], "path"], ["==", ["get", "subclass"], "pedestrian"]]
    : ["==", ["get", "class"], via.clase];

/** Un grosor en píxeles que crece con el zoom como en Google: pares de zoom y grosor. */
const grosorPorZoom = (pares: ReadonlyArray<number>): ExpressionSpecification => [
  "interpolate",
  ["exponential", 1.5],
  ["zoom"],
  ...pares,
];

/** Las capas de una clase de vía: su borde, si lo tiene, y su relleno. */
interface CapasDeLaClase {
  readonly borde: ReadonlyArray<LayerSpecification>;
  readonly relleno: LayerSpecification;
}

/**
 * El borde y el relleno de una clase. Tienen el mismo filtro, la misma disposición y los mismos
 * zooms, así que MapLibre saca sus líneas del mismo cubo: cada tesela parte, manda al hilo
 * principal y sube a la GPU las vías una vez y no dos. Las calles peatonales no llevan borde.
 */
const capasDeLaClase = (fuente: string, color: ColorDeToken, via: ClaseDeVia): CapasDeLaClase => {
  const comun = {
    type: "line",
    source: fuente,
    "source-layer": "transportation",
    minzoom: via.desde,
    filter: deLaClase(via),
    layout: { ...REDONDO, visibility: ocultaConFoto },
  } as const;
  return {
    borde: Number.isFinite(via.bordeDesde)
      ? [
          {
            ...comun,
            id: `vias-borde-${via.clase}`,
            paint: {
              "line-color": color(via.borde),
              "line-width": grosorPorZoom(conBorde(via.grosor)),
              "line-opacity": porZoom(via.bordeDesde, 0, via.bordeDesde + 1, 1),
            },
          },
        ]
      : [],
    relleno: {
      ...comun,
      id: `vias-${via.clase}`,
      // Las peatonales entran en medio zoom, como los caminos.
      paint:
        via.clase === "path"
          ? {
              "line-color": color(via.relleno),
              "line-width": grosorPorZoom(via.grosor),
              "line-opacity": porZoom(14, 0, 14.6, 1),
            }
          : { "line-color": color(via.relleno), "line-width": grosorPorZoom(via.grosor) },
    },
  };
};

/** Las vías sobre la foto: todas las clases, cada una desde su zoom. */
const VIAS: ExpressionSpecification = [
  "all",
  ["any", ["!=", ["get", "class"], "path"], ["==", ["get", "subclass"], "pedestrian"]],
  porClase((via) => [">=", ["zoom"], via.desde], false),
];

/**
 * Las capas de las vías: el tren y los caminos, todos los bordes debajo y los rellenos encima, de
 * la clase menos importante a la más, para que los cruces no se corten con un borde.
 *
 * Cada clase va en sus capas, con su color, su grosor y su opacidad fijos o según el zoom. El #61
 * las juntó en dos capas con el color, el grosor y la opacidad por clase, y así MapLibre guardaba
 * esos tres valores en cada vértice de cada vía, para los bordes y para los rellenos: en
 * Barcelona a z12, 25 MB más que las propias líneas, que había que mandar del worker al hilo
 * principal y subir a la GPU en cada tesela que llega (#67).
 *
 * Con la foto aérea encendida, bordes y rellenos se esconden y se ve `vias-foto`, con líneas finas
 * y claras; el tren y los caminos pasan a blanco translúcido.
 */
export const capasVias = (
  fuente: string,
  color: ColorDeToken,
): ReadonlyArray<LayerSpecification> => {
  const clases = CLASES_DE_VIAS.map((via) => capasDeLaClase(fuente, color, via));
  return [
    {
      id: "tren",
      type: "line",
      source: fuente,
      "source-layer": "transportation",
      minzoom: 9,
      filter: ["all", deClase("rail"), ["!=", ["get", "brunnel"], "tunnel"]],
      paint: {
        "line-color": conFoto(color("mapa-tren"), color("mapa-foto-linea")),
        "line-width": porZoom(9, 0.6, 14, 1.2, 18, 2),
        "line-opacity": conFoto(1, 0.45),
      },
    },
    {
      id: "caminos",
      type: "line",
      source: fuente,
      "source-layer": "transportation",
      minzoom: 14,
      filter: ["all", deClase("path", "track"), ["!=", ["get", "subclass"], "pedestrian"]],
      paint: {
        "line-color": conFoto(color("mapa-camino"), color("mapa-foto-linea")),
        "line-width": porZoom(14, 0.6, 18, 1.6),
        "line-dasharray": [2, 1.5],
        "line-opacity": porZoom(14, 0, 14.6, conFoto(1, 0.35)),
      },
    },
    ...clases.flatMap((capas) => capas.borde),
    ...clases.map((capas) => capas.relleno),
    {
      id: "vias-foto",
      type: "line",
      source: fuente,
      "source-layer": "transportation",
      minzoom: 4,
      filter: VIAS,
      layout: { ...REDONDO, "line-sort-key": ORDEN, visibility: visibleConFoto },
      paint: {
        "line-color": porClase((via) => color(via.sobreLaFoto.color), color("mapa-foto-linea")),
        "line-width": porZoomYClase(1, (via) => via.sobreLaFoto.grosor),
        "line-opacity": porZoomYClase(1, (via) => via.sobreLaFoto.opacidad),
      },
    },
  ];
};
