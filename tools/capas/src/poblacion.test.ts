import type { LimitesDeBarrios } from "@celda/dominio/barrio";
import { PoblacionDeBarrios } from "@celda/dominio/poblacion";
import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { ficheroDePoblacion, leerCsv, poblacionDeOpenData } from "./poblacion.ts";

const cuadrado = (x: number, y: number, lado: number) => [
  [
    [x, y],
    [x + lado, y],
    [x + lado, y + lado],
    [x, y + lado],
    [x, y],
  ] as const,
];

const LIMITES: LimitesDeBarrios = {
  fuente: {
    atribucion: "Ajuntament de Barcelona",
    licencia: "CC BY 4.0",
    enlace: "https://opendata-ajuntament.barcelona.cat/data/es/dataset/20170706-districtes-barris",
    fecha: "2024-11-12",
  },
  barrios: [
    {
      codigo: "05",
      nombre: "el Fort Pienc",
      etiqueta: { longitud: 2.185, latitud: 41.395 },
      poligonos: [cuadrado(2.18, 41.39, 0.01)],
    },
    {
      codigo: "01",
      nombre: "el Raval",
      etiqueta: { longitud: 2.17, latitud: 41.38 },
      poligonos: [cuadrado(2.165, 41.375, 0.01)],
    },
  ],
};

const FUENTE = {
  atribucion: "Ajuntament de Barcelona",
  licencia: "CC BY 4.0",
  enlace: "https://opendata-ajuntament.barcelona.cat/data/es/dataset/pad_mdbas",
  publicada: "2026-05-28",
};

const CSV = [
  "﻿Data_Referencia,Codi_Districte,Nom_Districte,Codi_Barri,Nom_Barri,AEB,Seccio_Censal,Valor",
  "2026-01-01,1,Ciutat Vella,1,el Raval,1,1001,1423",
  "2026-01-01,1,Ciutat Vella,1,el Raval,1,1002,1410",
  '2026-01-01,2,Eixample,5,"el Fort Pienc, de prova",40,2001,2000',
  "",
].join("\r\n");

const decodificar = Schema.decodeSync(Schema.fromJsonString(PoblacionDeBarrios));

describe("habitantes por barrio del padrón", () => {
  it("lee campos entre comillas con comas dentro", () => {
    const [cabecera, ...filas] = leerCsv(CSV);
    assert.strictEqual(cabecera?.[0], "Data_Referencia");
    assert.lengthOf(filas, 3);
    assert.strictEqual(filas[2]?.[4], "el Fort Pienc, de prova");
  });

  it("suma las secciones censales de cada barrio y pone el área de sus límites", () => {
    const poblacion = Result.getOrThrow(poblacionDeOpenData(CSV, LIMITES, FUENTE));
    assert.deepStrictEqual(
      poblacion.barrios.map((b) => [b.codigo, b.nombre, b.habitantes]),
      [
        ["01", "el Raval", 2833],
        ["05", "el Fort Pienc", 2000],
      ],
    );
    // Un cuadrado de 0,01° a esta latitud mide unos 0,93 km².
    assert.closeTo(poblacion.barrios[0]?.areaKm2 ?? 0, 0.93, 0.01);
    assert.strictEqual(poblacion.fuente.referencia, "2026-01-01");
    assert.deepStrictEqual(poblacion.fuenteDeLimites, LIMITES.fuente);
  });

  it("escribe un fichero que se vuelve a leer igual", () => {
    const poblacion = Result.getOrThrow(poblacionDeOpenData(CSV, LIMITES, FUENTE));
    assert.deepStrictEqual(decodificar(ficheroDePoblacion(poblacion)), poblacion);
  });

  it("no publica un barrio sin habitantes, uno desconocido ni fechas mezcladas", () => {
    const sinFortPienc = CSV.split("\r\n").slice(0, 3).join("\r\n");
    const desconocido = `${CSV}2026-01-01,9,Nou,99,Inventat,1,1,5\r\n`;
    const mezcladas = `${CSV}2025-01-01,1,Ciutat Vella,1,el Raval,1,1003,5\r\n`;
    const sinNumero = `${CSV}2026-01-01,1,Ciutat Vella,1,el Raval,1,1003,..\r\n`;
    for (const [csv, motivo] of [
      [sinFortPienc, /05 el Fort Pienc no tiene habitantes/u],
      [desconocido, /99 no está en los límites/u],
      [mezcladas, /fechas de referencia/u],
      [sinNumero, /no trae un número/u],
    ] as const) {
      const resultado = poblacionDeOpenData(csv, LIMITES, FUENTE);
      assert.isTrue(Result.isFailure(resultado));
      if (Result.isFailure(resultado)) assert.match(resultado.failure.motivo, motivo);
    }
  });
});
