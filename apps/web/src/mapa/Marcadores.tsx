import type { Coordenada } from "@celda/dominio/area";
import type { EmplazamientoDeCapa } from "@celda/dominio/capa";
import type { Map as MapaMapLibre } from "maplibre-gl";
import { createMemo, createSignal, onSettled, untrack } from "solid-js";

import { crearAgrupador, type ElementoAgrupacion, nivelDeZoom } from "../capa/agrupacion.ts";
import { cajaConMargen, combinacionesDe, type Vista } from "../capa/marcadores.ts";
import { CapaAgrupada } from "./CapaAgrupada.tsx";

/** La vista que enseña ahora el mapa. */
const vistaDe = (mapa: MapaMapLibre): Vista => {
  const caja = mapa.getBounds();
  return {
    caja: {
      suroeste: { longitud: caja.getWest(), latitud: caja.getSouth() },
      noreste: { longitud: caja.getEast(), latitud: caja.getNorth() },
    },
    zoom: mapa.getZoom(),
  };
};

const REDUCIR_MOVIMIENTO = "(prefers-reduced-motion: reduce)";

export interface MarcadoresProps {
  readonly mapa: MapaMapLibre;
  /** Todos los emplazamientos de la capa. Se agrupan aquí y se dibujan solo los de la vista. */
  readonly emplazamientos: ReadonlyArray<EmplazamientoDeCapa>;
  /** Clave del emplazamiento con la ficha abierta. */
  readonly seleccionada: string | null;
  /** Se ha pulsado el marcador de un emplazamiento (con el ratón, el dedo o el teclado). */
  readonly alSeleccionar: (clave: string) => void;
}

/**
 * Los emplazamientos sobre el mapa, agrupados por zoom. Los marcadores se recolocan en cada
 * fotograma del movimiento, pero qué se dibuja solo se decide al pararse el mapa o al cambiar de
 * nivel de agrupación: crear y quitar nodos es lo caro.
 */
export function Marcadores(props: MarcadoresProps) {
  const agrupador = createMemo(() => crearAgrupador(props.emplazamientos));
  const combinaciones = createMemo(() => combinacionesDe(props.emplazamientos));
  const [fotograma, setFotograma] = createSignal(0);
  const [vista, setVista] = createSignal<Vista>();
  const [reducido, setReducido] = createSignal(false);

  onSettled(() => {
    const mapa = untrack(() => props.mapa);
    let pendiente = 0;
    let nivel = nivelDeZoom(mapa.getZoom());
    const mirar = () => {
      nivel = nivelDeZoom(mapa.getZoom());
      setVista(vistaDe(mapa));
    };
    const mover = () => {
      pendiente = 0;
      setFotograma((n) => n + 1);
      if (nivelDeZoom(mapa.getZoom()) !== nivel) mirar();
    };
    // Como mucho una vez por fotograma: el mapa emite varios `move` entre dos.
    const alMover = () => {
      if (pendiente === 0) pendiente = requestAnimationFrame(mover);
    };
    mapa.on("move", alMover);
    mapa.on("moveend", mirar);
    mirar();

    const preferencia = matchMedia(REDUCIR_MOVIMIENTO);
    const alCambiarPreferencia = () => setReducido(preferencia.matches);
    preferencia.addEventListener("change", alCambiarPreferencia);
    alCambiarPreferencia();

    return () => {
      mapa.off("move", alMover);
      mapa.off("moveend", mirar);
      cancelAnimationFrame(pendiente);
      preferencia.removeEventListener("change", alCambiarPreferencia);
    };
  });

  const escena = createMemo(() => {
    const ahora = vista();
    return ahora === undefined
      ? undefined
      : agrupador().escena(nivelDeZoom(ahora.zoom), cajaConMargen(ahora.caja));
  });

  const proyectar = (posicion: Coordenada) =>
    props.mapa.project([posicion.longitud, posicion.latitud]);

  /** Acerca el mapa hasta que la agrupación se abre. Con el teclado, el foco vuelve al mapa. */
  const abrir = (agrupacion: ElementoAgrupacion) => {
    const mapa = props.mapa;
    const lienzo = mapa.getCanvas();
    if (mapa.getCanvasContainer().contains(document.activeElement)) {
      lienzo.focus({ preventScroll: true });
    }
    mapa.easeTo({
      center: [agrupacion.posicion.longitud, agrupacion.posicion.latitud],
      zoom: Math.min(agrupador().zoomDeApertura(agrupacion), mapa.getMaxZoom()),
    });
  };

  return (
    <CapaAgrupada
      contenedor={props.mapa.getCanvasContainer()}
      combinaciones={combinaciones()}
      escena={escena()}
      transicion={agrupador().transicion}
      proyectar={proyectar}
      fotograma={fotograma()}
      movimientoReducido={reducido()}
      seleccionada={props.seleccionada}
      alSeleccionar={(clave) => props.alSeleccionar(clave)}
      alAbrir={abrir}
    />
  );
}
