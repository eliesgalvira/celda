import { assert, describe, it } from "@effect/vitest";

import type { Poligono } from "./barrio.ts";
import type { ZonaBarrida } from "./cobertura.ts";
import {
  buscarZonas,
  type IndiceDeZonas,
  municipiosDelIndice,
  normalizar,
  provinciaDeZona,
  provinciasDelPunto,
  zonaCubierta,
  zonaDeCodigo,
  type ZonaNombrada,
} from "./zonaDelEjercicio.ts";

const INDICE: IndiceDeZonas = {
  fuente: {
    atribucion: "Instituto Geográfico Nacional",
    producto: "Base de Datos de Límites Jurisdiccionales de España",
    licencia: "CC BY 4.0",
    enlace: "https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml",
    fecha: "2026-08-10",
    huella: "sha256:prueba",
  },
  toleranciaMetros: 200,
  provincias: [
    { codigo: "08", nombre: "Barcelona", caja: [1.36, 41.19, 2.78, 42.33] },
    { codigo: "17", nombre: "Girona", caja: [1.72, 41.65, 3.33, 42.5] },
    { codigo: "42", nombre: "Soria", caja: [-3.54, 41.05, -1.77, 42.15] },
    { codigo: "03", nombre: "Alacant/Alicante", caja: [-1.09, 37.84, 0.24, 38.92] },
    { codigo: "20", nombre: "Gipuzkoa", caja: [-2.61, 42.89, -1.73, 43.4] },
  ],
  municipios: [
    ["08019", "Barcelona"],
    ["08101", "L'Hospitalet de Llobregat"],
    ["08284", "Tordera"],
    ["17079", "Girona"],
    ["17094", "Llívia"],
    ["42173", "Soria"],
    ["42071", "Fuentepinilla"],
    ["03014", "Alacant/Alicante"],
    ["03065", "Elx/Elche"],
    ["20069", "Donostia/San Sebastián"],
  ],
};

const MUNICIPIOS = municipiosDelIndice(INDICE);

const nombres = (zonas: ReadonlyArray<ZonaNombrada>) => zonas.map((z) => z.nombre);

describe("zona del ejercicio", () => {
  it("un código de dos cifras es un barrio de Barcelona y uno de cinco, un municipio", () => {
    assert.deepStrictEqual(zonaDeCodigo("21"), { tipo: "barrio", codigo: "21" });
    assert.deepStrictEqual(zonaDeCodigo("17094"), { tipo: "municipio", codigo: "17094" });
    assert.isUndefined(zonaDeCodigo(""));
    assert.isUndefined(zonaDeCodigo("0801"));
    assert.isUndefined(zonaDeCodigo("Pedralbes"));
    assert.strictEqual(provinciaDeZona({ tipo: "barrio", codigo: "21" }), "08");
    assert.strictEqual(provinciaDeZona({ tipo: "municipio", codigo: "42173" }), "42");
  });

  it("los municipios del índice llevan el nombre de su provincia", () => {
    assert.deepStrictEqual(MUNICIPIOS[3], {
      zona: { tipo: "municipio", codigo: "17079" },
      nombre: "Girona",
      lugar: "Girona",
      oficial: "Girona",
    });
  });

  it("un oficial bilingüe se ve con su nombre de lugar y se encuentra por cualquier forma", () => {
    assert.deepStrictEqual(MUNICIPIOS.at(-2), {
      zona: { tipo: "municipio", codigo: "03065" },
      nombre: "Elx",
      lugar: "Alacant",
      oficial: "Elx/Elche",
    });
    assert.deepStrictEqual(nombres(buscarZonas("elche", MUNICIPIOS)), ["Elx"]);
    assert.deepStrictEqual(nombres(buscarZonas("elx", MUNICIPIOS)), ["Elx"]);
    assert.deepStrictEqual(nombres(buscarZonas("alicante", MUNICIPIOS)), ["Alacant"]);
    assert.deepStrictEqual(nombres(buscarZonas("donostia", MUNICIPIOS)), ["San Sebastián"]);
    assert.deepStrictEqual(nombres(buscarZonas("san sebastian", MUNICIPIOS)), ["San Sebastián"]);
  });

  it("busca sin tildes, mayúsculas ni apóstrofos", () => {
    assert.strictEqual(normalizar("L'Hospitalet de Llobregat"), "l hospitalet de llobregat");
    assert.deepStrictEqual(nombres(buscarZonas("hospitalet", MUNICIPIOS)), [
      "L'Hospitalet de Llobregat",
    ]);
    assert.deepStrictEqual(nombres(buscarZonas("LLIVIA", MUNICIPIOS)), ["Llívia"]);
    assert.deepStrictEqual(nombres(buscarZonas("  ", MUNICIPIOS)), []);
  });

  it("primero el nombre igual, luego el que empieza así y luego el que lo contiene", () => {
    const zonas: ReadonlyArray<ZonaNombrada> = [
      ...MUNICIPIOS,
      { zona: { tipo: "barrio", codigo: "01" }, nombre: "el Raval", lugar: "Barrio de Barcelona" },
    ];
    // «Girona» es el municipio; los de la provincia de Girona van después, por su provincia.
    assert.deepStrictEqual(nombres(buscarZonas("girona", zonas)), ["Girona", "Llívia"]);
    assert.deepStrictEqual(nombres(buscarZonas("rav", zonas)), ["el Raval"]);
    assert.deepStrictEqual(nombres(buscarZonas("barcelona", zonas)), [
      "Barcelona",
      "Tordera",
      "el Raval",
      "L'Hospitalet de Llobregat",
    ]);
    assert.lengthOf(buscarZonas("a", zonas, 3), 3);
  });

  it("las provincias de un punto son las de caja que lo contiene", () => {
    // Entre Barcelona y Girona, cerca de Tordera, las dos cajas se solapan.
    assert.deepStrictEqual(provinciasDelPunto(INDICE, { longitud: 2.72, latitud: 41.7 }), [
      "08",
      "17",
    ]);
    assert.deepStrictEqual(provinciasDelPunto(INDICE, { longitud: -2.47, latitud: 41.76 }), ["42"]);
    assert.deepStrictEqual(provinciasDelPunto(INDICE, { longitud: -8, latitud: 43 }), []);
  });

  it("una zona está cubierta si todo su límite cae en lo barrido", () => {
    const cuadrado = (oeste: number, sur: number, lado: number): Poligono => [
      [
        [oeste, sur],
        [oeste + lado, sur],
        [oeste + lado, sur + lado],
        [oeste, sur + lado],
      ],
    ];
    const cataluna: ZonaBarrida = {
      nombre: "cataluna",
      titulo: "Cataluña",
      cajas: [
        [2, 41, 3, 42],
        [1, 41, 2, 42],
      ],
      barrido: 1,
    };
    assert.isTrue(zonaCubierta([cuadrado(1.9, 41.5, 0.2)], [cataluna]));
    assert.isFalse(zonaCubierta([cuadrado(0.9, 41.5, 0.2)], [cataluna]));
    // Una zona de barrido que aún no ha acabado ningún barrido no cubre nada.
    assert.isFalse(zonaCubierta([cuadrado(1.9, 41.5, 0.2)], [{ ...cataluna, barrido: null }]));
    assert.isFalse(zonaCubierta([], [cataluna]));
  });
});
