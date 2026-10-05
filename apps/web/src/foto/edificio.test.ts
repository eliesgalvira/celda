import type { Coordenada } from "@celda/dominio/area";
import { desdePlano } from "@celda/dominio/plano";
import { assert, describe, it } from "@effect/vitest";

import {
  abreviarPortal,
  areaDelPoligono,
  dibujoDelEdificio,
  type Edificio,
  type EdificioEncontrado,
  edificiosDeRasgo,
  elegirEdificio,
  type Poligono,
  type Portal,
  portalesDeRasgo,
  type RasgoDelMapa,
} from "./edificio.ts";
// Lo que da el mapa a z18,5 alrededor de cada emplazamiento, sacado de las teselas de OpenFreeMap
// (cada fichero dice de cuáles y cómo se ha recortado).
import AYLLON from "./referencia/ayllon-torre.json";
import PASSEIG_DE_GRACIA from "./referencia/barcelona-passeig-de-gracia-68.json";
import SABADELL from "./referencia/entre-teselas.json";
import MADRID from "./referencia/madrid-san-jeronimo-34.json";
import MAJADAHONDA from "./referencia/majadahonda-azotea.json";
import MARTORELL from "./referencia/martorell-caseta.json";

/** Passeig de Gràcia, 68: el emplazamiento de las pruebas sin muestra. */
const SITIO: Coordenada = { longitud: 2.164067, latitud: 41.393547 };

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

const edificio = (poligono: Poligono, altura?: number): Edificio => ({ poligono, altura });
const portal = (numero: string, este: number, norte: number): Portal => ({
  numero,
  punto: a(este, norte),
});

const poligonoDe = (encontrado: EdificioEncontrado): Poligono | undefined =>
  encontrado.tipo === "edificio" ? encontrado.poligono : undefined;
const numeroDe = (encontrado: EdificioEncontrado): string | undefined =>
  encontrado.tipo === "edificio" ? encontrado.portal?.numero : undefined;

describe("elegir el edificio del emplazamiento", () => {
  it("elige el que lo contiene, aunque otro quede más cerca de su borde", () => {
    const suyo = edificio(rectangulo(-30, -30, 2, 30));
    const otro = edificio(rectangulo(3, -10, 20, 10));
    assert.deepStrictEqual(poligonoDe(elegirEdificio(SITIO, [otro, suyo], [])), suyo.poligono);
  });

  it("sin ninguno que lo contenga no elige ninguno, ni el que está a 1 m", () => {
    const vecino = edificio(rectangulo(1, -10, 20, 10));
    assert.deepStrictEqual(elegirEdificio(SITIO, [vecino], [portal("68", 5, 0)]), {
      tipo: "ninguno",
    });
    assert.deepStrictEqual(elegirEdificio(SITIO, [], [portal("68", 1, 1)]), { tipo: "ninguno" });
  });

  it("no resalta un polígono de menos de 30 m², como la caseta de una torre", () => {
    const caseta = edificio(rectangulo(-2.5, -2.5, 2.5, 2.5));
    assert.deepStrictEqual(elegirEdificio(SITIO, [caseta], []), { tipo: "ninguno" });
    const azotea = edificio(rectangulo(-3, -3, 3, 3));
    assert.deepStrictEqual(
      poligonoDe(elegirEdificio(SITIO, [caseta, azotea], [])),
      azotea.poligono,
    );
  });

  it("un emplazamiento en el patio de una manzana no está dentro de ella", () => {
    const manzana = edificio([...rectangulo(-50, -50, 50, 50), ...rectangulo(-40, -40, 40, 40)]);
    assert.deepStrictEqual(elegirEdificio(SITIO, [manzana], []), { tipo: "ninguno" });
  });

  it("entre varios que lo contienen, el más alto y, a igual altura, el más grande", () => {
    const zocalo = edificio(rectangulo(-40, -40, 40, 40), 8);
    const bloque = edificio(rectangulo(-10, -10, 10, 10), 41);
    const parte = edificio(rectangulo(-5, -5, 5, 5), 41);
    assert.deepStrictEqual(
      poligonoDe(elegirEdificio(SITIO, [zocalo, parte, bloque], [])),
      bloque.poligono,
    );
    // Sin alturas, como en el mapa de reserva del IGN, el más grande.
    assert.deepStrictEqual(
      poligonoDe(elegirEdificio(SITIO, [edificio(parte.poligono), edificio(zocalo.poligono)], [])),
      zocalo.poligono,
    );
  });

  it("el número es el del portal dentro del edificio más cercano al emplazamiento", () => {
    // Un edificio de esquina: el registro da «PS GRACIA, 68», y el portal más cercano es otro.
    const esquina = edificio(rectangulo(-30, -30, 30, 30));
    const encontrado = elegirEdificio(
      SITIO,
      [esquina],
      [portal("70", 35, 0), portal("68-72", -25, 20), portal("251-259", 16, -3)],
    );
    assert.deepStrictEqual(encontrado.tipo === "edificio" ? encontrado.portal : undefined, {
      numero: "251-259",
      punto: a(16, -3),
    });
  });

  it("un portal en la fachada es del edificio; uno fuera, a 3 m, no", () => {
    const casa = edificio(rectangulo(-10, -10, 10, 10));
    assert.strictEqual(numeroDe(elegirEdificio(SITIO, [casa], [portal("12", 10.5, 0)])), "12");
    const sinNumero = elegirEdificio(SITIO, [casa], [portal("14", 13, 0)]);
    assert.strictEqual(sinNumero.tipo, "edificio");
    assert.isUndefined(numeroDe(sinNumero));
  });
});

/** Lo que se ve en una muestra de las teselas: los rasgos de los edificios y de los portales. */
interface Muestra {
  readonly posicion: Coordenada;
  readonly edificios: ReadonlyArray<RasgoDelMapa & { readonly poligonosEnLaTesela?: number }>;
  readonly portales: ReadonlyArray<RasgoDelMapa>;
}

const buscar = (muestra: Muestra): EdificioEncontrado =>
  elegirEdificio(
    muestra.posicion,
    muestra.edificios.flatMap(edificiosDeRasgo),
    muestra.portales.flatMap(portalesDeRasgo),
  );

/** Los polígonos de 30 m² o más de la muestra que contienen el emplazamiento, cada uno solo. */
const queLoContienen = (muestra: Muestra): ReadonlyArray<Poligono> =>
  muestra.edificios.flatMap(edificiosDeRasgo).flatMap((uno) => {
    const poligono = poligonoDe(elegirEdificio(muestra.posicion, [uno], []));
    return poligono === undefined ? [] : [poligono];
  });

describe("con las teselas de OpenFreeMap", () => {
  it("en un rasgo con mil edificios juntos, resalta solo el que contiene el emplazamiento", () => {
    // CL Carrera San Jerónimo, 34, en Madrid. Antes se resaltaban los 1.005 polígonos del rasgo.
    const rasgo = MADRID.edificios.find((uno) => uno.id === 303990);
    assert.strictEqual(rasgo?.geometry.type, "MultiPolygon");
    assert.strictEqual(rasgo?.poligonosEnLaTesela, 1005);
    assert.lengthOf(rasgo?.geometry.coordinates ?? [], 8);
    const encontrado = buscar(MADRID);
    assert.deepStrictEqual(poligonoDe(encontrado), rasgo?.geometry.coordinates[0]);
    assert.strictEqual(
      Math.round(areaDelPoligono(MADRID.posicion, poligonoDe(encontrado) ?? [])),
      943,
    );
    const dibujo = dibujoDelEdificio(encontrado);
    assert.deepStrictEqual(
      dibujo.features.map((uno) => uno.geometry.type),
      ["Polygon", "Point"],
    );
  });

  it("toma el número de un MultiPoint, el punto que cae dentro del edificio", () => {
    // El 34 llega en un MultiPoint con los ocho portales con ese número de la tesela.
    const treintaYCuatro = MADRID.portales.find((uno) => uno.properties.housenumber === "34");
    assert.strictEqual(treintaYCuatro?.geometry.type, "MultiPoint");
    assert.lengthOf(treintaYCuatro?.geometry.coordinates ?? [], 8);
    assert.strictEqual(numeroDe(buscar(MADRID)), "34");
  });

  it("sin portal dentro del edificio, va sin número aunque haya portales en la acera", () => {
    // Majadahonda: el 10 y el 6 están en la calle, a 7 y 9 m del edificio. Cuál es el suyo, si es
    // alguno, no se sabe.
    const encontrado = buscar(MAJADAHONDA);
    assert.strictEqual(encontrado.tipo, "edificio");
    assert.isUndefined(numeroDe(encontrado));
  });

  it("no resalta la caseta de 16 m² de una torre", () => {
    // Martorell: la caseta, al pie de la torre, es lo único dibujado en el punto.
    const [caseta] = MARTORELL.edificios.flatMap(edificiosDeRasgo);
    assert.strictEqual(Math.round(areaDelPoligono(MARTORELL.posicion, caseta?.poligono ?? [])), 16);
    assert.deepStrictEqual(buscar(MARTORELL), { tipo: "ninguno" });
  });

  it("no resalta el edificio vecino de una torre en el campo", () => {
    // Ayllón: el edificio más cercano, a 5 m, es de otro.
    assert.deepStrictEqual(buscar(AYLLON), { tipo: "ninguno" });
  });

  it("de un edificio partido entre teselas, el trozo más entero", () => {
    // Passeig de Gràcia, 68 cae cerca de la esquina de cuatro teselas, y cada una da su trozo del
    // edificio de la esquina, cortado un poco más allá de su borde. El de 2.294 m² cabe entero en
    // una tesela.
    const areas = queLoContienen(PASSEIG_DE_GRACIA).map((trozo) =>
      Math.round(areaDelPoligono(PASSEIG_DE_GRACIA.posicion, trozo)),
    );
    assert.isAbove(areas.length, 2);
    const encontrado = buscar(PASSEIG_DE_GRACIA);
    const elegido = poligonoDe(encontrado) ?? [];
    assert.strictEqual(Math.round(areaDelPoligono(PASSEIG_DE_GRACIA.posicion, elegido)), 2294);
    assert.strictEqual(Math.max(...areas), 2294);
    assert.strictEqual(numeroDe(encontrado), "251-259");
  });

  it("gana el más alto aunque los trozos de otro más bajo sean más grandes", () => {
    // Sabadell: una nave de 4 m, partida entre dos teselas, y un bloque de 22 m dibujado encima.
    const trozos = queLoContienen(SABADELL);
    assert.lengthOf(trozos, 3);
    const alto = SABADELL.edificios.find((uno) => uno.properties.render_height === 22);
    assert.deepStrictEqual(poligonoDe(buscar(SABADELL)), alto?.geometry.coordinates[0]);
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
  it("lleva el polígono y el número en su punto; sin edificio, nada", () => {
    const esquina = edificio(rectangulo(-30, -30, 30, 30));
    const encontrado = elegirEdificio(SITIO, [esquina], [portal("251-259", 16, -3)]);
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
  it("separa un multipolígono en un edificio por polígono, con la altura del rasgo", () => {
    const [anillo = []] = rectangulo(0, 0, 10, 10);
    const [otro = []] = rectangulo(20, 0, 30, 10);
    assert.deepStrictEqual(
      edificiosDeRasgo({
        id: 3,
        properties: { render_height: 12 },
        geometry: { type: "Polygon", coordinates: [anillo] },
      }),
      [{ poligono: [anillo], altura: 12 }],
    );
    assert.deepStrictEqual(
      edificiosDeRasgo({
        id: 4,
        properties: {},
        geometry: { type: "MultiPolygon", coordinates: [[anillo], [otro]] },
      }),
      [
        { poligono: [anillo], altura: undefined },
        { poligono: [otro], altura: undefined },
      ],
    );
    assert.deepStrictEqual(
      edificiosDeRasgo({ properties: {}, geometry: { type: "Point", coordinates: [2, 41] } }),
      [],
    );
  });

  it("lee portales de puntos y de multipuntos, con su número abreviado", () => {
    assert.deepStrictEqual(
      portalesDeRasgo({
        properties: { housenumber: "1,3,5" },
        geometry: { type: "Point", coordinates: [2.1, 41.3] },
      }),
      [{ numero: "1–5", punto: { longitud: 2.1, latitud: 41.3 } }],
    );
    assert.deepStrictEqual(
      portalesDeRasgo({
        properties: { housenumber: 34 },
        geometry: {
          type: "MultiPoint",
          coordinates: [
            [2.1, 41.3],
            [2.2, 41.4],
          ],
        },
      }),
      [
        { numero: "34", punto: { longitud: 2.1, latitud: 41.3 } },
        { numero: "34", punto: { longitud: 2.2, latitud: 41.4 } },
      ],
    );
    // El mapa base de reserva del IGN da el número en `ref`.
    assert.deepStrictEqual(
      portalesDeRasgo({
        properties: { ref: "10 B" },
        geometry: { type: "Point", coordinates: [2.1, 41.3] },
      }),
      [{ numero: "10 B", punto: { longitud: 2.1, latitud: 41.3 } }],
    );
    assert.deepStrictEqual(
      portalesDeRasgo({ properties: {}, geometry: { type: "Point", coordinates: [2.1, 41.3] } }),
      [],
    );
  });
});
