// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { LineasDeLimites } from "@celda/ui/mapa/limites.ts";
import { assert, describe, it } from "@effect/vitest";
import { waitFor } from "@solidjs/testing-library";
import * as Effect from "effect/Effect";

import { origenDePrueba } from "../ficha/pruebas.ts";
import { otraTarea } from "../lib/pruebas.ts";
import { leerLimites, limitesDeLaVisita, type MapaParaLimites } from "./limites.ts";

const URL_LIMITES = "http://celda.prueba/assets/limites-0a1b2c.json";

/** Un fichero de límites como el que escribe `pnpm run limites`: una comunidad y una provincia. */
const FICHERO = JSON.stringify({
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
  comunidades: [[-1500, 40000, 250, -1000]],
  provincias: [[2040, 41000, 0, 20]],
});

/**
 * Un mapa de prueba. Como MapLibre, avisa una sola vez de su primer pintado y de que se quita, y
 * apunta lo que se le dibuja.
 */
const mapaDePrueba = () => {
  const alPintar: Array<() => void> = [];
  const alQuitar: Array<() => void> = [];
  const dibujos: Array<LineasDeLimites> = [];
  const mapa: MapaParaLimites = {
    trasElPrimerPintado: (escuchar) => alPintar.push(escuchar),
    alQuitarse: (escuchar) => alQuitar.push(escuchar),
    dibujar: (lineas) => dibujos.push(lineas),
  };
  return {
    mapa,
    dibujos,
    pintar: () => {
      for (const escuchar of alPintar.splice(0)) escuchar();
    },
    quitar: () => {
      for (const escuchar of alQuitar.splice(0)) escuchar();
    },
  };
};

const montar = () => {
  const origen = origenDePrueba();
  const poner = limitesDeLaVisita(leerLimites(URL_LIMITES).pipe(Effect.provide(origen.capa)));
  return { origen, poner };
};

describe("límites de comunidades y provincias en el mapa", () => {
  it("no pide nada hasta el primer pintado, y entonces pide el fichero una vez y lo dibuja", async () => {
    const { origen, poner } = montar();
    const prueba = mapaDePrueba();
    poner(prueba.mapa);
    await Promise.resolve();
    assert.deepStrictEqual(origen.pedidas(), []);

    prueba.pintar();
    await waitFor(() => assert.deepStrictEqual(origen.abiertas(), [URL_LIMITES]));
    origen.responder(URL_LIMITES, { estado: 200, cuerpo: FICHERO });
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

  it("un mapa nuevo en la misma visita recibe las mismas líneas sin pedir nada", async () => {
    const { origen, poner } = montar();
    const primero = mapaDePrueba();
    poner(primero.mapa);
    primero.pintar();
    await waitFor(() => assert.lengthOf(origen.abiertas(), 1));
    origen.responder(URL_LIMITES, { estado: 200, cuerpo: FICHERO });
    await waitFor(() => assert.lengthOf(primero.dibujos, 1));

    const segundo = mapaDePrueba();
    poner(segundo.mapa);
    segundo.pintar();
    await waitFor(() => assert.lengthOf(segundo.dibujos, 1));
    assert.strictEqual(segundo.dibujos[0], primero.dibujos[0]);
    assert.deepStrictEqual(origen.pedidas(), [URL_LIMITES]);
  });

  it("un mapa que se quita antes de que lleguen no los dibuja", async () => {
    const { origen, poner } = montar();
    const prueba = mapaDePrueba();
    poner(prueba.mapa);
    prueba.pintar();
    await waitFor(() => assert.lengthOf(origen.abiertas(), 1));
    prueba.quitar();
    origen.responder(URL_LIMITES, { estado: 200, cuerpo: FICHERO });
    await otraTarea();
    assert.deepStrictEqual(prueba.dibujos, []);
  });

  it("si el fichero no llega o no se lee, el mapa sigue sin ellos y el siguiente lo vuelve a pedir", async () => {
    const { origen, poner } = montar();
    const primero = mapaDePrueba();
    poner(primero.mapa);
    primero.pintar();
    await waitFor(() => assert.lengthOf(origen.abiertas(), 1));
    origen.responder(URL_LIMITES, { estado: 404, cuerpo: "" });
    await otraTarea();
    assert.deepStrictEqual(primero.dibujos, []);

    const segundo = mapaDePrueba();
    poner(segundo.mapa);
    segundo.pintar();
    await waitFor(() => assert.lengthOf(origen.abiertas(), 1));
    origen.responder(URL_LIMITES, { estado: 200, cuerpo: '{"comunidades":[]}' });
    await otraTarea();
    assert.deepStrictEqual(segundo.dibujos, []);
    assert.deepStrictEqual(origen.pedidas(), [URL_LIMITES, URL_LIMITES]);
  });
});
