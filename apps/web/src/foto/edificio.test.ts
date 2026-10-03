import type { Coordenada } from "@celda/dominio/area";
import { desdePlano } from "@celda/dominio/plano";
import { assert, describe, it } from "@effect/vitest";

import {
  abreviarPortal,
  dibujoDelEdificio,
  type Edificio,
  edificioDeRasgo,
  elegirEdificio,
  type Poligono,
  type Portal,
  portalDeRasgo,
} from "./edificio.ts";

/** Passeig de Gràcia, 68: el emplazamiento de las pruebas. */
const SITIO: Coordenada = { longitud: 2.16395, latitud: 41.39385 };

/** Un punto a tantos metros al este y al norte del emplazamiento. */
const a = (este: number, norte: number): Coordenada => desdePlano(SITIO, { este, norte });
const posicion = (este: number, norte: number) => {
  const { longitud, latitud } = a(este, norte);
  return [longitud, latitud];
};

/** Un rectángulo de este a este y de norte a norte, en metros desde el emplazamiento. */
const rectangulo = (oeste: number, sur: number, este: number, norte: number): Poligono => [
  [
    posicion(oeste, sur),
    posicion(este, sur),
    posicion(este, norte),
    posicion(oeste, norte),
    posicion(oeste, sur),
  ],
];

const edificio = (id: number, ...poligonos: ReadonlyArray<Poligono>): Edificio => ({
  id,
  poligonos,
});
const portal = (numero: string, este: number, norte: number): Portal => ({
  numero,
  punto: a(este, norte),
});

describe("elegir el edificio del emplazamiento", () => {
  it("elige el que lo contiene, aunque otro quede más cerca de su borde", () => {
    const suyo = edificio(1, rectangulo(-30, -30, 2, 30));
    const otro = edificio(2, rectangulo(3, -10, 20, 10));
    const encontrado = elegirEdificio(SITIO, [otro, suyo], []);
    assert.strictEqual(encontrado.tipo, "edificio");
    assert.deepStrictEqual(
      encontrado.tipo === "edificio" ? encontrado.poligonos : [],
      suyo.poligonos,
    );
    assert.strictEqual(encontrado.tipo === "edificio" ? encontrado.como : undefined, "contiene");
  });

  it("sin ninguno que lo contenga, el más cercano a menos de 25 m; más lejos, ninguno", () => {
    const cerca = edificio(1, rectangulo(10, -5, 30, 5));
    const lejos = edificio(2, rectangulo(-60, -5, -40, 5));
    const encontrado = elegirEdificio(SITIO, [lejos, cerca], []);
    assert.strictEqual(encontrado.tipo === "edificio" ? encontrado.como : undefined, "cerca");
    assert.deepStrictEqual(
      encontrado.tipo === "edificio" ? encontrado.poligonos : [],
      cerca.poligonos,
    );

    assert.deepStrictEqual(elegirEdificio(SITIO, [lejos], []), { tipo: "ninguno" });
    assert.deepStrictEqual(elegirEdificio(SITIO, [edificio(3, rectangulo(26, -5, 40, 5))], []), {
      tipo: "ninguno",
    });
    assert.deepStrictEqual(elegirEdificio(SITIO, [], [portal("68", 1, 1)]), { tipo: "ninguno" });
  });

  it("mide hasta el borde y no hasta las esquinas: un lado largo a 10 m está cerca", () => {
    // Las esquinas quedan a más de 25 m; el lado de enfrente, a 10.
    const largo = edificio(1, rectangulo(10, -100, 20, 100));
    assert.strictEqual(elegirEdificio(SITIO, [largo], []).tipo, "edificio");
  });

  it("un emplazamiento en el patio de una manzana no está dentro de ella", () => {
    const manzana = edificio(1, [...rectangulo(-50, -50, 50, 50), ...rectangulo(-40, -40, 40, 40)]);
    const encontrado = elegirEdificio(SITIO, [manzana], []);
    assert.strictEqual(encontrado.tipo, "ninguno");
  });

  it("junta los trozos del edificio que llegan partidos entre dos teselas", () => {
    const oeste = edificio(7, rectangulo(-20, -10, 0.5, 10));
    const este = edificio(7, rectangulo(0.5, -10, 20, 10));
    const vecino = edificio(8, rectangulo(21, -10, 40, 10));
    const encontrado = elegirEdificio(SITIO, [vecino, oeste, este], []);
    assert.deepStrictEqual(encontrado.tipo === "edificio" ? encontrado.poligonos : [], [
      ...oeste.poligonos,
      ...este.poligonos,
    ]);
  });

  it("el número es el del portal del propio edificio, aunque el de otra calle quede más cerca", () => {
    // Un edificio de esquina: el registro da «PS GRACIA, 68», y el portal del edificio es otro.
    const esquina = edificio(1, rectangulo(-30, -30, 30, 30));
    const encontrado = elegirEdificio(
      SITIO,
      [esquina],
      [portal("70", 35, 0), portal("251-259", -25, 20), portal("261", -25, 29)],
    );
    assert.deepStrictEqual(encontrado.tipo === "edificio" ? encontrado.portal : undefined, {
      numero: "251-259",
      punto: a(-25, 20),
    });
  });

  it("sin portal dentro, el más cercano a menos de 30 m; si no hay, sin número", () => {
    const sinPortal = edificio(1, rectangulo(-10, -10, 10, 10));
    const conVecino = elegirEdificio(
      SITIO,
      [sinPortal],
      [portal("12", 25, 0), portal("14", 0, 40)],
    );
    assert.strictEqual(conVecino.tipo === "edificio" ? conVecino.portal?.numero : undefined, "12");
    const solo = elegirEdificio(SITIO, [sinPortal], [portal("14", 0, 40)]);
    assert.strictEqual(solo.tipo, "edificio");
    assert.isUndefined(solo.tipo === "edificio" ? solo.portal : "otro");
  });
});

describe("número de portal", () => {
  it("de una lista de números deja el primero y el último", () => {
    assert.strictEqual(abreviarPortal("68"), "68");
    assert.strictEqual(abreviarPortal("251-259"), "251-259");
    assert.strictEqual(abreviarPortal("381;383"), "381-383");
    assert.strictEqual(abreviarPortal("381,383,385,387"), "381–387");
    assert.strictEqual(abreviarPortal(" ; "), "");
  });
});

describe("dibujo del edificio", () => {
  it("lleva cada trozo como polígono y el número en su punto; sin edificio, nada", () => {
    const esquina = edificio(1, rectangulo(-30, -30, 30, 30));
    const encontrado = elegirEdificio(SITIO, [esquina], [portal("251-259", -25, 20)]);
    const dibujo = dibujoDelEdificio(encontrado);
    assert.deepStrictEqual(
      dibujo.features.map((rasgo) => rasgo.geometry.type),
      ["Polygon", "Point"],
    );
    assert.deepStrictEqual(dibujo.features[1]?.properties, { numero: "251-259" });
    assert.deepStrictEqual(dibujoDelEdificio({ tipo: "ninguno" }).features, []);
  });
});

describe("rasgos del mapa", () => {
  it("lee polígonos y multipolígonos de edificios, y puntos con número de portal", () => {
    const [anillo] = rectangulo(0, 0, 10, 10);
    assert.deepStrictEqual(
      edificioDeRasgo({
        id: 3,
        properties: {},
        geometry: { type: "Polygon", coordinates: [anillo] },
      }),
      { id: 3, poligonos: [[anillo ?? []]] },
    );
    assert.deepStrictEqual(
      edificioDeRasgo({
        id: 4,
        properties: {},
        geometry: { type: "MultiPolygon", coordinates: [[anillo], [anillo]] },
      })?.poligonos.length,
      2,
    );
    assert.isUndefined(
      edificioDeRasgo({ properties: {}, geometry: { type: "Point", coordinates: [2, 41] } }),
    );
    assert.deepStrictEqual(
      portalDeRasgo({
        properties: { housenumber: "1,3,5" },
        geometry: { type: "Point", coordinates: [2.1, 41.3] },
      }),
      { numero: "1–5", punto: { longitud: 2.1, latitud: 41.3 } },
    );
    assert.isUndefined(
      portalDeRasgo({ properties: {}, geometry: { type: "Point", coordinates: [2.1, 41.3] } }),
    );
  });
});
