import type { Coordenada } from "@celda/dominio/area";
import { aPlano, type PuntoLocal } from "@celda/dominio/plano";
import * as Predicate from "effect/Predicate";

/**
 * Qué edificio resalta «Ver el edificio» (ADR 0022). Los edificios y los números de portal son los
 * de OpenStreetMap en las teselas de OpenFreeMap, no los del registro oficial: el número de portal
 * del edificio puede no ser el de la dirección del emplazamiento, sobre todo en una esquina.
 */

/**
 * Lo que mide como poco un edificio que se resalta. Las casetas de equipos al pie de una torre
 * miden de 8 a 21 m², y las azoteas con antenas, al menos 50 m².
 */
const AREA_MINIMA_M2 = 30;
/**
 * A cuánto del contorno cuenta todavía un número de portal como del edificio. El de una entrada
 * es un punto de la fachada, y la tesela lo redondea a medio metro.
 */
const DISTANCIA_AL_CONTORNO_M = 1;

/** Un punto de GeoJSON: longitud y latitud. */
type Posicion = ReadonlyArray<number>;

/** Un polígono en el orden de GeoJSON: el anillo de fuera y, después, sus huecos. */
export type Poligono = ReadonlyArray<ReadonlyArray<Posicion>>;

/**
 * Un edificio tal como lo da el mapa: un polígono y la altura del rasgo, si la tiene. Un edificio
 * partido entre dos teselas llega en dos trozos, cada uno cortado un poco más allá del borde de su
 * tesela.
 */
export interface Edificio {
  readonly poligono: Poligono;
  readonly altura: number | undefined;
}

/** Un número de portal de OpenStreetMap en su punto. */
export interface Portal {
  readonly numero: string;
  readonly punto: Coordenada;
}

export type EdificioEncontrado =
  | { readonly tipo: "ninguno" }
  | {
      readonly tipo: "edificio";
      /** El polígono que contiene el emplazamiento. */
      readonly poligono: Poligono;
      readonly portal: Portal | undefined;
    };

const enElPlano = (origen: Coordenada, [longitud = 0, latitud = 0]: Posicion): PuntoLocal =>
  aPlano(origen, { longitud, latitud });

/**
 * Si `punto` cae dentro del anillo, por la regla par-impar. Vale en grados o en metros: el plano
 * local solo estira los grados, y lo de dentro sigue dentro.
 */
const dentroDelAnillo = (punto: PuntoLocal, anillo: ReadonlyArray<PuntoLocal>): boolean => {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const a = anillo[i];
    const b = anillo[j];
    if (a === undefined || b === undefined) continue;
    const cruza =
      a.norte > punto.norte !== b.norte > punto.norte &&
      punto.este < ((b.este - a.este) * (punto.norte - a.norte)) / (b.norte - a.norte) + a.este;
    if (cruza) dentro = !dentro;
  }
  return dentro;
};

/** Un anillo en grados, con la longitud como `este` y la latitud como `norte`. */
const enGrados = (anillo: ReadonlyArray<Posicion>): ReadonlyArray<PuntoLocal> =>
  anillo.map(([este = 0, norte = 0]) => ({ este, norte }));

/** Si `punto` cae dentro del polígono y no en uno de sus huecos. */
const dentroDelPoligono = (punto: Coordenada, poligono: Poligono): boolean => {
  const [fuera, ...huecos] = poligono;
  const enGradosDelPunto = { este: punto.longitud, norte: punto.latitud };
  return (
    fuera !== undefined &&
    dentroDelAnillo(enGradosDelPunto, enGrados(fuera)) &&
    !huecos.some((hueco) => dentroDelAnillo(enGradosDelPunto, enGrados(hueco)))
  );
};

/** Área en metros cuadrados de un anillo en el plano. */
const areaDelAnillo = (anillo: ReadonlyArray<PuntoLocal>): number => {
  let doble = 0;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const a = anillo[i];
    const b = anillo[j];
    if (a !== undefined && b !== undefined) doble += b.este * a.norte - a.este * b.norte;
  }
  return Math.abs(doble) / 2;
};

/** Área en metros cuadrados del polígono, sin sus huecos, en el plano de `origen`. */
export const areaDelPoligono = (origen: Coordenada, poligono: Poligono): number => {
  const [fuera = [], ...huecos] = poligono.map((anillo) => anillo.map((p) => enElPlano(origen, p)));
  return huecos.reduce((area, hueco) => area - areaDelAnillo(hueco), areaDelAnillo(fuera));
};

/** Distancia en metros de `p` al segmento de `a` a `b`, todo en el mismo plano. */
const distanciaAlSegmento = (p: PuntoLocal, a: PuntoLocal, b: PuntoLocal): number => {
  const de = b.este - a.este;
  const dn = b.norte - a.norte;
  const largo = de * de + dn * dn;
  const t =
    largo === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.este - a.este) * de + (p.norte - a.norte) * dn) / largo));
  return Math.hypot(p.este - (a.este + t * de), p.norte - (a.norte + t * dn));
};

/** Distancia en metros del punto al anillo de fuera del polígono. */
const distanciaAlContorno = (punto: Coordenada, [fuera = []]: Poligono): number => {
  const anillo = fuera.map((p) => enElPlano(punto, p));
  const origen = { este: 0, norte: 0 };
  let mejor = Infinity;
  for (let i = 1; i < anillo.length; i++) {
    const a = anillo[i - 1];
    const b = anillo[i];
    if (a !== undefined && b !== undefined) {
      mejor = Math.min(mejor, distanciaAlSegmento(origen, a, b));
    }
  }
  return mejor;
};

const metros = (a: Coordenada, b: Coordenada): number => {
  const { este, norte } = aPlano(a, b);
  return Math.hypot(este, norte);
};

/**
 * El edificio que contiene `posicion`, si mide al menos `AREA_MINIMA_M2`, y su número de portal.
 *
 * - Si lo contienen varios polígonos, el más alto y, a igual altura, el más grande. Un bloque alto
 *   dibujado como parte de un edificio más bajo gana a este, porque el emplazamiento suele estar
 *   en el tejado más alto. El edificio entero gana a una parte suya de la misma altura, y el trozo
 *   más entero de un edificio partido entre teselas gana a los demás.
 * - Su número es el del portal dentro de él, o sobre su contorno, más cercano al emplazamiento.
 *   Sin ninguno, va sin número: el portal más cercano de fuera suele ser el del vecino.
 */
export const elegirEdificio = (
  posicion: Coordenada,
  edificios: ReadonlyArray<Edificio>,
  portales: ReadonlyArray<Portal>,
): EdificioEncontrado => {
  const elegido = edificios
    .filter((edificio) => dentroDelPoligono(posicion, edificio.poligono))
    .map((edificio) => ({
      poligono: edificio.poligono,
      altura: edificio.altura ?? 0,
      area: areaDelPoligono(posicion, edificio.poligono),
    }))
    .filter(({ area }) => area >= AREA_MINIMA_M2)
    .toSorted((a, b) => b.altura - a.altura || b.area - a.area)[0];
  if (elegido === undefined) return { tipo: "ninguno" };
  const { poligono } = elegido;
  const portal = portales
    .filter(
      (portal) =>
        dentroDelPoligono(portal.punto, poligono) ||
        distanciaAlContorno(portal.punto, poligono) <= DISTANCIA_AL_CONTORNO_M,
    )
    .map((portal) => ({ portal, distancia: metros(posicion, portal.punto) }))
    .toSorted((a, b) => a.distancia - b.distancia)[0]?.portal;
  return { tipo: "edificio", poligono, portal };
};

/**
 * Un número de portal de OpenStreetMap como se escribe: «381,383,385,387» pasa a «381–387», el
 * primero y el último, y «251;259» a «251-259».
 */
export const abreviarPortal = (numero: string): string => {
  const partes = numero
    .split(/[,;]/u)
    .map((parte) => parte.trim())
    .filter((parte) => parte !== "");
  return partes.length > 2 ? `${partes[0] ?? ""}–${partes.at(-1) ?? ""}` : partes.join("-");
};

/** El edificio resaltado o el punto de su número, en la fuente `edificio`. */
type RasgoDelEdificio =
  | {
      readonly type: "Feature";
      readonly properties: Readonly<Record<string, never>>;
      readonly geometry: { readonly type: "Polygon"; readonly coordinates: Poligono };
    }
  | {
      readonly type: "Feature";
      readonly properties: { readonly numero: string };
      readonly geometry: { readonly type: "Point"; readonly coordinates: Posicion };
    };

/** Lo que dibuja el mapa del edificio resaltado. */
export interface DibujoDelEdificio {
  readonly type: "FeatureCollection";
  readonly features: ReadonlyArray<RasgoDelEdificio>;
}

export const SIN_EDIFICIO: DibujoDelEdificio = { type: "FeatureCollection", features: [] };

/** Lo que dibuja el mapa del edificio encontrado: su polígono y el punto de su número. */
export const dibujoDelEdificio = (encontrado: EdificioEncontrado): DibujoDelEdificio => {
  if (encontrado.tipo === "ninguno") return SIN_EDIFICIO;
  const contorno: RasgoDelEdificio = {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: encontrado.poligono },
  };
  const { portal } = encontrado;
  return {
    type: "FeatureCollection",
    features:
      portal === undefined
        ? [contorno]
        : [
            contorno,
            {
              type: "Feature",
              properties: { numero: portal.numero },
              geometry: {
                type: "Point",
                coordinates: [portal.punto.longitud, portal.punto.latitud],
              },
            },
          ],
  };
};

/** Un elemento de `queryRenderedFeatures`, con lo poco que se lee de él. */
export interface RasgoDelMapa {
  readonly id?: string | number | undefined;
  /**
   * De un número de portal, `housenumber` en OpenFreeMap y `ref` en el mapa base de reserva del
   * IGN; de un edificio, su altura en metros (`render_height`), que el IGN no da.
   */
  readonly properties: {
    readonly housenumber?: string | number;
    readonly ref?: string | number;
    readonly render_height?: unknown;
  } | null;
  readonly geometry: { readonly type: string; readonly coordinates?: unknown };
}

/**
 * Los edificios de un rasgo de la capa de edificios, uno por polígono. OpenFreeMap junta en un
 * `MultiPolygon` todos los edificios de la tesela con la misma altura y el mismo color: en el
 * centro de Madrid, un rasgo lleva 4.193.
 */
export const edificiosDeRasgo = (rasgo: RasgoDelMapa): ReadonlyArray<Edificio> => {
  const { type, coordinates } = rasgo.geometry;
  if (!Array.isArray(coordinates)) return [];
  const altura = rasgo.properties?.render_height;
  // SAFETY: MapLibre da las coordenadas de un `Polygon` o un `MultiPolygon` en el orden de GeoJSON.
  const poligonos =
    type === "Polygon"
      ? [coordinates as Poligono]
      : type === "MultiPolygon"
        ? (coordinates as ReadonlyArray<Poligono>)
        : [];
  return poligonos.map((poligono) => ({
    poligono,
    altura: Predicate.isNumber(altura) ? altura : undefined,
  }));
};

/**
 * Los portales de un rasgo de la capa de portales, ya abreviados: uno de un `Point` y uno por punto
 * de un `MultiPoint`. OpenFreeMap junta en un `MultiPoint` todos los portales de la tesela con el
 * mismo número; así llegan nueve de cada diez.
 */
export const portalesDeRasgo = (rasgo: RasgoDelMapa): ReadonlyArray<Portal> => {
  const { type, coordinates } = rasgo.geometry;
  const numero = rasgo.properties?.["housenumber"] ?? rasgo.properties?.["ref"];
  if (numero === undefined || !Array.isArray(coordinates)) return [];
  const texto = abreviarPortal(String(numero));
  if (texto === "") return [];
  const posiciones: ReadonlyArray<unknown> =
    type === "Point" ? [coordinates] : type === "MultiPoint" ? coordinates : [];
  return posiciones.flatMap((posicion) => {
    if (!Array.isArray(posicion)) return [];
    const [longitud, latitud]: ReadonlyArray<unknown> = posicion;
    return Predicate.isNumber(longitud) && Predicate.isNumber(latitud)
      ? [{ numero: texto, punto: { longitud, latitud } }]
      : [];
  });
};
