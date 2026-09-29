import { assert, describe, it } from "@effect/vitest";

import type { Compania } from "./compania.ts";
import type { MunicipioDeCapa, ProvinciaDelResumen } from "./provincias.ts";
import {
  ausentesDeProvincia,
  ausentesEntre,
  companiasDelResumen,
  type EmplazamientoConMunicipio,
  resumirMunicipios,
  UMBRAL_DE_AUSENCIAS,
} from "./zona.ts";

const municipio = (codigo: string, nombre: string): MunicipioDeCapa => ({
  codigo,
  nombre,
  etiqueta: { longitud: 2, latitud: 41 },
  habitantes: 1000,
  areaKm2: 10,
  emplazamientos: 0,
  companias: [],
});

const TERRASSA = municipio("08279", "Terrassa");
const AIGUAFREDA = municipio("08014", "Aiguafreda");
const CASTELLCIR = municipio("08056", "Castellcir");

/** `n` emplazamientos de `companias` en `codigo`, en fila hacia el este desde (2, 41). */
const en = (
  codigo: string | null,
  n: number,
  companias: ReadonlyArray<Compania>,
): ReadonlyArray<EmplazamientoConMunicipio> =>
  Array.from({ length: n }, (_, i) => ({
    municipio: codigo,
    companias,
    posicion: { longitud: 2 + i * 0.01, latitud: 41 },
  }));

const TODAS = new Set<Compania>(["movistar", "vodafone", "orange", "digi", "yoigo"]);

describe("ausencias", () => {
  it("una compañía ausente es una de la capa que no está en la zona, en el orden pedido", () => {
    assert.deepStrictEqual(ausentesEntre(["orange", "movistar"], TODAS), [
      "vodafone",
      "digi",
      "yoigo",
    ]);
    assert.deepStrictEqual(ausentesEntre([], TODAS, ["yoigo", "digi"]), ["yoigo", "digi"]);
  });

  it("de una compañía que no está en la capa no se dice que falte", () => {
    assert.deepStrictEqual(ausentesEntre(["movistar"], new Set(["movistar", "digi"])), ["digi"]);
  });
});

describe("umbral de ausencias de los municipios", () => {
  it("es de 10 emplazamientos", () => {
    assert.strictEqual(UMBRAL_DE_AUSENCIAS, 10);
  });

  it("con 10 emplazamientos o más, el municipio enseña sus ausencias", () => {
    const [terrassa] = resumirMunicipios(
      [TERRASSA],
      en("08279", UMBRAL_DE_AUSENCIAS, ["movistar", "orange"]),
      TODAS,
    );
    assert.strictEqual(terrassa?.emplazamientos, 10);
    assert.deepStrictEqual(terrassa?.ausentes, ["vodafone", "digi", "yoigo"]);
  });

  it("con menos de 10, solo su número: no se dice que falte ninguna compañía", () => {
    const [aiguafreda] = resumirMunicipios(
      [AIGUAFREDA],
      en("08014", UMBRAL_DE_AUSENCIAS - 1, ["movistar"]),
      TODAS,
    );
    assert.strictEqual(aiguafreda?.emplazamientos, 9);
    assert.deepStrictEqual(aiguafreda?.ausentes, []);
  });

  it("un municipio sin emplazamientos sale con 0, sin ausencias y sin caja", () => {
    const [castellcir] = resumirMunicipios([CASTELLCIR], en("08279", 12, ["digi"]), TODAS);
    assert.deepStrictEqual(castellcir, {
      municipio: CASTELLCIR,
      emplazamientos: 0,
      ausentes: [],
      caja: undefined,
    });
  });
});

describe("resumen de los municipios", () => {
  it("cuenta cada emplazamiento en su municipio y deja fuera los de un territorio compartido", () => {
    const resumen = resumirMunicipios(
      [TERRASSA, AIGUAFREDA],
      [
        ...en("08279", 11, ["movistar", "vodafone", "orange", "digi", "yoigo"]),
        ...en("08014", 2, ["vodafone"]),
        ...en(null, 5, ["movistar"]),
      ],
      TODAS,
    );
    assert.deepStrictEqual(
      resumen.map((r) => [r.municipio.codigo, r.emplazamientos, r.ausentes]),
      [
        ["08279", 11, []],
        ["08014", 2, []],
      ],
    );
  });

  it("los números salen de los emplazamientos, no de la tabla de municipios", () => {
    const [terrassa] = resumirMunicipios(
      [{ ...TERRASSA, emplazamientos: 99, companias: ["movistar"] }],
      en("08279", 3, ["digi"]),
      TODAS,
    );
    assert.strictEqual(terrassa?.emplazamientos, 3);
  });

  it("la caja de un municipio envuelve sus emplazamientos", () => {
    const [terrassa] = resumirMunicipios([TERRASSA], en("08279", 4, ["digi"]), TODAS);
    assert.deepStrictEqual(terrassa?.caja, {
      suroeste: { longitud: 2, latitud: 41 },
      noreste: { longitud: 2.03, latitud: 41 },
    });
  });
});

describe("ausencias de las provincias", () => {
  const provincia = (
    cubierta: boolean,
    companias: ReadonlyArray<Compania>,
  ): ProvinciaDelResumen => ({
    codigo: "22",
    nombre: "Huesca",
    etiqueta: { longitud: -0.3, latitud: 42.1 },
    caja: undefined,
    emplazamientos: 184,
    companias,
    fichero: undefined,
    cubierta,
    barrido: null,
  });

  it("una provincia cubierta enseña las compañías del resumen que no tiene", () => {
    assert.deepStrictEqual(ausentesDeProvincia(provincia(true, ["movistar"]), TODAS), [
      "vodafone",
      "orange",
      "digi",
      "yoigo",
    ]);
  });

  it("una provincia a medias no enseña ausencias: falta la parte que Celda no tiene", () => {
    assert.deepStrictEqual(ausentesDeProvincia(provincia(false, ["movistar"]), TODAS), []);
  });

  it("las compañías de la capa son las de todas las provincias del resumen", () => {
    assert.deepStrictEqual(
      [...companiasDelResumen([provincia(true, ["digi"]), provincia(false, ["yoigo", "digi"])])],
      ["digi", "yoigo"],
    );
  });
});
