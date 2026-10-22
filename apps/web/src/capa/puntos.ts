import type { CapaIlegible } from "@celda/dominio/capa";
import { leerPuntos, type PuntosLeidos } from "@celda/dominio/puntos";
import * as Result from "effect/Result";

/**
 * Los puntos de toda España como los necesita el mapa (ADR 0028): leídos, en columnas, y en
 * GeoJSON para la fuente de MapLibre. Los lee el Worker de capas: analizar el fichero y escribir
 * el GeoJSON de unos 40.000 puntos no bloquea el mapa, y lo que vuelve se transfiere sin copiarse.
 */
export interface PuntosDelMapa {
  readonly puntos: PuntosLeidos;
  /**
   * La colección GeoJSON en UTF-8. La web hace con ella una URL `blob:` que lee el worker de
   * MapLibre: así no se copian 40.000 objetos del hilo principal al worker con `setData`.
   */
  readonly geojson: Uint8Array<ArrayBuffer>;
}

/** Cuántos decimales lleva cada coordenada en el GeoJSON: los del fichero, cienmilésimas. */
const DECIMALES = 5;

/**
 * La colección GeoJSON de los puntos: cada uno con su fila como `id` y la máscara de sus compañías
 * en `c`, lo único que miran los filtros. Se escribe a mano, sin crear un objeto por punto.
 */
const geojsonDePuntos = (puntos: PuntosLeidos): string => {
  const partes = Array.from({ length: puntos.cuantos }, (_, i) => {
    const lon = (puntos.longitud[i] ?? 0).toFixed(DECIMALES);
    const lat = (puntos.latitud[i] ?? 0).toFixed(DECIMALES);
    return (
      `{"type":"Feature","id":${i},"geometry":{"type":"Point","coordinates":[${lon},${lat}]},` +
      `"properties":{"c":${puntos.companias[i] ?? 0}}}`
    );
  });
  return `{"type":"FeatureCollection","features":[${partes.join(",")}]}`;
};

/** Lee los puntos de una versión y escribe su GeoJSON. */
export const leerPuntosDelMapa = (texto: string): Result.Result<PuntosDelMapa, CapaIlegible> =>
  Result.map(leerPuntos(texto), (puntos) => ({
    puntos,
    geojson: new TextEncoder().encode(geojsonDePuntos(puntos)),
  }));

/** Los búferes de unos puntos, que viajan del Worker sin copiarse. */
export const transferiblesDePuntos = (deMapa: PuntosDelMapa): ReadonlyArray<ArrayBuffer> => [
  deMapa.puntos.longitud.buffer,
  deMapa.puntos.latitud.buffer,
  deMapa.puntos.companias.buffer,
  deMapa.puntos.provincia.buffer,
  deMapa.geojson.buffer,
];
