import {
  PARAMETROS_POR_DEFECTO,
  resolverEjercicio,
  type ResultadoDeCompania,
} from "@celda/dominio/ejercicio";
import { assert, describe, it } from "@effect/vitest";

import { cadenaDelRadio, cadenaDeUsuarios } from "./textos.ts";

const RESULTADO = resolverEjercicio({
  habitantes: 10_000,
  areaKm2: 1,
  enZona: [
    { clave: "a", posicion: { longitud: 2.16, latitud: 41.39 }, companias: ["orange"] },
    { clave: "b", posicion: { longitud: 2.17, latitud: 41.39 }, companias: ["yoigo", "movistar"] },
  ],
  todos: [],
  bandas: new Map(),
  parametros: PARAMETROS_POR_DEFECTO,
});

const de = (compania: string): ResultadoDeCompania => {
  const encontrado = RESULTADO.companias.find((c) => c.compania === compania);
  if (encontrado === undefined) throw new Error(compania);
  return encontrado;
};

describe("cadenas del ejercicio", () => {
  it("sin otra estación de la compañía, el radio lo dice en lugar de inventarlo", () => {
    const [, distancia, radio] = cadenaDelRadio(de("movistar"));
    assert.strictEqual(distancia?.valor, "—");
    assert.strictEqual(
      distancia?.fuente,
      "Movistar no tiene ninguna otra estación base en el mapa",
    );
    assert.strictEqual(radio?.valor, "—");
  });

  it("Orange y Yoigo reparten sus líneas entre las estaciones de las dos", () => {
    const pasos = cadenaDeUsuarios(RESULTADO, "yoigo", PARAMETROS_POR_DEFECTO, "CNMC");
    assert.deepStrictEqual(
      pasos.map((p) => p.valor),
      ["10.000", "12.830", "5209", "2604"],
    );
    assert.strictEqual(pasos[2]?.etiqueta, "Líneas de Orange y Yoigo");
    assert.strictEqual(pasos[3]?.operacion, "÷ 2 estaciones base de Orange y Yoigo en la zona");
  });

  it("sin habitantes en el padrón lo dice en lugar de dividir por cero", () => {
    const sinPadron = resolverEjercicio({
      habitantes: null,
      areaKm2: 1,
      enZona: [{ clave: "a", posicion: { longitud: 2.16, latitud: 41.39 }, companias: ["digi"] }],
      todos: [],
      bandas: new Map(),
      parametros: PARAMETROS_POR_DEFECTO,
    });
    const pasos = cadenaDeUsuarios(sinPadron, "digi", PARAMETROS_POR_DEFECTO, "CNMC");
    assert.deepStrictEqual(
      pasos.map((p) => p.valor),
      ["—", "—", "—", "—"],
    );
    assert.strictEqual(pasos[0]?.fuente, "El padrón aún no tiene esta zona");
    assert.strictEqual(
      pasos[3]?.fuente,
      "Faltan los habitantes de la zona para repartir las líneas",
    );
  });
});
