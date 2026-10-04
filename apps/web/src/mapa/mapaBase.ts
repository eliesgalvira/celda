import { alRectangulo, type Area } from "@celda/dominio/area";
import { CONTORNO_DE_LA_COMUNITAT_VALENCIANA } from "@celda/dominio/comunitatValenciana";
import { CONTORNO_DE_ESPANA } from "@celda/ui/mapa/espana.ts";
import { coloresDelTema, estiloMapa } from "@celda/ui/mapa/estilo.ts";
import { crearImagenesDeHuecos } from "@celda/ui/mapa/huecos.ts";
import { FUENTE_LIMITES } from "@celda/ui/mapa/limites.ts";
import { conLoDeCelda, estiloDeReserva } from "@celda/ui/mapa/reserva/estilo.ts";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import {
  type GeoJSONSource,
  LngLat,
  Map as MapaMapLibre,
  prewarm,
  setWorkerUrl,
} from "maplibre-gl";
import urlDelTrabajador from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import { type Avisos, type Callejero, esperarDeVerdad, vigilarCallejero } from "./callejero.ts";
import { leerLimites, limitesDeLaVisita } from "./limites.ts";
import urlDeLimites from "./limites.json?url";
import { LECTOR_DE_ROTULOS } from "./rotulosDeCiudad.ts";
import { zoomsSinPartir } from "./teselas.ts";
import { type Relleno, ZOOM_MAXIMO_AL_ABRIR } from "./vistaInicial.ts";

/**
 * El lector de los rótulos de ciudad colocados, con la tabla de habitantes de las ciudades: va en
 * este trozo, con el mapa, y no en el de la primera pantalla.
 */
export { LECTOR_DE_ROTULOS };

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
    // Los límites no pasan por el runtime de la pantalla: este módulo es su punto de entrada y
    // monta su cliente HTTP.
    // @effect-diagnostics-next-line strictEffectProvide:off
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
 * `relleno`. Su centro no sale de `area.limites`, pero lo que se ve alrededor sí: con `maxBounds`,
 * MapLibre acerca el mapa hasta que los límites llenan la pantalla, y en un móvil alto eso dejaba
 * media península fuera al abrir.
 *
 * Nace con el callejero `desde`. Con el principal, si OpenFreeMap no responde, pasa al de reserva
 * del IGN con `setStyle`, sin recargar ni perder la vista, las capas de Celda ni la ficha
 * (`vigilarCallejero`). La web no le pide que vuelva: eso es en la siguiente visita.
 */
export const crearMapaBase = (
  contenedor: HTMLElement,
  area: Area,
  avisos: Avisos,
  relleno: Relleno,
  desde: Callejero,
): MapaMapLibre => {
  const { encuadre, limites } = area;
  const colores = coloresDelTema(document.documentElement);
  const mapa = new MapaMapLibre({
    container: contenedor,
    style:
      desde === "reserva"
        ? estiloDeReserva(colores)
        : estiloMapa(colores, CONTORNO_DE_ESPANA, CONTORNO_DE_LA_COMUNITAT_VALENCIANA),
    bounds: [
      [encuadre.suroeste.longitud, encuadre.suroeste.latitud],
      [encuadre.noreste.longitud, encuadre.noreste.latitud],
    ],
    fitBoundsOptions: { padding: relleno, maxZoom: ZOOM_MAXIMO_AL_ABRIR },
    transformConstrain: (centro, zoom) => {
      const dentro = alRectangulo(limites, { longitud: centro.lng, latitud: centro.lat });
      return {
        center: new LngLat(dentro.longitud, dentro.latitud),
        zoom: Math.min(area.zoomMaximo, Math.max(area.zoomMinimo, zoom)),
      };
    },
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

  vigilarCallejero(mapa, avisos, {
    desde,
    // El mapa compara el estilo que tiene con el de reserva y solo cambia el callejero. La fuente
    // de los límites se queda con sus líneas, si ya habían llegado.
    ponerReserva: () =>
      mapa.setStyle(estiloDeReserva(colores), {
        diff: true,
        transformStyle: (anterior, reserva) =>
          anterior === undefined ? reserva : conLoDeCelda(anterior, reserva),
      }),
    esperar: esperarDeVerdad,
  });
  // Los huecos de los marcadores piden su imagen transparente la primera vez (ADR 0024).
  crearImagenesDeHuecos(mapa);
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
