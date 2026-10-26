import type { EmplazamientoLeido } from "@celda/dominio/capa";
import { mascarasDeFiltro } from "@celda/dominio/filtro";
import { assert, describe, it } from "@effect/vitest";

import type { Elemento, Escena } from "../capa/agrupacion.ts";
import { puntosDePrueba, resumenDePrueba } from "../capa/pruebas.ts";
import { posicionesDelVuelo } from "./vuelo.ts";

const emplazamiento = (
  clave: string,
  longitud: number,
  companias: EmplazamientoLeido["companias"],
): EmplazamientoLeido => ({
  clave,
  posicion: { longitud, latitud: 41.4 },
  estado: "verificado",
  companias,
  barrio: null,
  lote: 0,
  provincia: "08",
  municipio: null,
});

const UNO = emplazamiento("uno", 2.1, ["movistar"]);
const DOS = emplazamiento("dos", 2.2, ["vodafone"]);
const LEJOS = emplazamiento("lejos", 3.5, ["movistar"]);
const PUNTOS = puntosDePrueba([{ codigo: "08", emplazamientos: [UNO, DOS, LEJOS] }]).puntos;
const CAJA = {
  suroeste: { longitud: 2, latitud: 41 },
  noreste: { longitud: 3, latitud: 42 },
};
const RESUMEN = resumenDePrueba({
  version: "sitios@2026-10-08T02:00:00Z",
  fecha: 0,
  emplazamientos: [],
  barrios: [],
  fuenteDeBarrios: { atribucion: "", licencia: "", enlace: "", fecha: "" },
});
const BARCELONA = RESUMEN.provincias[0] ?? assert.fail("sin Barcelona");

/** Las posiciones de un vuelo, en pares de longitud y latitud de Mercator, redondeadas. */
const pares = (datos: Float32Array) =>
  Array.from({ length: datos.length / 2 }, (_, i) => [
    Math.round((datos[2 * i] ?? 0) * 1e6),
    Math.round((datos[2 * i + 1] ?? 0) * 1e6),
  ]);

const mercatorX = (longitud: number) => Math.round(((longitud + 180) / 360) * 1e6);

describe("hacia dónde vuela cada punto al cambiar de vista", () => {
  it("de lejos, al hexágono de su provincia; los de fuera de la vista no vuelan", () => {
    const hexagono: Elemento = {
      tipo: "provincia",
      clave: "p:08",
      posicion: { longitud: 2.5, latitud: 41.8 },
      provincia: BARCELONA,
      carga: "resumen",
      cuantos: 3,
      deLaRed: 0,
    };
    const escena: Escena = { nivel: 6, elementos: new Map([[hexagono.clave, hexagono]]) };
    const { desde, hasta } = posicionesDelVuelo(
      PUNTOS,
      escena,
      () => [],
      CAJA,
      mascarasDeFiltro([]),
    );
    assert.deepStrictEqual(
      pares(desde)
        .map(([x]) => x)
        .toSorted(),
      [mercatorX(2.1), mercatorX(2.2)],
    );
    assert.deepStrictEqual(
      pares(hasta).map(([x]) => x),
      [mercatorX(2.5), mercatorX(2.5)],
    );
  });

  it("de cerca, a su agrupación o a su logo; con un filtro, solo los que salen", () => {
    const agrupacion: Elemento = {
      tipo: "agrupacion",
      clave: "a:08:1",
      posicion: { longitud: 2.15, latitud: 41.4 },
      cuantos: 2,
    };
    const escena: Escena = { nivel: 12, elementos: new Map([[agrupacion.clave, agrupacion]]) };
    const vuelo = (filtro: Parameters<typeof mascarasDeFiltro>[0]) =>
      posicionesDelVuelo(PUNTOS, escena, () => [UNO, DOS], CAJA, mascarasDeFiltro(filtro));
    assert.deepStrictEqual(
      pares(vuelo([]).hasta).map(([x]) => x),
      [mercatorX(2.15), mercatorX(2.15)],
    );
    assert.deepStrictEqual(
      pares(vuelo(["vodafone"]).desde).map(([x]) => x),
      [mercatorX(2.2)],
    );
  });
});
