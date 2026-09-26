import { contiene, type Rectangulo } from "@celda/dominio/area";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import { type Compania, NOMBRE_COMPANIA } from "@celda/dominio/compania";
import { ZOOM_LOGOS } from "@celda/ui/mapa/estilo.ts";

/** Lo que enseña el mapa en un momento: dónde mira y a qué zoom. */
export interface Vista {
  readonly caja: Rectangulo;
  readonly zoom: number;
}

/** Margen alrededor de la vista, en fracción de su tamaño: al arrastrar, los bordes ya están. */
const MARGEN = 0.15;

/**
 * Qué marcadores DOM se dibujan. Lejos (por debajo de `ZOOM_LOGOS`) ninguno: el mapa pinta los
 * emplazamientos como puntos. Cerca, los de la vista.
 */
export type Marcadores =
  | { readonly tipo: "lejos" }
  | {
      readonly tipo: "cerca";
      /** Posiciones en la capa de los emplazamientos que se dibujan. */
      readonly indices: ReadonlyArray<number>;
    };

/** Si a este zoom los emplazamientos son puntos del mapa o marcadores con logos. */
export const distanciaDeZoom = (zoom: number): Marcadores["tipo"] =>
  zoom < ZOOM_LOGOS ? "lejos" : "cerca";

const ampliar = (caja: Rectangulo, fraccion: number): Rectangulo => {
  const dx = (caja.noreste.longitud - caja.suroeste.longitud) * fraccion;
  const dy = (caja.noreste.latitud - caja.suroeste.latitud) * fraccion;
  return {
    suroeste: { longitud: caja.suroeste.longitud - dx, latitud: caja.suroeste.latitud - dy },
    noreste: { longitud: caja.noreste.longitud + dx, latitud: caja.noreste.latitud + dy },
  };
};

/**
 * Qué marcadores se dibujan: ninguno si el mapa está lejos, y si está cerca los de los
 * emplazamientos que caen en la vista, con un margen alrededor.
 */
export const marcadoresVisibles = (
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
  vista: Vista,
): Marcadores => {
  if (distanciaDeZoom(vista.zoom) === "lejos") return { tipo: "lejos" };
  const caja = ampliar(vista.caja, MARGEN);
  const indices: Array<number> = [];
  emplazamientos.forEach((emplazamiento, i) => {
    if (contiene(caja, emplazamiento.posicion)) indices.push(i);
  });
  return { tipo: "cerca", indices };
};

const enumerar = (nombres: ReadonlyArray<string>): string =>
  nombres.length <= 1
    ? (nombres[0] ?? "")
    : `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1) ?? ""}`;

/** Nombre accesible del marcador: las compañías que emiten allí y el estado si no es verificado. */
export const nombreDeMarcador = (emplazamiento: EmplazamientoDeCapa): string => {
  const companias = emplazamiento.companias.map((c) => NOMBRE_COMPANIA[c]);
  const quien =
    companias.length === 0
      ? "Emplazamiento sin compañías conocidas"
      : companias.length === 1
        ? `Emplazamiento de ${companias[0] ?? ""}`
        : `Emplazamiento compartido por ${enumerar(companias)}`;
  return emplazamiento.estado === "verificado" ? quien : `${quien}, ${emplazamiento.estado}`;
};

/** Las combinaciones distintas de compañías de la capa, cada una una vez: un logo por cada una. */
export const combinacionesDe = (
  emplazamientos: ReadonlyArray<EmplazamientoDeCapa>,
): ReadonlyArray<ReadonlyArray<Compania>> => [
  ...new Map(emplazamientos.map((e) => [e.companias.join("-"), e.companias])).values(),
];

/** Una colección GeoJSON de puntos con la clave de cada emplazamiento. */
export interface PuntosGeoJson {
  readonly type: "FeatureCollection";
  readonly features: Array<{
    readonly type: "Feature";
    readonly geometry: { readonly type: "Point"; readonly coordinates: [number, number] };
    readonly properties: { readonly clave: string };
  }>;
}

/** Los emplazamientos como puntos GeoJSON, para la capa de puntos del mapa a zoom bajo. */
export const puntosDe = (emplazamientos: ReadonlyArray<EmplazamientoDeCapa>): PuntosGeoJson => ({
  type: "FeatureCollection",
  features: emplazamientos.map((e) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [e.posicion.longitud, e.posicion.latitud] },
    properties: { clave: e.clave },
  })),
});
