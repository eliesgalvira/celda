import { assert, describe, it } from "@effect/vitest";

import {
  type Barrio,
  barrioDelPunto,
  type EmplazamientoConBarrio,
  type LimiteDeBarrio,
  resumirBarrios,
} from "./barrio.ts";

/** Un barrio cuadrado de lado 1 con la esquina suroeste en (x, y). */
const cuadrado = (codigo: string, x: number, y: number): LimiteDeBarrio => ({
  codigo,
  nombre: `Barrio ${codigo}`,
  etiqueta: { longitud: x + 0.5, latitud: y + 0.5 },
  poligonos: [
    [
      [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
        [x, y],
      ],
    ],
  ],
});

// Dos barrios vecinos que comparten el lado x = 1, y un tercero con un agujero en medio.
const OESTE = cuadrado("01", 0, 0);
const ESTE = cuadrado("02", 1, 0);
const CON_AGUJERO: LimiteDeBarrio = {
  codigo: "03",
  nombre: "Barrio con agujero",
  etiqueta: { longitud: 10.1, latitud: 10.1 },
  poligonos: [
    [
      [
        [10, 10],
        [13, 10],
        [13, 13],
        [10, 13],
      ],
      [
        [11, 11],
        [12, 11],
        [12, 12],
        [11, 12],
      ],
    ],
  ],
};
const LIMITES = [OESTE, ESTE, CON_AGUJERO];

const punto = (longitud: number, latitud: number) => ({ longitud, latitud });

describe("asignación de barrio", () => {
  it("un punto dentro de un barrio cae en ese barrio", () => {
    assert.strictEqual(barrioDelPunto(punto(0.3, 0.6), LIMITES)?.codigo, "01");
    assert.strictEqual(barrioDelPunto(punto(1.7, 0.2), LIMITES)?.codigo, "02");
  });

  it("un punto fuera de todos los barrios no cae en ninguno", () => {
    assert.isUndefined(barrioDelPunto(punto(-0.5, 0.5), LIMITES));
    assert.isUndefined(barrioDelPunto(punto(5, 5), LIMITES));
  });

  it("un punto en el agujero de un barrio no es de ese barrio", () => {
    assert.isUndefined(barrioDelPunto(punto(11.5, 11.5), LIMITES));
    assert.strictEqual(barrioDelPunto(punto(10.5, 11.5), LIMITES)?.codigo, "03");
  });

  it("un emplazamiento en el límite entre dos barrios cae en uno solo, y siempre en el mismo", () => {
    for (const enElBorde of [punto(1, 0.5), punto(1, 0.25), punto(1, 0.999)]) {
      const dentro = [OESTE, ESTE].filter((b) => barrioDelPunto(enElBorde, [b]) !== undefined);
      assert.lengthOf(dentro, 1, `(${enElBorde.longitud}, ${enElBorde.latitud})`);
      assert.strictEqual(
        barrioDelPunto(enElBorde, [OESTE, ESTE])?.codigo,
        barrioDelPunto(enElBorde, [ESTE, OESTE])?.codigo,
      );
    }
  });

  it("si dos límites se solapan, gana el primero de la lista", () => {
    const encima = { ...cuadrado("09", 0, 0), nombre: "Solapado" };
    assert.strictEqual(barrioDelPunto(punto(0.5, 0.5), [OESTE, encima])?.codigo, "01");
    assert.strictEqual(barrioDelPunto(punto(0.5, 0.5), [encima, OESTE])?.codigo, "09");
  });
});

describe("recuentos y ausencias por barrio", () => {
  const barrios: ReadonlyArray<Barrio> = [OESTE, ESTE, CON_AGUJERO];
  const en = (
    barrio: string | null,
    ...companias: EmplazamientoConBarrio["companias"]
  ): EmplazamientoConBarrio => ({ barrio, companias });

  const resumen = (emplazamientos: ReadonlyArray<EmplazamientoConBarrio>) =>
    new Map(resumirBarrios(barrios, emplazamientos).map((r) => [r.barrio.codigo, r]));

  it("un barrio sin emplazamientos de una compañía la tiene como ausente", () => {
    const porBarrio = resumen([
      en("01", "movistar", "orange"),
      en("01", "movistar"),
      en("02", "movistar", "vodafone", "orange"),
    ]);
    assert.strictEqual(porBarrio.get("01")?.emplazamientos, 2);
    assert.deepStrictEqual(porBarrio.get("01")?.ausentes, ["vodafone"]);
  });

  it("un barrio con todas las compañías de la capa no tiene ausencias", () => {
    const porBarrio = resumen([
      en("01", "digi"),
      en("02", "movistar", "vodafone"),
      en("02", "orange"),
      en("02", "digi"),
    ]);
    assert.strictEqual(porBarrio.get("02")?.emplazamientos, 3);
    assert.deepStrictEqual(porBarrio.get("02")?.ausentes, []);
  });

  it("un barrio vacío tiene cero emplazamientos y todas las compañías de la capa ausentes", () => {
    const porBarrio = resumen([en("01", "vodafone", "movistar"), en("02", "digi")]);
    assert.strictEqual(porBarrio.get("03")?.emplazamientos, 0);
    assert.deepStrictEqual(porBarrio.get("03")?.ausentes, ["movistar", "vodafone", "digi"]);
  });

  it("una compañía sin emplazamientos en toda la capa no cuenta como ausente en ningún barrio", () => {
    // Yoigo no aparece en ninguna parte: no se puede decir que falte en un barrio.
    const porBarrio = resumen([en("01", "movistar"), en("02", "orange")]);
    for (const r of porBarrio.values()) assert.notInclude(r.ausentes, "yoigo");
    assert.deepStrictEqual(porBarrio.get("01")?.ausentes, ["orange"]);
  });

  it("los emplazamientos de fuera de Barcelona cuentan para la capa pero no para ningún barrio", () => {
    const porBarrio = resumen([en("01", "movistar"), en(null, "vodafone"), en(null, "orange")]);
    assert.strictEqual(
      [...porBarrio.values()].reduce((suma, r) => suma + r.emplazamientos, 0),
      1,
    );
    assert.deepStrictEqual(porBarrio.get("01")?.ausentes, ["vodafone", "orange"]);
  });

  it("devuelve los barrios en el orden en que llegan, también los vacíos", () => {
    assert.deepStrictEqual(
      resumirBarrios(barrios, []).map((r) => r.barrio.codigo),
      ["01", "02", "03"],
    );
  });
});
