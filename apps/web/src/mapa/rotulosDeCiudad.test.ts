import { assert, describe, it } from "@effect/vitest";

import {
  leerRotulosDeCiudad,
  type MapaConRotulosColocados,
  type RasgoColocado,
} from "./rotulosDeCiudad.ts";

/** Un rasgo de una capa de ciudades como lo devuelve `queryRenderedFeatures`. */
const rasgo = (
  capa: string,
  propiedades: RasgoColocado["properties"],
  longitud: number,
  latitud: number,
): RasgoColocado => ({
  geometry: { type: "Point", coordinates: [longitud, latitud] },
  properties: propiedades,
  layer: { id: capa },
});

const mapaCon = (rasgos: ReadonlyArray<RasgoColocado>, zoom = 8) => {
  const pedidas: Array<ReadonlyArray<string>> = [];
  const mapa: MapaConRotulosColocados = {
    getLayer: () => ({}),
    getZoom: () => zoom,
    queryRenderedFeatures: (opciones) => {
      pedidas.push(opciones.layers);
      return rasgos;
    },
  };
  return { mapa, pedidas };
};

describe("lectura de los rótulos de ciudad colocados", () => {
  it("lee solo las capas de ciudades, cada rótulo una vez aunque salga en dos teselas", () => {
    const { mapa, pedidas } = mapaCon([
      rasgo("lugares-grandes", { name: "Zaragoza", capital: 6 }, -0.88, 41.65),
      rasgo("lugares-grandes", { name: "Zaragoza", capital: 6 }, -0.88, 41.65),
      rasgo("lugares-capitales", { name: "Madrid", capital: 2 }, -3.7, 40.42),
    ]);
    const { zoom, rotulos } = leerRotulosDeCiudad(mapa);
    assert.strictEqual(zoom, 8);
    assert.deepStrictEqual(pedidas, [["lugares-capitales", "lugares-grandes", "lugares-ciudades"]]);
    assert.deepStrictEqual(
      rotulos.map((r) => [r.clave, r.importancia, r.tamano]),
      [
        ["lugares-capitales:Madrid", "capital", 17],
        ["lugares-grandes:Zaragoza", "ciudad", 13.5],
      ],
    );
  });

  it("su texto es el nombre de lugar, en una sola forma según el lado de la Comunitat", () => {
    const { mapa } = mapaCon([
      rasgo(
        "lugares-grandes",
        { name: "Alacant / Alicante", "name:es": "Alicante" },
        -0.481,
        38.345,
      ),
      rasgo(
        "lugares-grandes",
        { name: "Donostia / San Sebastián", "name:es": "San Sebastián" },
        -1.98,
        43.32,
      ),
    ]);
    assert.deepStrictEqual(
      leerRotulosDeCiudad(mapa).rotulos.map((r) => r.texto),
      ["Alacant", "San Sebastián"],
    );
  });
});
