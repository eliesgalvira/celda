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
import { FUENTE_HUECOS, fuenteHuecos } from "./huecos.ts";
import { capasLimites, FUENTE_LIMITES } from "./limites.ts";
import { capasLineaAlPunto, FUENTE_LINEA_AL_PUNTO } from "./lineaAlPunto.ts";
import { capasPuntoElegido, capasPuntos, fuentesPuntos } from "./puntos.ts";
import {
  capasRotulos,
  type ContornoDeEspana,
  LETRAS_DE_LEJOS,
  MUNICIPIOS_DE_CELDA,
} from "./rotulos.ts";
import { capasSilueta, fuentesSilueta } from "./silueta.ts";
import { capasSuelo } from "./suelo.ts";
import { type ColorDeToken, TOKENS_MAPA } from "./tokens.ts";
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
 * celdas, la línea hasta el punto de referencia, la zona del ejercicio, los límites de comunidades
 * y provincias, los huecos de los marcadores (ADR 0024) y los puntos de la vista de puntos
 * (ADR 0028), vacías hasta que la web las llena.
 */
export const fuentesDeCelda = (): StyleSpecification["sources"] => ({
  [FUENTE_FOTO]: fuenteFoto(),
  [FUENTE_EDIFICIO]: fuenteEdificio(),
  [FUENTE_CELDAS]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  [FUENTE_LINEA_AL_PUNTO]: {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  },
  [FUENTE_ZONA]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  [FUENTE_LIMITES]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  [FUENTE_HUECOS]: fuenteHuecos(),
  ...fuentesPuntos(),
});

/**
 * Las capas de Celda que van entre las vías y los rótulos del mapa base: las celdas, la línea
 * hasta el punto de referencia, la zona del ejercicio, el edificio resaltado y, encima, los puntos
 * de la vista de puntos.
 */
export const capasDeCelda = (color: ColorDeToken): ReadonlyArray<LayerSpecification> => [
  ...capasCeldas(color("mapa-celda"), color("mapa-foto-linea")),
  ...capasLineaAlPunto(color("mapa-referencia")),
  ...capasZona(color("mapa-referencia")),
  ...capasEdificio(color),
  ...capasPuntos(color("mapa-punto"), color("mapa-foto-linea")),
];

/** Las capas de Celda que van encima de todo, también de los rótulos: el emplazamiento elegido. */
export const capasDeCeldaEncima = (color: ColorDeToken): ReadonlyArray<LayerSpecification> =>
  capasPuntoElegido(color("mapa-punto"), color("mapa-foto-linea"));

/**
 * El estilo del mapa base de OpenFreeMap (esquema OpenMapTiles) con la paleta A del tema (ADR
 * 0022): el suelo, los límites, las vías por clase y los rótulos por importancia. No lleva ningún
 * color escrito: todos salen de `color`. Los límites de comunidades y provincias van en
 * `FUENTE_LIMITES`, vacía hasta que la web la llena al arrancar (ADR 0023). Mientras carga el
 * callejero, la silueta de España (`silueta.ts`) tapa el suelo. Lleva
 * también las capas de Celda (`capasDeCelda`), con sus fuentes vacías hasta que la web las llena
 * (`fuentesDeCelda`), entre las vías y los rótulos.
 *
 * La foto aérea (ADR 0022) va en el mismo estilo, apagada: la ortofoto sobre la tierra, el
 * edificio que resalta «Ver el edificio» bajo los rótulos, y en cada capa del mapa base cómo se ve
 * sobre ella. Se enciende con el estado `FOTO_AEREA` (`ponerFotoAerea`).
 *
 * `espana` es el contorno de la silueta y el que hace que los rótulos de lugar de fuera de España
 * no salgan de lejos, y
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
    ...fuentesSilueta(espana),
  },
  layers: [
    ...capasSuelo(FUENTE_MAPA_BASE, color, [capaFoto()]),
    ...capasSilueta(color),
    ...capasLimites(FUENTE_MAPA_BASE, color),
    ...capasVias(FUENTE_MAPA_BASE, color),
    ...capasDeCelda(color),
    ...capasRotulos(FUENTE_MAPA_BASE, color, espana, comunitatValenciana, [
      capaNumeroDelEdificio(color),
    ]),
    ...capasDeCeldaEncima(color),
  ],
});

/**
 * Los colores del mapa en el tema activo, leídos de una vez de los estilos calculados de
 * `elemento`. Se quedan como estaban aunque el sistema cambie de tema: así la web puede comparar
 * los de antes con los nuevos (`pasarDeTema` en `tema.ts`). Falla si tema.css no está cargado.
 */
export const coloresDelTema = (elemento: Element): ColorDeToken => {
  const estilos = getComputedStyle(elemento);
  const colores = new Map(
    TOKENS_MAPA.map((token) => {
      const valor = estilos.getPropertyValue(`--${token}`).trim();
      if (valor === "") {
        throw new Error(`Falta el token --${token}: ¿se ha cargado @celda/ui/tema.css?`);
      }
      const rgb = leerOklch(valor);
      return [token, rgb === null ? valor : comoRgb(rgb)] as const;
    }),
  );
  return (token) => colores.get(token) ?? "";
};
