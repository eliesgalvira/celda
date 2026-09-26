import { assert, describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import type { LimiteDeBarrio, LimitesDeBarrios } from "./barrio.ts";
import {
  type EmplazamientoDeCapa,
  fechaDeVersion,
  generarCapa,
  leerCapa,
  versionDeCabecera,
  versionDeCapa,
} from "./capa.ts";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15, 3, 456);

const PLAZA_PIUS_XII: EmplazamientoDeCapa = {
  clave: "movistar-0802532",
  posicion: { longitud: 2.12296712345, latitud: 41.38603198765 },
  estado: "verificado",
  // Desordenadas a propósito: la capa las devuelve en su orden fijo.
  companias: ["vodafone", "orange", "movistar"],
  // De Orange no se conoce ninguna banda.
  bandas: [
    { compania: "vodafone", mhz: [2600] },
    { compania: "movistar", mhz: [3500, 800, 1800] },
  ],
};
const CAMPUS_NORD: EmplazamientoDeCapa = {
  clave: "orange-CATR0228A",
  posicion: { longitud: 2.113412, latitud: 41.389278 },
  estado: "corregido",
  companias: ["orange"],
};
const NUEVO: EmplazamientoDeCapa = {
  clave: "digi-0800143",
  posicion: { longitud: 2.096728, latitud: 41.36731 },
  estado: "nuevo",
  companias: ["digi", "yoigo"],
  bandas: [
    { compania: "yoigo", mhz: [700, 800, 900, 1800, 2100, 2600, 3500] },
    { compania: "digi", mhz: [700] },
  ],
};

/** Un barrio rectangular entre dos esquinas, con la etiqueta en medio. */
const rectangulo = (
  codigo: string,
  nombre: string,
  [oeste, sur]: readonly [number, number],
  [este, norte]: readonly [number, number],
): LimiteDeBarrio => ({
  codigo,
  nombre,
  etiqueta: { longitud: (oeste + este) / 2, latitud: (sur + norte) / 2 },
  poligonos: [
    [
      [
        [oeste, sur],
        [este, sur],
        [este, norte],
        [oeste, norte],
      ],
    ],
  ],
});

// Dos barrios vecinos con el lado x = 2,12 en común. NUEVO cae fuera de los dos.
const LIMITES: LimitesDeBarrios = {
  fuente: {
    atribucion: "Ajuntament de Barcelona",
    licencia: "CC BY 4.0",
    enlace: "https://opendata-ajuntament.barcelona.cat/data/es/dataset/20170706-districtes-barris",
    fecha: "2024-11-12",
  },
  barrios: [
    rectangulo("21", "Pedralbes", [2.1, 41.385], [2.12, 41.395]),
    rectangulo("19", "les Corts", [2.12, 41.38], [2.13, 41.39]),
  ],
};

describe("capa de emplazamientos", () => {
  it("la versión es la fecha de la instantánea al segundo, y se puede volver a leer", () => {
    const version = versionDeCapa(NOCHE);
    assert.strictEqual(version, "sitios@2026-09-26T02:15:03Z");
    assert.deepStrictEqual(fechaDeVersion(version), Option.some(Date.UTC(2026, 8, 26, 2, 15, 3)));
    assert.isTrue(Option.isNone(fechaDeVersion("sitios@ayer")));
    assert.isTrue(Option.isNone(fechaDeVersion("2026-09-26T02:15:03Z")));
  });

  it("escribe un JSON por columnas con la versión en el nombre y como primera clave", async () => {
    const capa = generarCapa(NOCHE, [PLAZA_PIUS_XII, CAMPUS_NORD, NUEVO], LIMITES);
    assert.strictEqual(capa.version, "sitios@2026-09-26T02:15:03Z");
    assert.strictEqual(capa.fichero, "sitios@2026-09-26T02:15:03Z.json");
    assert.strictEqual(capa.emplazamientos, 3);
    assert.isTrue(
      capa.contenido.startsWith('{"version":"sitios@2026-09-26T02:15:03Z","formato":3,'),
    );
    await expect(`${capa.contenido}\n`).toMatchFileSnapshot("./referencia/capa-tres.json");
  });

  it("la misma instantánea da siempre los mismos bytes, llegue en el orden que llegue", () => {
    const una = generarCapa(NOCHE, [PLAZA_PIUS_XII, CAMPUS_NORD, NUEVO], LIMITES);
    const otra = generarCapa(NOCHE, [NUEVO, PLAZA_PIUS_XII, CAMPUS_NORD], LIMITES);
    assert.strictEqual(otra.contenido, una.contenido);
    assert.strictEqual(
      generarCapa(NOCHE, [PLAZA_PIUS_XII, CAMPUS_NORD, NUEVO], LIMITES).contenido,
      una.contenido,
    );
    // Otra instantánea es otra versión y otro fichero; la anterior no cambia.
    const siguiente = generarCapa(NOCHE + 86_400_000, [PLAZA_PIUS_XII, CAMPUS_NORD], LIMITES);
    assert.notStrictEqual(siguiente.fichero, una.fichero);
  });

  it("se lee de vuelta con las compañías de un emplazamiento compartido, sus bandas y su barrio", () => {
    const capa = generarCapa(NOCHE, [PLAZA_PIUS_XII, CAMPUS_NORD, NUEVO], LIMITES);
    const leida = leerCapa(capa.contenido, capa.version);
    assert.isTrue(Result.isSuccess(leida));
    if (Result.isFailure(leida)) return;
    assert.strictEqual(leida.success.version, capa.version);
    assert.strictEqual(leida.success.fecha, Date.UTC(2026, 8, 26, 2, 15, 3));
    assert.deepStrictEqual(leida.success.emplazamientos, [
      {
        ...NUEVO,
        bandas: [
          { compania: "digi", mhz: [700] },
          { compania: "yoigo", mhz: [700, 800, 900, 1800, 2100, 2600, 3500] },
        ],
        barrio: null,
      },
      {
        ...PLAZA_PIUS_XII,
        posicion: { longitud: 2.122967, latitud: 41.386032 },
        companias: ["movistar", "vodafone", "orange"],
        bandas: [
          { compania: "movistar", mhz: [800, 1800, 3500] },
          { compania: "vodafone", mhz: [2600] },
        ],
        barrio: "19",
      },
      { ...CAMPUS_NORD, barrio: "21" },
    ]);
    assert.deepStrictEqual(leida.success.barrios, [
      { codigo: "19", nombre: "les Corts", etiqueta: { longitud: 2.125, latitud: 41.385 } },
      { codigo: "21", nombre: "Pedralbes", etiqueta: { longitud: 2.11, latitud: 41.39 } },
    ]);
    assert.deepStrictEqual(leida.success.fuenteDeBarrios, LIMITES.fuente);
  });

  it("los mismos límites en otro orden dan los mismos bytes", () => {
    const una = generarCapa(NOCHE, [PLAZA_PIUS_XII, CAMPUS_NORD], LIMITES);
    const otra = generarCapa(NOCHE, [PLAZA_PIUS_XII, CAMPUS_NORD], {
      ...LIMITES,
      barrios: LIMITES.barrios.toReversed(),
    });
    assert.strictEqual(otra.contenido, una.contenido);
  });

  it("lee una capa del formato 2 sin ninguna banda conocida", () => {
    const capa = generarCapa(NOCHE, [PLAZA_PIUS_XII, CAMPUS_NORD], LIMITES);
    const { bandas: _bandas, ...columnas } = JSON.parse(capa.contenido) as Record<string, unknown>;
    const leida = leerCapa(JSON.stringify({ ...columnas, formato: 2 }), capa.version);
    assert.isTrue(Result.isSuccess(leida));
    if (Result.isFailure(leida)) return;
    assert.deepStrictEqual(
      leida.success.emplazamientos.map((e) => [e.clave, e.bandas]),
      [
        ["movistar-0802532", undefined],
        ["orange-CATR0228A", undefined],
      ],
    );
  });

  it("no da por buena una capa del formato 1, sin barrios", () => {
    const capa = generarCapa(NOCHE, [PLAZA_PIUS_XII], LIMITES);
    const anterior = JSON.stringify({
      version: capa.version,
      formato: 1,
      clave: ["movistar-0802532"],
      lon: [2.122967],
      lat: [41.386032],
      companias: [7],
      estado: [0],
    });
    const leida = leerCapa(anterior, capa.version);
    assert.isTrue(Result.isFailure(leida) && leida.failure._tag === "CapaIlegible");
  });

  it("la versión se lee de los primeros bytes, antes de tener el fichero entero", () => {
    const capa = generarCapa(NOCHE, [PLAZA_PIUS_XII], LIMITES);
    assert.deepStrictEqual(
      versionDeCabecera(capa.contenido.slice(0, 48)),
      Option.some(capa.version),
    );
    assert.isTrue(Option.isNone(versionDeCabecera('{"formato":1,"version":"sitios@x"}')));
  });

  it("no da por buena una capa de otra versión que la publicada, aunque esté cortada", () => {
    const capa = generarCapa(NOCHE, [PLAZA_PIUS_XII, CAMPUS_NORD], LIMITES);
    const publicada = versionDeCapa(NOCHE + 86_400_000);
    const distinta = leerCapa(capa.contenido.slice(0, 80), publicada);
    assert.isTrue(Result.isFailure(distinta));
    if (Result.isSuccess(distinta)) return;
    assert.strictEqual(distinta.failure._tag, "VersionDistinta");

    const cortada = leerCapa(capa.contenido.slice(0, 80), capa.version);
    assert.isTrue(Result.isFailure(cortada));
    if (Result.isSuccess(cortada)) return;
    assert.strictEqual(cortada.failure._tag, "CapaIlegible");

    const vacia = leerCapa("<!doctype html>", capa.version);
    assert.isTrue(Result.isFailure(vacia) && vacia.failure._tag === "CapaIlegible");
  });
});
