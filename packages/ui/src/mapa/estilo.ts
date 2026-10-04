import type { Contorno } from "@celda/dominio/comunitatValenciana";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

import { capasCeldas, FUENTE_CELDAS } from "./celdas.ts";
import { comoRgb, leerOklch } from "./color.ts";
import { FOTO_AEREA } from "./expresiones.ts";
import {
  capaFoto,
  capaNumeroDelEdificio,
  capasEdificio,
  FUENTE_EDIFICIO,
  FUENTE_FOTO,
  fuenteEdificio,
  fuenteFoto,
} from "./foto.ts";
import { capasInterferencia, FUENTE_INTERFERENCIA } from "./interferencia.ts";
import { capasLimites, FUENTE_LIMITES } from "./limites.ts";
import {
  capasRotulos,
  type ContornoDeEspana,
  LETRAS_DE_LEJOS,
  MUNICIPIOS_DE_CELDA,
} from "./rotulos.ts";
import {
  capasServicioDebajo,
  capasServicioEncima,
  FUENTE_SERVICIO,
  FUENTE_SERVICIO_LINEA,
} from "./servicio.ts";
import { capasSuelo } from "./suelo.ts";
import type { ColorDeToken } from "./tokens.ts";
import { capasVias } from "./vias.ts";
import { capasZona, FUENTE_ZONA } from "./zona.ts";

export { type ColorDeToken, TOKENS_MAPA, type TokenMapa } from "./tokens.ts";
export {
  type ContornoDeEspana,
  type MapaConRotulos,
  quitarRotulosDeMunicipios,
} from "./rotulos.ts";

const OPENFREEMAP = "https://tiles.openfreemap.org";
const TILEJSON = `${OPENFREEMAP}/planet`;
const GLIFOS = `${OPENFREEMAP}/fonts/{fontstack}/{range}.pbf`;

/**
 * Lo que el mapa base pide en cadena antes de pintar la vista inicial: el TileJSON del callejero
 * y los glifos de los rótulos que se ven de lejos, del rango 0-255, que cubre el castellano y el
 * catalán. La web los pide por adelantado para no esperarlos después (`apps/web/src/mapa/precarga.ts`).
 */
export const RECURSOS_INICIALES_MAPA_BASE: ReadonlyArray<string> = [
  TILEJSON,
  ...LETRAS_DE_LEJOS.map((letra) =>
    GLIFOS.replace("{fontstack}", encodeURIComponent(letra)).replace("{range}", "0-255"),
  ),
];

/** El nombre de la fuente del callejero dentro del estilo. */
export const FUENTE_MAPA_BASE = "openmaptiles";

/**
 * El estado del estilo, el mismo en el mapa base y en el de reserva: los municipios que son zona
 * (`quitarRotulosDeMunicipios`) y la foto aérea (`ponerFotoAerea`). Pasar al de reserva no los toca.
 */
export const estadoDelEstilo = (): NonNullable<StyleSpecification["state"]> => ({
  [MUNICIPIOS_DE_CELDA]: { default: [] },
  [FOTO_AEREA]: { default: false },
});

/**
 * Las fuentes de lo que pinta Celda sobre el mapa base: la foto aérea, el edificio resaltado, las
 * celdas, el sector que da servicio, la vista de interferencia, la zona del ejercicio y los límites
 * de comunidades y provincias, vacías hasta que la web las llena.
 */
export const fuentesDeCelda = (): StyleSpecification["sources"] => ({
  [FUENTE_FOTO]: fuenteFoto(),
  [FUENTE_EDIFICIO]: fuenteEdificio(),
  [FUENTE_CELDAS]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  [FUENTE_SERVICIO]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  [FUENTE_SERVICIO_LINEA]: {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  },
  [FUENTE_INTERFERENCIA]: {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  },
  [FUENTE_ZONA]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  [FUENTE_LIMITES]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
});

/**
 * Las capas de Celda que van entre las vías y los rótulos del mapa base: la vista de interferencia,
 * el sector que da servicio, las celdas, la zona del ejercicio y el edificio resaltado.
 */
export const capasDeCelda = (color: ColorDeToken): ReadonlyArray<LayerSpecification> => [
  ...capasInterferencia([
    color("mapa-sinr-1"),
    color("mapa-sinr-2"),
    color("mapa-sinr-3"),
    color("mapa-sinr-4"),
    color("mapa-sinr-5"),
    color("mapa-sinr-6"),
  ]),
  ...capasServicioDebajo(color("mapa-celda")),
  ...capasCeldas(color("mapa-celda"), color("mapa-foto-linea")),
  ...capasServicioEncima(color("mapa-celda"), color("mapa-referencia")),
  ...capasZona(color("mapa-referencia")),
  ...capasEdificio(color),
];

/**
 * El estilo del mapa base de OpenFreeMap (esquema OpenMapTiles) con la paleta A del tema (ADR
 * 0022): el suelo, los límites, las vías por clase y los rótulos por importancia. No lleva ningún
 * color escrito: todos salen de `color`. Los límites de comunidades y provincias van en
 * `FUENTE_LIMITES`, vacía hasta que la web la llena después del primer pintado (ADR 0023). Lleva
 * también las capas de Celda (`capasDeCelda`), con sus fuentes vacías hasta que la web las llena
 * (`fuentesDeCelda`), entre las vías y los rótulos.
 *
 * La foto aérea (ADR 0022) va en el mismo estilo, apagada: la ortofoto sobre la tierra, el
 * edificio que resalta «Ver el edificio» bajo los rótulos, y en cada capa del mapa base cómo se ve
 * sobre ella. Se enciende con el estado `FOTO_AEREA` (`ponerFotoAerea`).
 *
 * `espana` es el contorno con que los rótulos de lugar de fuera de España no salen de lejos, y
 * `comunitatValenciana`, el que decide la forma de los nombres con «/» (ADR 0025). Llegan de fuera,
 * y no de un `import` de este módulo, para que sus 24 y 3,5 KB vayan con el código del mapa y no
 * con el de la primera pantalla, que también usa este módulo.
 *
 * Si OpenFreeMap no responde al abrir, la web pasa al mapa base de reserva del IGN
 * (`reserva/estilo.ts`), que tiene las mismas capas de Celda.
 */
export const estiloMapa = (
  color: ColorDeToken,
  espana: ContornoDeEspana,
  comunitatValenciana: Contorno,
): StyleSpecification => ({
  version: 8,
  glyphs: GLIFOS,
  state: estadoDelEstilo(),
  sources: {
    [FUENTE_MAPA_BASE]: { type: "vector", url: TILEJSON },
    ...fuentesDeCelda(),
  },
  layers: [
    ...capasSuelo(FUENTE_MAPA_BASE, color, [capaFoto()]),
    ...capasLimites(FUENTE_MAPA_BASE, color),
    ...capasVias(FUENTE_MAPA_BASE, color),
    ...capasDeCelda(color),
    ...capasRotulos(FUENTE_MAPA_BASE, color, espana, comunitatValenciana, [
      capaNumeroDelEdificio(color),
    ]),
  ],
});

/**
 * Lee los tokens del mapa de los estilos calculados de `elemento`, de modo que
 * el mapa sigue al tema activo. Falla si tema.css no está cargado.
 */
export const coloresDelTema =
  (elemento: Element): ColorDeToken =>
  (token) => {
    const valor = getComputedStyle(elemento).getPropertyValue(`--${token}`).trim();
    if (valor === "") {
      throw new Error(`Falta el token --${token}: ¿se ha cargado @celda/ui/tema.css?`);
    }
    const rgb = leerOklch(valor);
    return rgb === null ? valor : comoRgb(rgb);
  };
