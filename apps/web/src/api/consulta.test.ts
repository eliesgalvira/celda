import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import { leerConsulta } from "./consulta.ts";

const leer = (busqueda: string) => leerConsulta(new URLSearchParams(busqueda));

const mensaje = (busqueda: string): string => {
  const leida = leer(busqueda);
  return Result.isFailure(leida) ? leida.failure.mensaje : "aceptada";
};

describe("consulta de emplazamientos cercanos", () => {
  it("sin radio, límite ni compañía, usa 1 km, 20 resultados y todas las compañías", () => {
    assert.deepStrictEqual(
      leer("lat=40.41693&lon=-3.70358"),
      Result.succeed({
        latitud: 40.41693,
        longitud: -3.70358,
        radio: 1000,
        limite: 20,
        companias: [],
      }),
    );
  });

  it("lee radio, límite y compañías, sin repetirlas y sin mirar mayúsculas", () => {
    assert.deepStrictEqual(
      leer("lon=2.17&lat=41.38&radio=250&limite=50&compania=Orange, digi,orange"),
      Result.succeed({
        latitud: 41.38,
        longitud: 2.17,
        radio: 250,
        limite: 50,
        companias: ["orange", "digi"],
      }),
    );
  });

  it("pide lat y lon", () => {
    assert.strictEqual(
      mensaje("lat=40"),
      "Faltan lat y lon: el punto desde el que buscar, en grados decimales.",
    );
  });

  it("rechaza un parámetro desconocido en lugar de ignorarlo", () => {
    assert.strictEqual(
      mensaje("lat=40&lon=-3&radius=500"),
      "El parámetro «radius» no existe. Se aceptan lat, lon, radio, compania y limite.",
    );
  });

  it("rechaza un parámetro repetido", () => {
    assert.strictEqual(
      mensaje("lat=40&lon=-3&compania=digi&compania=orange"),
      "El parámetro «compania» va más de una vez. Para varias compañías, sepáralas con comas.",
    );
  });

  it("rechaza coordenadas fuera de rango o que no son números", () => {
    const lat = "lat tiene que ser la latitud en grados decimales, entre -90 y 90.";
    assert.strictEqual(mensaje("lat=91&lon=0"), lat);
    assert.strictEqual(mensaje("lat=40,4&lon=0"), lat);
    assert.strictEqual(mensaje("lat=&lon=0"), lat);
    assert.strictEqual(
      mensaje("lat=40&lon=-181"),
      "lon tiene que ser la longitud en grados decimales, entre -180 y 180.",
    );
  });

  it("limita el radio a 10 km y el límite a 50, en números enteros", () => {
    const radio = "radio tiene que ser un número entero de metros, de 1 a 10000.";
    assert.strictEqual(mensaje("lat=40&lon=-3&radio=10001"), radio);
    assert.strictEqual(mensaje("lat=40&lon=-3&radio=0"), radio);
    assert.strictEqual(mensaje("lat=40&lon=-3&radio=12.5"), radio);
    assert.strictEqual(mensaje("lat=40&lon=-3&radio=10000"), "aceptada");
    assert.strictEqual(
      mensaje("lat=40&lon=-3&limite=51"),
      "limite tiene que ser un número entero de 1 a 50.",
    );
  });

  it("rechaza una compañía que Celda no conoce", () => {
    assert.strictEqual(
      mensaje("lat=40&lon=-3&compania=movistar,jazztel"),
      "compania tiene que ser una o varias de movistar, vodafone, orange, digi, yoigo, separadas por comas.",
    );
  });
});
