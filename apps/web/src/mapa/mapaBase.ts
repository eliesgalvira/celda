import type { Area } from "@celda/dominio/area";
import { coloresDelTema, estiloMapa, FUENTE_MAPA_BASE } from "@celda/ui/mapa/estilo.ts";
import { Map as MapaMapLibre, prewarm, setWorkerUrl } from "maplibre-gl";
import urlDelTrabajador from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import type { MotivoFallo } from "./estado.ts";

// MapLibre 6 busca su worker junto a su propio fichero, que el empaquetador
// mueve; Vite empaqueta el worker aparte y le da su URL.
setWorkerUrl(urlDelTrabajador);
// Los workers descargan su código (medio mega) y arrancan ya, mientras se monta la pantalla: el
// mapa pide las teselas a través de ellos (ver `precarga.ts`).
prewarm();

const TEXTOS_MAPLIBRE = {
  "Map.Title": "Mapa. Muévete con las flechas y acerca o aleja con + y −.",
};

export interface Avisos {
  readonly listo: () => void;
  readonly fallo: (motivo: MotivoFallo) => void;
}

/**
 * Crea el mapa base de `area` en `contenedor`, con el estilo del tema activo
 * y sin giros: se mueve con un dedo o el ratón y se acerca pellizcando, con
 * la rueda o con el teclado.
 */
export const crearMapaBase = (
  contenedor: HTMLElement,
  area: Area,
  avisos: Avisos,
): MapaMapLibre => {
  const { encuadre, limites } = area;
  const mapa = new MapaMapLibre({
    container: contenedor,
    style: estiloMapa(coloresDelTema(document.documentElement)),
    bounds: [
      [encuadre.suroeste.longitud, encuadre.suroeste.latitud],
      [encuadre.noreste.longitud, encuadre.noreste.latitud],
    ],
    maxBounds: [
      [limites.suroeste.longitud, limites.suroeste.latitud],
      [limites.noreste.longitud, limites.noreste.latitud],
    ],
    minZoom: area.zoomMinimo,
    maxZoom: area.zoomMaximo,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    locale: TEXTOS_MAPLIBRE,
  });
  mapa.touchZoomRotate.disableRotation();
  mapa.keyboard.disableRotation();

  // El evento `load` de MapLibre llega aunque el callejero no haya cargado, y
  // eso dejaría un lienzo vacío pasando por mapa. El mapa está listo cuando
  // llega la primera tesela del mapa base; hasta entonces, un error es un fallo.
  let conCallejero = false;
  mapa.on("sourcedata", (evento) => {
    if (conCallejero || evento.sourceId !== FUENTE_MAPA_BASE || evento.tile === undefined) return;
    conCallejero = true;
    avisos.listo();
  });
  mapa.on("error", () => {
    if (!conCallejero) avisos.fallo("sin-respuesta");
  });
  return mapa;
};
