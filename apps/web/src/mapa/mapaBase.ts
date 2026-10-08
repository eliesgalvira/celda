import { alRectangulo, type Area } from "@celda/dominio/area";
import { CONTORNO_DE_LA_COMUNITAT_VALENCIANA } from "@celda/dominio/comunitatValenciana";
import { CONTORNO_DE_ESPANA } from "@celda/ui/mapa/espana.ts";
import { type ColorDeToken, coloresDelTema, estiloMapa } from "@celda/ui/mapa/estilo.ts";
import { crearImagenesDeHuecos } from "@celda/ui/mapa/huecos.ts";
import { FUENTE_LIMITES } from "@celda/ui/mapa/limites.ts";
import { conLoDeCelda, estiloDeReserva } from "@celda/ui/mapa/reserva/estilo.ts";
import { FUENTE_SILUETA, levantarSilueta } from "@celda/ui/mapa/silueta.ts";
import { pasarDeTema } from "@celda/ui/mapa/tema.ts";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import {
  type GeoJSONSource,
  type StyleSpecification,
  LngLat,
  Map as MapaMapLibre,
  prewarm,
  setWorkerUrl,
} from "maplibre-gl";
import urlDelTrabajador from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import { type Avisos, type Callejero, esperarDeVerdad, vigilarCallejero } from "./callejero.ts";
import { leerLimites, limitesDeLaVisita } from "./limites.ts";
import urlDeLimitesDeDetalle from "./limites-detalle.json?url";
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

/** Lee un fichero de límites del mismo origen que la web. */
const leerDelOrigen = (url: string) =>
  leerLimites(new URL(url, globalThis.location.href).href).pipe(
    // Los límites no pasan por el runtime de la pantalla: este módulo es su punto de entrada y
    // monta su cliente HTTP.
    // @effect-diagnostics-next-line strictEffectProvide:off
    Effect.provide(FetchHttpClient.layer),
  );

/**
 * Los límites de comunidades y provincias, del mismo origen que la web (ADR 0018 y 0023): cada
 * fichero va con la huella en el nombre, fuera del JavaScript, y se pide una vez por visita. El
 * general se pide ya, para dibujarlo con la silueta en cuanto exista el mapa (`precarga.ts` lo
 * adelanta aún más).
 */
const limitesDeComunidades = limitesDeLaVisita({
  general: leerDelOrigen(urlDeLimites),
  detalle: leerDelOrigen(urlDeLimitesDeDetalle),
});
limitesDeComunidades.adelantar();

/** Si la persona prefiere menos movimiento: la silueta se quita sin fundido. */
const sinMovimiento = (): boolean =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Llama a `escuchar` una vez, cuando el mapa ya ha pintado la silueta de España: los marcadores
 * no salen antes, para que los datos nunca se vean sin geografía. Si la silueta no avisara, el
 * evento `load` de MapLibre hace lo mismo más tarde.
 */
export const trasLaSilueta = (mapa: MapaMapLibre, escuchar: () => void): void => {
  let hecho = false;
  const una = () => {
    if (hecho) return;
    hecho = true;
    mapa.off("sourcedata", mirar);
    escuchar();
  };
  const mirar = (evento: { readonly sourceId?: string; readonly isSourceLoaded?: boolean }) => {
    if (evento.sourceId === FUENTE_SILUETA && evento.isSourceLoaded === true) {
      mapa.once("render", una);
    }
  };
  mapa.on("sourcedata", mirar);
  mapa.once("load", una);
};

/** El mapa base y cómo repintarlo con los colores del tema activo. */
export interface MapaBase {
  readonly mapa: MapaMapLibre;
  /**
   * Vuelve a leer los colores del tema y cambia los que el mapa tiene distintos, sin `setStyle`
   * ni perder la vista, la foto aérea, la ficha o lo que la web ha puesto en las fuentes
   * (`pasarDeTema`). Se llama con el estilo ya cargado.
   */
  readonly repintar: () => void;
}

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
 * (`vigilarCallejero`). La web no le pide que vuelva: eso es en la siguiente visita. Hasta que
 * llega todo el callejero de la vista, la silueta de España con los límites lo tapa
 * (`@celda/ui/mapa/silueta.ts`), y entonces se funde.
 *
 * Si cambia el tema, del sistema o elegido en Ajustes, la pantalla llama a `repintar` y el mapa
 * toma los colores del nuevo con el callejero que tenga en ese momento.
 */
export const crearMapaBase = (
  contenedor: HTMLElement,
  area: Area,
  avisos: Omit<Avisos, "completo">,
  relleno: Relleno,
  desde: Callejero,
): MapaBase => {
  const { encuadre, limites } = area;
  /** Los colores con que está pintado el mapa, y con qué callejero. */
  let colores = coloresDelTema(document.documentElement);
  let callejero = desde;
  const estiloCon = (color: ColorDeToken): StyleSpecification =>
    callejero === "reserva"
      ? estiloDeReserva(color, CONTORNO_DE_ESPANA)
      : estiloMapa(color, CONTORNO_DE_ESPANA, CONTORNO_DE_LA_COMUNITAT_VALENCIANA);
  const mapa = new MapaMapLibre({
    container: contenedor,
    style: estiloCon(colores),
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

  vigilarCallejero(
    mapa,
    {
      ...avisos,
      // Con todo el callejero de la vista, la silueta se funde y deja verlo.
      completo: () => levantarSilueta(mapa, sinMovimiento()),
    },
    {
      desde,
      // El mapa compara el estilo que tiene con el de reserva y solo cambia el callejero. La fuente
      // de los límites se queda con sus líneas, si ya habían llegado.
      ponerReserva: () => {
        callejero = "reserva";
        mapa.setStyle(estiloCon(colores), {
          diff: true,
          transformStyle: (anterior, reserva) =>
            anterior === undefined ? reserva : conLoDeCelda(anterior, reserva),
        });
      },
      esperar: esperarDeVerdad,
    },
  );
  // Los huecos de los marcadores piden su imagen transparente la primera vez (ADR 0024).
  crearImagenesDeHuecos(mapa);
  limitesDeComunidades.poner({
    trasLaSilueta: (escuchar) => trasLaSilueta(mapa, escuchar),
    alAcercarse: (zoom, escuchar) => {
      const mirar = () => {
        if (mapa.getZoom() < zoom) return;
        mapa.off("zoom", mirar);
        escuchar();
      };
      mapa.on("zoom", mirar);
      mirar();
    },
    alQuitarse: (escuchar) => {
      mapa.once("remove", escuchar);
    },
    dibujar: (lineas) => {
      mapa.getSource<GeoJSONSource>(FUENTE_LIMITES)?.setData(lineas);
    },
  });
  const repintar = () => {
    const nuevos = coloresDelTema(document.documentElement);
    pasarDeTema(mapa, estiloCon(colores), estiloCon(nuevos));
    colores = nuevos;
  };
  return { mapa, repintar };
};
