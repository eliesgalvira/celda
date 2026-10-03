import type { Area } from "@celda/dominio/area";
import { CONTORNO_DE_LA_COMUNITAT_VALENCIANA } from "@celda/dominio/comunitatValenciana";
import { CONTORNO_DE_ESPANA } from "@celda/ui/mapa/espana.ts";
import { coloresDelTema, estiloMapa } from "@celda/ui/mapa/estilo.ts";
import { FUENTE_LIMITES } from "@celda/ui/mapa/limites.ts";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { type GeoJSONSource, Map as MapaMapLibre, prewarm, setWorkerUrl } from "maplibre-gl";
import urlDelTrabajador from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import { type Avisos, vigilarCallejero } from "./callejero.ts";
import { leerLimites, limitesDeLaVisita } from "./limites.ts";
import urlDeLimites from "./limites.json?url";
import { zoomsSinPartir } from "./teselas.ts";
import { type Relleno, ZOOM_MAXIMO_AL_ABRIR } from "./vistaInicial.ts";

// MapLibre 6 busca su worker junto a su propio fichero, que el empaquetador
// mueve; Vite empaqueta el worker aparte y le da su URL.
setWorkerUrl(urlDelTrabajador);
// Los workers descargan su código (medio mega) y arrancan ya, mientras se monta la pantalla: el
// mapa pide las teselas a través de ellos (ver `precarga.ts`).
prewarm();

/**
 * Los límites de comunidades y provincias, del mismo origen que la web (ADR 0018 y 0023): el
 * fichero va con la huella en el nombre, fuera del JavaScript, y se pide una vez por visita.
 */
const ponerLimites = limitesDeLaVisita(
  leerLimites(new URL(urlDeLimites, globalThis.location.href).href).pipe(
    // Los límites no pasan por el runtime de la pantalla: este módulo monta su cliente HTTP.
    Effect.provide(FetchHttpClient.layer),
  ),
);

const TEXTOS_MAPLIBRE = {
  "Map.Title": "Mapa. Muévete con las flechas y acerca o aleja con + y −.",
};

/**
 * Crea el mapa base de `area` en `contenedor`, con el estilo del tema activo
 * y sin giros: se mueve con un dedo o el ratón y se acerca pellizcando, con
 * la rueda o con el teclado. Nace encuadrando `area.encuadre` sin lo que tapa
 * `relleno`.
 */
export const crearMapaBase = (
  contenedor: HTMLElement,
  area: Area,
  avisos: Avisos,
  relleno: Relleno,
): MapaMapLibre => {
  const { encuadre, limites } = area;
  const mapa = new MapaMapLibre({
    container: contenedor,
    style: estiloMapa(
      coloresDelTema(document.documentElement),
      CONTORNO_DE_ESPANA,
      CONTORNO_DE_LA_COMUNITAT_VALENCIANA,
    ),
    bounds: [
      [encuadre.suroeste.longitud, encuadre.suroeste.latitud],
      [encuadre.noreste.longitud, encuadre.noreste.latitud],
    ],
    fitBoundsOptions: { padding: relleno, maxZoom: ZOOM_MAXIMO_AL_ABRIR },
    maxBounds: [
      [limites.suroeste.longitud, limites.suroeste.latitud],
      [limites.noreste.longitud, limites.noreste.latitud],
    ],
    minZoom: area.zoomMinimo,
    maxZoom: area.zoomMaximo,
    // Sin esto, por encima del zoom 17 no sale ningún nombre de calle (`teselas.ts`).
    zoomLevelsToOverscale: zoomsSinPartir(area.zoomMaximo),
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    locale: TEXTOS_MAPLIBRE,
  });
  mapa.touchZoomRotate.disableRotation();
  mapa.keyboard.disableRotation();

  vigilarCallejero(mapa, avisos);
  // Después del primer pintado completo: no compiten con el mapa base ni con los marcadores.
  ponerLimites({
    trasElPrimerPintado: (escuchar) => {
      mapa.once("idle", escuchar);
    },
    alQuitarse: (escuchar) => {
      mapa.once("remove", escuchar);
    },
    dibujar: (lineas) => {
      mapa.getSource<GeoJSONSource>(FUENTE_LIMITES)?.setData(lineas);
    },
  });
  return mapa;
};
