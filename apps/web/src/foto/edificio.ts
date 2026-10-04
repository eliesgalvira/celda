import type { Coordenada } from "@celda/dominio/area";
import { aPlano, type PuntoLocal } from "@celda/dominio/plano";
import * as Predicate from "effect/Predicate";

/**
 * Qué edificio resalta «Ver el edificio» (ADR 0022). Los edificios y los números de portal son los
 * de OpenStreetMap en las teselas de OpenFreeMap, no los del registro oficial: el número de portal
 * del edificio puede no ser el de la dirección del emplazamiento, sobre todo en una esquina.
 */

/** Hasta dónde se busca el edificio más cercano si ninguno contiene el emplazamiento. */
export const DISTANCIA_AL_EDIFICIO_M = 25;
/** Hasta dónde vale un número de portal del propio edificio. */
const DISTANCIA_AL_PORTAL_PROPIO_M = 80;
/** Hasta dónde vale, si el edificio no tiene ninguno dentro, el número más cercano. */
const DISTANCIA_A_OTRO_PORTAL_M = 30;

/** Un punto de GeoJSON: longitud y latitud. */
type Posicion = ReadonlyArray<number>;

/** Un polígono en el orden de GeoJSON: el anillo de fuera y, después, sus huecos. */
export type Poligono = ReadonlyArray<ReadonlyArray<Posicion>>;

/**
 * Un edificio tal como lo da el mapa. Un edificio partido entre dos teselas llega en dos trozos
 * con el mismo `id`.
 */
export interface Edificio {
  readonly id: string | number | undefined;
  readonly poligonos: ReadonlyArray<Poligono>;
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
      /** `contiene`: el emplazamiento cae dentro; `cerca`: el más cercano, a menos de 25 m. */
      readonly como: "contiene" | "cerca";
      /** Todos los trozos del edificio. */
      readonly poligonos: ReadonlyArray<Poligono>;
      readonly portal: Portal | undefined;
    };

const enElPlano = (origen: Coordenada, [longitud = 0, latitud = 0]: Posicion): PuntoLocal =>
  aPlano(origen, { longitud, latitud });

/** Si `punto` cae dentro del anillo, por la regla par-impar. */
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

/** Si `punto` cae dentro del polígono y no en uno de sus huecos. */
const dentroDelPoligono = (origen: Coordenada, punto: Coordenada, poligono: Poligono): boolean => {
  const [fuera, ...huecos] = poligono.map((anillo) => anillo.map((p) => enElPlano(origen, p)));
  const local = aPlano(origen, punto);
  return (
    fuera !== undefined &&
    dentroDelAnillo(local, fuera) &&
    !huecos.some((hueco) => dentroDelAnillo(local, hueco))
  );
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

/** Distancia en metros de la posición al borde de fuera del edificio más cercano a ella. */
const distanciaAlEdificio = (posicion: Coordenada, edificio: Edificio): number => {
  let mejor = Infinity;
  const origen = { este: 0, norte: 0 };
  for (const [fuera = []] of edificio.poligonos) {
    const anillo = fuera.map((p) => enElPlano(posicion, p));
    for (let i = 1; i < anillo.length; i++) {
      const a = anillo[i - 1];
      const b = anillo[i];
      if (a !== undefined && b !== undefined) {
        mejor = Math.min(mejor, distanciaAlSegmento(origen, a, b));
      }
    }
  }
  return mejor;
};

const metros = (a: Coordenada, b: Coordenada): number => {
  const { este, norte } = aPlano(a, b);
  return Math.hypot(este, norte);
};

/** El portal más cercano a `posicion` de `portales` a menos de `maximo` metros. */
const masCercano = (
  posicion: Coordenada,
  portales: ReadonlyArray<Portal>,
  maximo: number,
): Portal | undefined =>
  portales
    .map((portal) => ({ portal, distancia: metros(posicion, portal.punto) }))
    .filter(({ distancia }) => distancia < maximo)
    .toSorted((a, b) => a.distancia - b.distancia)[0]?.portal;

/**
 * El edificio de `edificios` que contiene `posicion` o, si ninguno, el más cercano a menos de
 * `DISTANCIA_AL_EDIFICIO_M`, con todos sus trozos. Su número es el portal que cae dentro de él más
 * cercano al emplazamiento o, si no tiene, el portal más cercano a menos de 30 m.
 */
export const elegirEdificio = (
  posicion: Coordenada,
  edificios: ReadonlyArray<Edificio>,
  portales: ReadonlyArray<Portal>,
): EdificioEncontrado => {
  const contiene = edificios.find((edificio) =>
    edificio.poligonos.some((poligono) => dentroDelPoligono(posicion, posicion, poligono)),
  );
  const cerca =
    contiene === undefined
      ? edificios
          .map((edificio) => ({ edificio, distancia: distanciaAlEdificio(posicion, edificio) }))
          .filter(({ distancia }) => distancia < DISTANCIA_AL_EDIFICIO_M)
          .toSorted((a, b) => a.distancia - b.distancia)[0]?.edificio
      : undefined;
  const elegido = contiene ?? cerca;
  if (elegido === undefined) return { tipo: "ninguno" };
  const trozos =
    elegido.id === undefined ? [elegido] : edificios.filter((e) => e.id === elegido.id);
  const poligonos = trozos.flatMap((trozo) => trozo.poligonos);
  const propios = portales.filter((portal) =>
    poligonos.some((poligono) => dentroDelPoligono(posicion, portal.punto, poligono)),
  );
  return {
    tipo: "edificio",
    como: contiene === undefined ? "cerca" : "contiene",
    poligonos,
    portal:
      masCercano(posicion, propios, DISTANCIA_AL_PORTAL_PROPIO_M) ??
      masCercano(posicion, portales, DISTANCIA_A_OTRO_PORTAL_M),
  };
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

/** Un trozo del edificio resaltado o el punto de su número, en la fuente `edificio`. */
export type RasgoDelEdificio =
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

/** Lo que dibuja el mapa del edificio encontrado: sus trozos y el punto de su número. */
export const dibujoDelEdificio = (encontrado: EdificioEncontrado): DibujoDelEdificio => {
  if (encontrado.tipo === "ninguno") return SIN_EDIFICIO;
  const trozos = encontrado.poligonos.map((poligono): RasgoDelEdificio => ({
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: poligono },
  }));
  const { portal } = encontrado;
  return {
    type: "FeatureCollection",
    features:
      portal === undefined
        ? trozos
        : [
            ...trozos,
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
   * IGN; de un edificio no se lee nada.
   */
  readonly properties: {
    readonly housenumber?: string | number;
    readonly ref?: string | number;
  } | null;
  readonly geometry: { readonly type: string; readonly coordinates?: unknown };
}

/** El edificio de un rasgo de la capa de edificios, o nada si no es un polígono. */
export const edificioDeRasgo = (rasgo: RasgoDelMapa): Edificio | undefined => {
  const { type, coordinates } = rasgo.geometry;
  if (!Array.isArray(coordinates)) return undefined;
  // SAFETY: MapLibre da las coordenadas de un `Polygon` o un `MultiPolygon` en el orden de GeoJSON.
  const poligonos =
    type === "Polygon"
      ? [coordinates as Poligono]
      : type === "MultiPolygon"
        ? (coordinates as ReadonlyArray<Poligono>)
        : undefined;
  return poligonos === undefined ? undefined : { id: rasgo.id, poligonos };
};

/** El portal de un rasgo de la capa de portales, ya abreviado, o nada si no es un punto. */
export const portalDeRasgo = (rasgo: RasgoDelMapa): Portal | undefined => {
  const { type, coordinates } = rasgo.geometry;
  const numero = rasgo.properties?.["housenumber"] ?? rasgo.properties?.["ref"];
  if (type !== "Point" || !Array.isArray(coordinates) || numero === undefined) return undefined;
  const [longitud, latitud] = coordinates;
  if (!Predicate.isNumber(longitud) || !Predicate.isNumber(latitud)) return undefined;
  const texto = abreviarPortal(String(numero));
  return texto === "" ? undefined : { numero: texto, punto: { longitud, latitud } };
};
