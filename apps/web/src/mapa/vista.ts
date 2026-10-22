import { contiene, type Rectangulo } from "@celda/dominio/area";
import type { Salto } from "@celda/ui/marcadores/Deslizable.tsx";

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
  readonly getCenter: () => { readonly lng: number; readonly lat: number };
  readonly project: (lugar: [number, number]) => { readonly x: number; readonly y: number };
}

/** La vista que enseña ahora el mapa. */
const vistaDe = (mapa: MapaQueSeMueve): Vista => {
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

/**
 * Dónde va la lámina de los marcadores. A un mismo zoom todo el mapa se desplaza lo mismo en la
 * pantalla, así que los marcadores se colocan una vez y lo que se mueve es su lámina.
 */
export interface Lamina {
  /** El zoom al que se colocaron los marcadores. Al cambiar, hay que volver a colocarlos. */
  readonly zoom: number;
  /** Lo que se ha desplazado el mapa desde que se colocaron: lo que se mueve la lámina. */
  readonly salto: Salto;
}

export interface Seguimiento {
  /**
   * En cada `move`, dentro del fotograma en que MapLibre mueve la cámara. Uno pedido desde ahí con
   * `requestAnimationFrame` llegaba un fotograma tarde, y los marcadores iban detrás del mapa.
   */
  readonly lamina: (lamina: Lamina) => void;
  /** Hay que volver a decidir qué se dibuja para esta vista (y su caja con margen). */
  readonly vista: (vista: Vista) => void;
}

const QUIETA: Salto = { x: 0, y: 0 };

/**
 * Sigue el movimiento del mapa para los marcadores. Mover su lámina es barato y se hace en cada
 * `move`; colocar cada marcador, solo al cambiar el zoom. Decidir qué se dibuja (agrupar, crear y
 * quitar nodos) es lo caro, y se hace:
 *
 * - al asentarse el mapa (`moveend`), aunque haya cruzado varios niveles de zoom por el camino;
 * - durante el movimiento, solo al cambiar de nivel si además la vista se ha salido de la caja con
 *   margen que ya está dibujada: al alejar, para no dejar los bordes vacíos. Al acercar, lo
 *   dibujado se separa con el zoom y la agrupación nueva llega al soltar, con su transición.
 *
 * Devuelve la función que deja de seguirlo.
 */
export const seguirVista = (mapa: MapaQueSeMueve, seguimiento: Seguimiento): (() => void) => {
  let dibujada = vistaDe(mapa);
  const decidir = () => {
    dibujada = vistaDe(mapa);
    seguimiento.vista(dibujada);
  };
  /** Dónde se colocaron los marcadores: el zoom y en qué píxel caía entonces el centro. */
  const colocar = () => {
    const { lng, lat } = mapa.getCenter();
    const centro: [number, number] = [lng, lat];
    return { zoom: mapa.getZoom(), centro, punto: mapa.project(centro) };
  };
  let colocados = colocar();
  const alMover = () => {
    if (mapa.getZoom() === colocados.zoom) {
      const punto = mapa.project(colocados.centro);
      seguimiento.lamina({
        zoom: colocados.zoom,
        salto: { x: punto.x - colocados.punto.x, y: punto.y - colocados.punto.y },
      });
    } else {
      colocados = colocar();
      seguimiento.lamina({ zoom: colocados.zoom, salto: QUIETA });
    }
    const ahora = vistaDe(mapa);
    if (
      nivelDeZoom(ahora.zoom) !== nivelDeZoom(dibujada.zoom) &&
      !dentro(cajaConMargen(dibujada.caja), ahora.caja)
    ) {
      decidir();
    }
  };
  mapa.on("move", alMover);
  mapa.on("moveend", decidir);
  seguimiento.lamina({ zoom: colocados.zoom, salto: QUIETA });
  decidir();
  return () => {
    mapa.off("move", alMover);
    mapa.off("moveend", decidir);
  };
};
