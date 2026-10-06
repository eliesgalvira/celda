import { assert, describe, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import {
  bandasDeCodigo,
  carpetaDeFichas,
  codificarVigente,
  codigoDeBandas,
  companiasDeMascara,
  decodificarVigente,
  emplazamientoDeCapa,
  fechaDeVersion,
  mascaraDeCompanias,
  versionDeCabecera,
  versionDeCapa,
} from "./capa.ts";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15, 3, 456);

describe("capa de emplazamientos", () => {
  it("la versión es la fecha de la instantánea al segundo, y se puede volver a leer", () => {
    const version = versionDeCapa(NOCHE);
    assert.strictEqual(version, "sitios@2026-09-26T02:15:03Z");
    assert.deepStrictEqual(fechaDeVersion(version), Option.some(Date.UTC(2026, 8, 26, 2, 15, 3)));
    assert.isTrue(Option.isNone(fechaDeVersion("sitios@ayer")));
    assert.isTrue(Option.isNone(fechaDeVersion("2026-09-26T02:15:03Z")));
  });

  it("las fichas de una versión del formato 4 iban en su carpeta, que la retirada reconoce", () => {
    assert.strictEqual(carpetaDeFichas(versionDeCapa(NOCHE)), "fichas@2026-09-26T02:15:03Z");
  });

  it("vigente.json dice la versión y su resumen, y se lee de vuelta; sin resumen es del 4", () => {
    const vigente = {
      version: versionDeCapa(NOCHE),
      fecha: NOCHE,
      emplazamientos: 3,
      lotes: 1,
      resumen: "resumen@2026-09-26T02:15:03Z.0123456789abcdef.json",
    };
    assert.deepStrictEqual(decodificarVigente(codificarVigente(vigente)), Result.succeed(vigente));
    const { resumen: _resumen, ...delFormato4 } = vigente;
    assert.deepStrictEqual(
      decodificarVigente(codificarVigente(delFormato4)),
      Result.succeed(delFormato4),
    );
    assert.isTrue(Result.isFailure(decodificarVigente('{"version":3}')));
    assert.isTrue(Result.isFailure(decodificarVigente("<!doctype html>")));
  });

  it("la versión se lee de los primeros bytes, antes de tener el fichero entero", () => {
    assert.deepStrictEqual(
      versionDeCabecera('{"version":"sitios@2026-09-26T02:15:03Z","formato":5,"fuen'),
      Option.some("sitios@2026-09-26T02:15:03Z"),
    );
    assert.isTrue(Option.isNone(versionDeCabecera('{"formato":1,"version":"sitios@x"}')));
  });

  it("las compañías van en una máscara de bits y vuelven en su orden fijo", () => {
    const mascara = mascaraDeCompanias(["orange", "movistar", "vodafone"]);
    assert.deepStrictEqual(companiasDeMascara(mascara), ["movistar", "vodafone", "orange"]);
  });

  it("las bandas conocidas van en un número y vuelven iguales; sin ninguna, nada", () => {
    const bandas = [
      { compania: "movistar" as const, mhz: [800, 1800, 3500] as const },
      { compania: "yoigo" as const, mhz: [700] as const },
    ];
    assert.deepStrictEqual(bandasDeCodigo(codigoDeBandas(bandas)), bandas);
    assert.deepStrictEqual(bandasDeCodigo(0), []);
  });

  it("de un emplazamiento con sus estaciones guarda las compañías y solo las bandas conocidas", () => {
    const deCapa = emplazamientoDeCapa(
      { clave: "movistar-1", posicion: { longitud: 2.1, latitud: 41.4 }, estado: "verificado" },
      [
        {
          compania: "movistar",
          bandas: [
            { referencia: "a", compania: "movistar", rangos: [], mhz: 1800, anio: 2024 },
            { referencia: "b", compania: "movistar", rangos: [], mhz: 800, anio: 2024 },
          ],
        },
        { compania: "orange", bandas: [] },
      ],
    );
    assert.deepStrictEqual(deCapa.companias, ["movistar", "orange"]);
    assert.deepStrictEqual(deCapa.bandas, [{ compania: "movistar", mhz: [800, 1800] }]);
  });

  it("las bandas de otra compañía que lista la ficha de una estación base no van en la capa", () => {
    const deCapa = emplazamientoDeCapa(
      { clave: "vodafone-1", posicion: { longitud: 2.1, latitud: 41.4 }, estado: "verificado" },
      [
        {
          compania: "vodafone",
          bandas: [
            { referencia: "a", compania: "vodafone", rangos: [], mhz: 800, anio: 2024 },
            { referencia: "b", compania: "orange", rangos: [], mhz: 2600, anio: 2024 },
          ],
        },
        {
          compania: "yoigo",
          bandas: [{ referencia: "c", compania: "orange", rangos: [], mhz: 1800, anio: 2024 }],
        },
      ],
    );
    assert.deepStrictEqual(deCapa.bandas, [{ compania: "vodafone", mhz: [800] }]);
  });
});
