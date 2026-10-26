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
        radioMetros: 1000,
        radioSinUnidad: false,
        limite: 20,
        companias: [],
      }),
    );
  });

  it("lee radio, límite y compañías, sin repetirlas y sin mirar mayúsculas", () => {
    assert.deepStrictEqual(
      leer("lon=2.17&lat=41.38&radio=250m&limite=50&compania=Orange, digi,orange"),
      Result.succeed({
        latitud: 41.38,
        longitud: 2.17,
        radioMetros: 250,
        radioSinUnidad: false,
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
      mensaje("lat=40&lon=-3&color=rojo"),
      "El parámetro «color» no existe. Se aceptan lat, lon, radio, compania y limite.",
    );
  });

  it("a un parámetro desconocido parecido a uno que existe le sugiere el bueno", () => {
    assert.strictEqual(
      mensaje("lat=40&lon=-3&radius=500m"),
      "El parámetro «radius» no existe. Se aceptan lat, lon, radio, compania y limite. ¿Querías decir «radio»?",
    );
    assert.strictEqual(
      mensaje("lat=40&lon=-3&companias=orange"),
      "El parámetro «companias» no existe. Se aceptan lat, lon, radio, compania y limite. ¿Querías decir «compania»?",
    );
  });

  it("explica que no hay filtro por municipio ni por provincia", () => {
    assert.strictEqual(
      mensaje("lat=40&lon=-3&municipio=Madrid"),
      "El parámetro «municipio» no existe. Se aceptan lat, lon, radio, compania y limite. No hay filtro por municipio: se busca alrededor de un punto, con lat y lon.",
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

  it("lee el radio sin unidad como metros, y con unidad en metros o kilómetros", () => {
    const radio = (valor: string) => {
      const leida = leer(`lat=40&lon=-3&radio=${valor}`);
      return Result.isSuccess(leida)
        ? [leida.success.radioMetros, leida.success.radioSinUnidad]
        : leida.failure.mensaje;
    };
    assert.deepStrictEqual(radio("10000"), [10_000, true]);
    assert.deepStrictEqual(radio("15"), [15, true]);
    assert.deepStrictEqual(radio("1500m"), [1500, false]);
    assert.deepStrictEqual(radio("1.5km"), [1500, false]);
    assert.deepStrictEqual(radio("15KM"), [15_000, false]);
    assert.deepStrictEqual(radio("15 km"), [15_000, false]);
    assert.deepStrictEqual(radio("12.6"), [13, true]);
  });

  it("rechaza un radio que no es una distancia, o fuera de 1 m a 50 km", () => {
    const radio =
      "radio tiene que ser una distancia en metros (1500) o con su unidad (1500m o 1.5km), de 1 m a 50km.";
    assert.strictEqual(mensaje("lat=40&lon=-3&radio=1,5km"), radio);
    assert.strictEqual(mensaje("lat=40&lon=-3&radio=15 millas"), radio);
    assert.strictEqual(mensaje("lat=40&lon=-3&radio=-5"), radio);
    assert.strictEqual(mensaje("lat=40&lon=-3&radio=50.001km"), radio);
    assert.strictEqual(mensaje("lat=40&lon=-3&radio=50001"), radio);
    assert.strictEqual(mensaje("lat=40&lon=-3&radio=0"), radio);
    assert.strictEqual(mensaje("lat=40&lon=-3&radio=0.0004km"), radio);
    assert.strictEqual(mensaje("lat=40&lon=-3&radio=50000"), "aceptada");
    assert.strictEqual(mensaje("lat=40&lon=-3&radio=50km"), "aceptada");
  });

  it("limita el límite a 50", () => {
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
