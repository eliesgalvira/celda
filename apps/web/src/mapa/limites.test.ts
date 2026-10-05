// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { LineasDeLimites } from "@celda/ui/mapa/limites.ts";
import { assert, describe, it } from "@effect/vitest";
import { waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";

import { origenDePrueba } from "../ficha/pruebas.ts";
import { otraTarea } from "../lib/pruebas.ts";
import {
  leerLimites,
  limitesDeLaVisita,
  type MapaParaLimites,
  ZOOM_DEL_DETALLE,
} from "./limites.ts";

const URL_LIMITES = "http://celda.prueba/assets/limites-0a1b2c.json";
const URL_DETALLE = "http://celda.prueba/assets/limites-detalle-3d4e5f.json";

const fichero = (comunidades: ReadonlyArray<ReadonlyArray<number>>) =>
  JSON.stringify({
    fuente: {
      atribucion: "Instituto Geográfico Nacional",
      producto: "Base de Datos de Límites Jurisdiccionales de España",
      licencia: "CC BY 4.0",
      enlace: "https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml",
      fecha: "2026-08-10",
      huella: "sha256:0",
    },
    toleranciaMetros: 1000,
    unidadesPorGrado: 1000,
    pais: [],
    comunidades,
    provincias: [[2040, 41000, 0, 20]],
  });

/** Un fichero de límites como el que escribe `pnpm run limites`: una comunidad y una provincia. */
const GENERAL = fichero([[-1500, 40000, 250, -1000]]);
/** El de detalle: la misma comunidad con un vértice más. */
const DETALLE = fichero([[-1500, 40000, 100, -500, 150, -500]]);

/** Las comunidades de lo dibujado, para saber qué fichero es. */
const comunidades = (lineas: LineasDeLimites | undefined) =>
  lineas?.features
    .filter((f) => f.properties.limite === "comunidad")
    .map((f) => f.geometry.coordinates);

/**
 * Un mapa de prueba. Como MapLibre, avisa una sola vez de que tiene el estilo, de que pasa de un
 * zoom y de que se quita, y apunta lo que se le dibuja.
 */
const mapaDePrueba = () => {
  const conEstilo: Array<() => void> = [];
  const alAcercarse: Array<{ readonly zoom: number; readonly escuchar: () => void }> = [];
  const alQuitar: Array<() => void> = [];
  const dibujos: Array<LineasDeLimites> = [];
  let zoom = 5;
  let estilo = false;
  const mapa: MapaParaLimites = {
    conEstilo: (escuchar) => (estilo ? escuchar() : conEstilo.push(escuchar)),
    alAcercarse: (desde, escuchar) =>
      zoom >= desde ? escuchar() : alAcercarse.push({ zoom: desde, escuchar }),
    alQuitarse: (escuchar) => alQuitar.push(escuchar),
    dibujar: (lineas) => dibujos.push(lineas),
  };
  return {
    mapa,
    dibujos,
    cargarEstilo: () => {
      estilo = true;
      for (const escuchar of conEstilo.splice(0)) escuchar();
    },
    acercar: (a: number) => {
      zoom = a;
      for (const espera of alAcercarse.splice(0)) {
        if (zoom >= espera.zoom) espera.escuchar();
        else alAcercarse.push(espera);
      }
    },
    quitar: () => {
      for (const escuchar of alQuitar.splice(0)) escuchar();
    },
  };
};

const montar = () => {
  const origen = origenDePrueba();
  const limites = limitesDeLaVisita({
    general: leerLimites(URL_LIMITES).pipe(Effect.provide(origen.capa)),
    detalle: leerLimites(URL_DETALLE).pipe(Effect.provide(origen.capa)),
  });
  return { origen, limites };
};

describe("límites de comunidades y provincias en el mapa", () => {
  it("el general se pide al arrancar, antes del mapa, y se dibuja en cuanto el estilo lo admite", async () => {
    const { origen, limites } = montar();
    limites.adelantar();
    await waitFor(() => assert.deepStrictEqual(origen.abiertas(), [URL_LIMITES]));
    origen.responder(URL_LIMITES, { estado: 200, cuerpo: GENERAL });

    const prueba = mapaDePrueba();
    limites.poner(prueba.mapa);
    await otraTarea();
    assert.deepStrictEqual(prueba.dibujos, []);
    prueba.cargarEstilo();
    await waitFor(() => assert.lengthOf(prueba.dibujos, 1));
    assert.deepStrictEqual(
      prueba.dibujos[0]?.features.map((f) => [f.properties.limite, f.geometry.coordinates]),
      [
        [
          "provincia",
          [
            [2.04, 41],
            [2.04, 41.02],
          ],
        ],
        [
          "comunidad",
          [
            [-1.5, 40],
            [-1.25, 39],
          ],
        ],
      ],
    );
    assert.deepStrictEqual(origen.pedidas(), [URL_LIMITES]);
  });

  it("el de detalle se pide la primera vez que el mapa se acerca, y sustituye al general", async () => {
    const { origen, limites } = montar();
    const prueba = mapaDePrueba();
    limites.poner(prueba.mapa);
    prueba.cargarEstilo();
    await waitFor(() => assert.deepStrictEqual(origen.abiertas(), [URL_LIMITES]));
    origen.responder(URL_LIMITES, { estado: 200, cuerpo: GENERAL });
    await waitFor(() => assert.lengthOf(prueba.dibujos, 1));

    prueba.acercar(ZOOM_DEL_DETALLE - 0.5);
    await otraTarea();
    assert.deepStrictEqual(origen.pedidas(), [URL_LIMITES]);
    prueba.acercar(ZOOM_DEL_DETALLE);
    await waitFor(() => assert.deepStrictEqual(origen.abiertas(), [URL_DETALLE]));
    origen.responder(URL_DETALLE, { estado: 200, cuerpo: DETALLE });
    await waitFor(() => assert.lengthOf(prueba.dibujos, 2));
    assert.lengthOf(comunidades(prueba.dibujos[1])?.[0] ?? [], 3);

    // Acercar y alejar otra vez no pide ni dibuja nada más.
    prueba.acercar(5);
    prueba.acercar(12);
    await otraTarea();
    assert.lengthOf(prueba.dibujos, 2);
    assert.deepStrictEqual(origen.pedidas(), [URL_LIMITES, URL_DETALLE]);
  });

  it("un mapa que abre ya de cerca pide los dos, y el general que llega tarde no pisa al de detalle", async () => {
    const { origen, limites } = montar();
    const prueba = mapaDePrueba();
    prueba.acercar(16);
    prueba.cargarEstilo();
    limites.poner(prueba.mapa);
    await waitFor(() => assert.deepStrictEqual(origen.abiertas(), [URL_LIMITES, URL_DETALLE]));
    origen.responder(URL_DETALLE, { estado: 200, cuerpo: DETALLE });
    await waitFor(() => assert.lengthOf(prueba.dibujos, 1));
    origen.responder(URL_LIMITES, { estado: 200, cuerpo: GENERAL });
    await otraTarea();
    assert.lengthOf(prueba.dibujos, 1);
    assert.lengthOf(comunidades(prueba.dibujos[0])?.[0] ?? [], 3);
  });

  it("un mapa nuevo en la misma visita recibe las mismas líneas sin pedir nada", async () => {
    const { origen, limites } = montar();
    const primero = mapaDePrueba();
    limites.poner(primero.mapa);
    primero.cargarEstilo();
    primero.acercar(10);
    await waitFor(() => assert.lengthOf(origen.abiertas(), 2));
    origen.responder(URL_LIMITES, { estado: 200, cuerpo: GENERAL });
    origen.responder(URL_DETALLE, { estado: 200, cuerpo: DETALLE });
    await waitFor(() => assert.isNotEmpty(primero.dibujos));

    const segundo = mapaDePrueba();
    limites.poner(segundo.mapa);
    segundo.cargarEstilo();
    segundo.acercar(10);
    await waitFor(() => assert.strictEqual(segundo.dibujos.at(-1), primero.dibujos.at(-1)));
    assert.deepStrictEqual(origen.pedidas(), [URL_LIMITES, URL_DETALLE]);
  });

  it("un mapa que se quita antes de que lleguen no los dibuja", async () => {
    const { origen, limites } = montar();
    const prueba = mapaDePrueba();
    limites.poner(prueba.mapa);
    prueba.cargarEstilo();
    await waitFor(() => assert.lengthOf(origen.abiertas(), 1));
    prueba.quitar();
    origen.responder(URL_LIMITES, { estado: 200, cuerpo: GENERAL });
    await otraTarea();
    assert.deepStrictEqual(prueba.dibujos, []);
  });

  it("si el fichero no llega o no se lee, el mapa sigue sin él y el siguiente lo vuelve a pedir", async () => {
    const { origen, limites } = montar();
    const primero = mapaDePrueba();
    limites.poner(primero.mapa);
    primero.cargarEstilo();
    await waitFor(() => assert.lengthOf(origen.abiertas(), 1));
    origen.responder(URL_LIMITES, { estado: 404, cuerpo: "" });
    await otraTarea();
    assert.deepStrictEqual(primero.dibujos, []);

    const segundo = mapaDePrueba();
    limites.poner(segundo.mapa);
    segundo.cargarEstilo();
    await waitFor(() => assert.lengthOf(origen.abiertas(), 1));
    origen.responder(URL_LIMITES, { estado: 200, cuerpo: '{"comunidades":[]}' });
    await otraTarea();
    assert.deepStrictEqual(segundo.dibujos, []);
    assert.deepStrictEqual(origen.pedidas(), [URL_LIMITES, URL_LIMITES]);
  });
});
