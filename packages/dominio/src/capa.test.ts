import { assert, describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

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
    const capa = generarCapa(NOCHE, [PLAZA_PIUS_XII, CAMPUS_NORD, NUEVO]);
    assert.strictEqual(capa.version, "sitios@2026-09-26T02:15:03Z");
    assert.strictEqual(capa.fichero, "sitios@2026-09-26T02:15:03Z.json");
    assert.strictEqual(capa.emplazamientos, 3);
    assert.isTrue(
      capa.contenido.startsWith('{"version":"sitios@2026-09-26T02:15:03Z","formato":1,'),
    );
    await expect(`${capa.contenido}\n`).toMatchFileSnapshot("./referencia/capa-tres.json");
  });

  it("la misma instantánea da siempre los mismos bytes, llegue en el orden que llegue", () => {
    const una = generarCapa(NOCHE, [PLAZA_PIUS_XII, CAMPUS_NORD, NUEVO]);
    const otra = generarCapa(NOCHE, [NUEVO, PLAZA_PIUS_XII, CAMPUS_NORD]);
    assert.strictEqual(otra.contenido, una.contenido);
    assert.strictEqual(
      generarCapa(NOCHE, [PLAZA_PIUS_XII, CAMPUS_NORD, NUEVO]).contenido,
      una.contenido,
    );
    // Otra instantánea es otra versión y otro fichero; la anterior no cambia.
    const siguiente = generarCapa(NOCHE + 86_400_000, [PLAZA_PIUS_XII, CAMPUS_NORD]);
    assert.notStrictEqual(siguiente.fichero, una.fichero);
  });

  it("se lee de vuelta con todas las compañías de un emplazamiento compartido", () => {
    const capa = generarCapa(NOCHE, [PLAZA_PIUS_XII, CAMPUS_NORD, NUEVO]);
    const leida = leerCapa(capa.contenido, capa.version);
    assert.isTrue(Result.isSuccess(leida));
    if (Result.isFailure(leida)) return;
    assert.strictEqual(leida.success.version, capa.version);
    assert.strictEqual(leida.success.fecha, Date.UTC(2026, 8, 26, 2, 15, 3));
    assert.deepStrictEqual(leida.success.emplazamientos, [
      NUEVO,
      {
        ...PLAZA_PIUS_XII,
        posicion: { longitud: 2.122967, latitud: 41.386032 },
        companias: ["movistar", "vodafone", "orange"],
      },
      CAMPUS_NORD,
    ]);
  });

  it("la versión se lee de los primeros bytes, antes de tener el fichero entero", () => {
    const capa = generarCapa(NOCHE, [PLAZA_PIUS_XII]);
    assert.deepStrictEqual(
      versionDeCabecera(capa.contenido.slice(0, 48)),
      Option.some(capa.version),
    );
    assert.isTrue(Option.isNone(versionDeCabecera('{"formato":1,"version":"sitios@x"}')));
  });

  it("no da por buena una capa de otra versión que la publicada, aunque esté cortada", () => {
    const capa = generarCapa(NOCHE, [PLAZA_PIUS_XII, CAMPUS_NORD]);
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
