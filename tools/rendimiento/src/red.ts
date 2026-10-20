// Sin Effect: Playwright es de promesas y los scripts corren con Node tal cual.
// @effect-diagnostics globalConsole:off
import type { BrowserContext, Route } from "playwright-core";

/**
 * La red de las pruebas del navegador (`resistencia` y `deriva`). La prueba contesta en local lo
 * que la página y sus Workers piden fuera del sitio: el mapa base, con teselas vacías, y sus
 * glifos. Lo demás lo corta y lo apunta, y la pasada falla con su URL. Playwright ve también lo
 * que piden los Workers. Las teselas las pide el Worker de MapLibre y pasan por aquí (#85).
 */

/**
 * Para `chromium.launch`. Chromium no resuelve ningún nombre salvo 127.0.0.1, así que nada llega
 * a la red aunque se salte el enrutado de Playwright. Así se quedan en la máquina también las
 * peticiones que hace Chromium por su cuenta a Google, que no son de la página. Antes del #85
 * salían seis en cada pasada.
 */
export const SIN_RED = "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1";

/**
 * Con qué mapa base se queda la web en la pasada. Con la reserva, OpenFreeMap corta la conexión,
 * como en un bloqueo de LaLiga, y la web pasa al mapa base de reserva del IGN.
 */
export type MapaBase = "principal" | "reserva";

/**
 * Las capas de las teselas de OpenFreeMap, que son las del esquema de OpenMapTiles. El TileJSON
 * falso las declara como el de verdad. Hasta el #85 no declaraba ninguna. MapLibre avisaba
 * entonces con un error sin fuente de que faltaba `landuse`, la web lo tomaba por un fallo de
 * OpenFreeMap y pasaba a la reserva antes de pedir ninguna tesela. Si una capa del estilo lee alguna que no está aquí,
 * la web de verdad también pasa a la reserva, y la prueba falla porque no usa el mapa principal.
 */
const CAPAS_DE_OPENFREEMAP = [
  "aerodrome_label",
  "aeroway",
  "boundary",
  "building",
  "housenumber",
  "landcover",
  "landuse",
  "mountain_peak",
  "park",
  "place",
  "poi",
  "transportation",
  "transportation_name",
  "water",
  "water_name",
  "waterway",
];

const OPENFREEMAP = "tiles.openfreemap.org";
const IGN = "vt-mapabase.idee.es";

const TILEJSON = JSON.stringify({
  tilejson: "3.0.0",
  tiles: [`https://${OPENFREEMAP}/planet/{z}/{x}/{y}.pbf`],
  minzoom: 0,
  maxzoom: 14,
  vector_layers: CAPAS_DE_OPENFREEMAP.map((id) => ({ id, fields: {} })),
});

const TESELA_DE_OPENFREEMAP = /^\/planet\/\d+\/\d+\/\d+\.pbf$/u;
const GLIFOS_DE_OPENFREEMAP = /^\/fonts\/[^/]+\/\d+-\d+\.pbf$/u;
const TESELA_DEL_IGN = /^\/1\.0\.0\/mapabase\/\d+\/\d+\/\d+\.pbf$/u;
const GLIFOS_DEL_IGN = /^\/files\/styles\/fonts\/pbf\/[^/]+\/\d+-\d+\.pbf$/u;

/** Lo que ha pedido la página fuera del sitio durante una pasada. */
export interface RedDeLaPasada {
  readonly mapaBase: MapaBase;
  /** Las teselas contestadas de cada mapa base. */
  readonly teselas: { readonly principal: number; readonly reserva: number };
  /** Lo que la prueba no sabe contestar y ha cortado, con las veces que se pidió. */
  readonly cortadas: ReadonlyMap<string, number>;
}

/** Una tesela o unos glifos vacíos. Un protobuf de cero bytes es válido y no trae nada. */
const vacio = (ruta: Route) =>
  ruta.fulfill({ contentType: "application/x-protobuf", body: Buffer.alloc(0) });

/**
 * Contesta en local, en todo el contexto, lo que se pida fuera de `origen`, y devuelve lo pedido.
 * Va antes de abrir ninguna página.
 */
export const contestarEnLocal = async (
  contexto: BrowserContext,
  origen: string,
  mapaBase: MapaBase,
): Promise<RedDeLaPasada> => {
  const teselas = { principal: 0, reserva: 0 };
  const cortadas = new Map<string, number>();
  await contexto.route(
    (url) => url.origin !== origen,
    async (ruta) => {
      const url = new URL(ruta.request().url());
      if (url.host === OPENFREEMAP) {
        if (mapaBase === "reserva") return ruta.abort("connectionreset");
        if (url.pathname === "/planet") {
          return ruta.fulfill({ contentType: "application/json", body: TILEJSON });
        }
        if (TESELA_DE_OPENFREEMAP.test(url.pathname)) {
          teselas.principal += 1;
          return vacio(ruta);
        }
        if (GLIFOS_DE_OPENFREEMAP.test(url.pathname)) return vacio(ruta);
      }
      if (url.host === IGN) {
        if (TESELA_DEL_IGN.test(url.pathname)) {
          teselas.reserva += 1;
          return vacio(ruta);
        }
        if (GLIFOS_DEL_IGN.test(url.pathname)) return vacio(ruta);
      }
      cortadas.set(url.href, (cortadas.get(url.href) ?? 0) + 1);
      return ruta.abort("blockedbyclient");
    },
  );
  return { mapaBase, teselas, cortadas };
};

/**
 * Lo que ha fallado en la red de la pasada, una línea por cosa. Falla si la página pidió algo que
 * la prueba no sabe contestar, porque eso habría salido a la red, y si la web no usó el mapa base
 * de la pasada.
 */
const fallosDeLaRed = (red: RedDeLaPasada): ReadonlyArray<string> => {
  const fallos = [...red.cortadas].map(
    ([url, veces]) =>
      `La página pidió ${url}${veces > 1 ? ` (${veces} veces)` : ""}, que habría salido a la red, y la prueba lo cortó.`,
  );
  const { principal, reserva } = red.teselas;
  if (red.mapaBase === "principal" && (principal === 0 || reserva > 0)) {
    fallos.push(
      `La web pidió ${principal} teselas a OpenFreeMap y ${reserva} al IGN, así que no se quedó con el mapa base principal.`,
    );
  }
  if (red.mapaBase === "reserva" && reserva === 0) {
    fallos.push("La web no pidió ninguna tesela al IGN, así que no pasó al mapa base de reserva.");
  }
  return fallos;
};

/**
 * Escribe cuántas teselas se han contestado en local y lo que ha fallado en la red de la pasada.
 * Devuelve si ha fallado algo.
 */
export const informarDeLaRed = (red: RedDeLaPasada): boolean => {
  console.log(
    `\nTeselas contestadas en local: ${red.teselas.principal} de OpenFreeMap y ${red.teselas.reserva} del IGN.`,
  );
  const fallos = fallosDeLaRed(red);
  for (const linea of fallos) console.log(`✗ ${linea}`);
  return fallos.length > 0;
};
