import { contiene, type Rectangulo } from "@celda/dominio/area";

import { nivelDeZoom } from "../capa/agrupacion.ts";
import { cajaConMargen, type Vista } from "../capa/marcadores.ts";

type Evento = "move" | "moveend";

/** Lo que hace falta del mapa para seguir lo que enseña. `Map` de MapLibre lo cumple. */
export interface MapaQueSeMueve {
  readonly on: (evento: Evento, oyente: () => void) => void;
  readonly off: (evento: Evento, oyente: () => void) => void;
  readonly getBounds: () => {
    getWest(): number;
    getSouth(): number;
    getEast(): number;
    getNorth(): number;
  };
  readonly getZoom: () => number;
}

/** La vista que enseña ahora el mapa. */
export const vistaDe = (mapa: MapaQueSeMueve): Vista => {
  const caja = mapa.getBounds();
  return {
    caja: {
      suroeste: { longitud: caja.getWest(), latitud: caja.getSouth() },
      noreste: { longitud: caja.getEast(), latitud: caja.getNorth() },
    },
    zoom: mapa.getZoom(),
  };
};

const dentro = (fuera: Rectangulo, caja: Rectangulo): boolean =>
  contiene(fuera, caja.suroeste) && contiene(fuera, caja.noreste);

export interface Seguimiento {
  /** En cada fotograma en que se mueve el mapa, como mucho una vez: hay que recolocar. */
  readonly fotograma: () => void;
  /** Hay que volver a decidir qué se dibuja para esta vista (y su caja con margen). */
  readonly vista: (vista: Vista) => void;
}

export interface Reloj {
  readonly pedir: (f: () => void) => number;
  readonly cancelar: (id: number) => void;
}

const RELOJ_DEL_NAVEGADOR: Reloj = {
  pedir: (f) => requestAnimationFrame(f),
  cancelar: (id) => cancelAnimationFrame(id),
};

/**
 * Sigue el movimiento del mapa para los marcadores. Recolocarlos es barato y se hace en cada
 * fotograma. Decidir qué se dibuja (agrupar, crear y quitar nodos) es lo caro, y se hace:
 *
 * - al asentarse el mapa (`moveend`), aunque haya cruzado varios niveles de zoom por el camino;
 * - durante el movimiento, solo al cambiar de nivel si además la vista se ha salido de la caja con
 *   margen que ya está dibujada: al alejar, para no dejar los bordes vacíos. Al acercar, lo
 *   dibujado se separa con el zoom y la agrupación nueva llega al soltar, con su transición.
 *
 * Devuelve la función que deja de seguirlo.
 */
export const seguirVista = (
  mapa: MapaQueSeMueve,
  seguimiento: Seguimiento,
  reloj: Reloj = RELOJ_DEL_NAVEGADOR,
): (() => void) => {
  let pendiente = 0;
  let dibujada: Vista | undefined;
  const decidir = () => {
    dibujada = vistaDe(mapa);
    seguimiento.vista(dibujada);
  };
  const recolocar = () => {
    pendiente = 0;
    seguimiento.fotograma();
    const ahora = vistaDe(mapa);
    if (
      dibujada === undefined ||
      (nivelDeZoom(ahora.zoom) !== nivelDeZoom(dibujada.zoom) &&
        !dentro(cajaConMargen(dibujada.caja), ahora.caja))
    ) {
      decidir();
    }
  };
  // Como mucho una vez por fotograma: el mapa emite varios `move` entre dos.
  const alMover = () => {
    if (pendiente === 0) pendiente = reloj.pedir(recolocar);
  };
  mapa.on("move", alMover);
  mapa.on("moveend", decidir);
  decidir();
  return () => {
    mapa.off("move", alMover);
    mapa.off("moveend", decidir);
    reloj.cancelar(pendiente);
  };
};
