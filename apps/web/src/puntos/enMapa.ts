import type { Coordenada } from "@celda/dominio/area";
import { type FiltroDeCompanias, mascarasDeFiltro, mismoFiltro } from "@celda/dominio/filtro";
import {
  apagarPuntos,
  CAPAS_DE_PUNTOS_TOCABLES,
  datosDelElegido,
  filtrarPuntos,
  filtrosDePuntos,
  FUENTE_PUNTO_ELEGIDO,
  FUENTE_PUNTOS,
  mostrarPuntos,
} from "@celda/ui/mapa/puntos.ts";
import { recurso } from "@celda/ui/recurso.ts";
import * as Predicate from "effect/Predicate";
import type { GeoJSONSource, Map as MapaMapLibre } from "maplibre-gl";
import { createEffect, createMemo, createSignal } from "solid-js";

import type { PuntosDelMapa } from "../capa/puntos.ts";
import { type PuntoTocado, RADIO_DEL_DEDO } from "./puntos.ts";

/**
 * Los puntos en el mapa (ADR 0028): su fuente, si se ven, el fundido con los logos, el filtro de
 * compañías y el elegido. Cada cosa se pone cuando cambia; MapLibre no hace nada si ya estaba
 * igual. En las pruebas, un lienzo que apunta lo que recibe.
 */
export interface LienzoDePuntos {
  /** Pone los puntos de toda España en su fuente, desde una URL que lee el worker de MapLibre. */
  readonly ponerDatos: (url: string) => void;
  readonly mostrar: (visibles: boolean) => void;
  readonly apagar: (apagados: boolean) => void;
  readonly filtrar: (filtro: FiltroDeCompanias) => void;
  /** Pone el anillo en el emplazamiento elegido, o lo quita. */
  readonly elegir: (posicion: Coordenada | undefined) => void;
  /** Los puntos que se ven a `RADIO_DEL_DEDO` píxeles o menos de un punto de la pantalla. */
  readonly tocados: (pixel: {
    readonly x: number;
    readonly y: number;
  }) => ReadonlyArray<PuntoTocado>;
}

/** El lienzo de los puntos sobre un mapa de MapLibre. */
export const lienzoDePuntos = (mapa: MapaMapLibre): LienzoDePuntos => ({
  ponerDatos: (url) => {
    void mapa.getSource<GeoJSONSource>(FUENTE_PUNTOS)?.setData(url);
  },
  mostrar: (visibles) => mostrarPuntos(mapa, visibles),
  apagar: (apagados) => apagarPuntos(mapa, apagados),
  filtrar: (filtro) => {
    const { propias, usadas } = mascarasDeFiltro(filtro);
    filtrarPuntos(mapa, filtrosDePuntos(propias, usadas));
  },
  elegir: (posicion) => {
    void mapa.getSource<GeoJSONSource>(FUENTE_PUNTO_ELEGIDO)?.setData(datosDelElegido(posicion));
  },
  tocados: ({ x, y }) => {
    const capas = CAPAS_DE_PUNTOS_TOCABLES.filter((id) => mapa.getLayer(id) !== undefined);
    if (capas.length === 0) return [];
    const vistos = new Map<number, number>();
    for (const rasgo of mapa.queryRenderedFeatures(
      [
        [x - RADIO_DEL_DEDO, y - RADIO_DEL_DEDO],
        [x + RADIO_DEL_DEDO, y + RADIO_DEL_DEDO],
      ],
      { layers: capas },
    )) {
      if (!Predicate.isNumber(rasgo.id) || rasgo.geometry.type !== "Point") continue;
      const [lon = 0, lat = 0] = rasgo.geometry.coordinates;
      const punto = mapa.project([lon, lat]);
      const distancia = Math.hypot(punto.x - x, punto.y - y);
      // Un punto puede salir en dos teselas: cuenta una vez.
      if (distancia <= RADIO_DEL_DEDO) vistos.set(rasgo.id, distancia);
    }
    return [...vistos].map(([indice, distancia]) => ({ indice, distancia }));
  },
});

/**
 * Pone y mantiene los puntos en el mapa:
 *
 * - Sus datos, en cuanto llegan, en una URL `blob:` que dura toda la visita: el worker de MapLibre
 *   la vuelve a leer si cambia el mapa (un reintento) o su estilo (el mapa base de reserva).
 * - Si se ven: con la vista de puntos y sus datos.
 * - Si están apagados: mientras se ven los logos, con su fundido.
 * - Su filtro de compañías y el anillo del elegido.
 */
export const crearPuntosEnMapa = (entrada: {
  readonly lienzo: () => LienzoDePuntos | undefined;
  readonly puntos: () => PuntosDelMapa | undefined;
  readonly visibles: () => boolean;
  readonly apagados: () => boolean;
  readonly filtro: () => FiltroDeCompanias;
  readonly elegido: () => Coordenada | undefined;
}): void => {
  const [url, setUrl] = createSignal<string>();
  // Los puntos llegan una vez por visita, y su URL dura lo que ellos.
  recurso("puntos:url", entrada.puntos, (puntos) => {
    const actual = URL.createObjectURL(
      new Blob([puntos.geojson], { type: "application/geo+json" }),
    );
    setUrl(actual);
    return () => URL.revokeObjectURL(actual);
  });
  createEffect(
    () => ({ lienzo: entrada.lienzo(), url: url() }),
    ({ lienzo, url: actual }) => {
      if (lienzo !== undefined && actual !== undefined) lienzo.ponerDatos(actual);
    },
  );
  createEffect(
    () => ({ lienzo: entrada.lienzo(), visibles: entrada.visibles() }),
    ({ lienzo, visibles }) => {
      lienzo?.mostrar(visibles);
    },
  );
  createEffect(
    () => ({ lienzo: entrada.lienzo(), apagados: entrada.apagados() }),
    ({ lienzo, apagados }) => {
      lienzo?.apagar(apagados);
    },
  );
  const filtro = createMemo(entrada.filtro, { equals: mismoFiltro });
  createEffect(
    () => ({ lienzo: entrada.lienzo(), filtro: filtro() }),
    ({ lienzo, filtro: actual }) => {
      lienzo?.filtrar(actual);
    },
  );
  createEffect(
    () => ({ lienzo: entrada.lienzo(), elegido: entrada.elegido() }),
    ({ lienzo, elegido }) => {
      lienzo?.elegir(elegido);
    },
  );
};
