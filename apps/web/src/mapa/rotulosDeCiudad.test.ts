import { assert, describe, it } from "@effect/vitest";

import {
  leerRotulosDeCiudad,
  type MapaConRotulosColocados,
  type RasgoColocado,
  type ZoomsDeCapa,
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

/**
 * Los zooms de las capas de ciudades, como en `rotulos.ts`, con las de lejos del mapa base de
 * reserva, que en una prueba están a la vez que las del principal.
 */
const ZOOMS = new Map<string, ZoomsDeCapa>([
  ["lugares-capitales", { minzoom: 4, maxzoom: 14 }],
  ["lugares-grandes", { minzoom: 4.5, maxzoom: 14 }],
  ["lugares-ciudades", { minzoom: 7, maxzoom: 14 }],
  ["lugares-capitales-lejos", { minzoom: 4, maxzoom: 7 }],
  ["lugares-grandes-lejos", { minzoom: 4.5, maxzoom: 7 }],
]);

const mapaCon = (rasgos: ReadonlyArray<RasgoColocado>, zoom = 8) => {
  const pedidas: Array<ReadonlyArray<string>> = [];
  const mapa: MapaConRotulosColocados = {
    getLayer: (id) => ZOOMS.get(id) ?? {},
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

  it("solo pregunta por las capas que se ven a su zoom, y de cerca no pregunta", () => {
    const lejos = mapaCon([], 5);
    leerRotulosDeCiudad(lejos.mapa);
    assert.deepStrictEqual(lejos.pedidas, [
      ["lugares-capitales", "lugares-grandes", "lugares-capitales-lejos", "lugares-grandes-lejos"],
    ]);
    const cerca = mapaCon([rasgo("lugares-grandes", { name: "Zaragoza" }, -0.88, 41.65)], 14);
    assert.deepStrictEqual(leerRotulosDeCiudad(cerca.mapa), { zoom: 14, rotulos: [] });
    assert.deepStrictEqual(cerca.pedidas, []);
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

  it("con el mapa base de reserva del IGN, lee su nombre oficial y su clase", () => {
    const { mapa } = mapaCon([
      rasgo("lugares-capitales-lejos", { nombre: "Madrid", clase: "capital_estado" }, -3.7, 40.42),
      rasgo(
        "lugares-grandes",
        { nombre: "Alacant/Alicante", clase: "capital_provincia" },
        -0.48,
        38.35,
      ),
    ]);
    assert.deepStrictEqual(
      leerRotulosDeCiudad(mapa).rotulos.map((r) => [r.texto, r.importancia, r.tamano]),
      [
        ["Madrid", "capital", 17],
        ["Alacant", "ciudad", 13.5],
      ],
    );
  });
});
