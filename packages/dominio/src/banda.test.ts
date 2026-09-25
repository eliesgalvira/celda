import { assert, describe, it } from "@effect/vitest";

import { anioDeReferencia, mhzDeRangos } from "./banda.ts";
import { normalizarCodigo } from "./observacion.ts";

describe("mhzDeRangos", () => {
  it.each([
    [758, 768, 700],
    [832, 842, 800],
    [925.1, 935.1, 900],
    [1855.1, 1879.9, 1800],
    [2120, 2140, 2100],
    [2620, 2640, 2600],
    [3460, 3600, 3500],
  ] as const)("%s-%s MHz es la banda de %s", (desdeMhz, hastaMhz, mhz) => {
    assert.strictEqual(mhzDeRangos([{ desdeMhz, hastaMhz }]), mhz);
  });

  it("una banda doble de 3G es la de 2100", () => {
    assert.strictEqual(
      mhzDeRangos([
        { desdeMhz: 1910, hastaMhz: 1915 },
        { desdeMhz: 2155, hastaMhz: 2170 },
      ]),
      2100,
    );
  });

  it("un rango que no encaja no tiene banda", () => {
    assert.isNull(mhzDeRangos([{ desdeMhz: 450, hastaMhz: 460 }]));
  });
});

describe("anioDeReferencia", () => {
  it("lee el año en los dos primeros dígitos del número", () => {
    assert.strictEqual(anioDeReferencia("B B -2403167"), 2024);
    assert.strictEqual(anioDeReferencia("B B -0900936"), 2009);
    assert.strictEqual(anioDeReferencia("AVAV-2000120"), 2020);
  });

  it("no inventa un año si la referencia no tiene la forma esperada", () => {
    assert.isNull(anioDeReferencia("sin número"));
  });
});

describe("normalizarCodigo", () => {
  it("quita los ceros a la izquierda de los códigos numéricos", () => {
    assert.deepStrictEqual(["647", "00647", "000647", "0802532"].map(normalizarCodigo), [
      "647",
      "647",
      "647",
      "802532",
    ]);
  });

  it("deja los códigos con letras como están", () => {
    assert.strictEqual(normalizarCodigo("CATR0228A"), "CATR0228A");
    assert.strictEqual(normalizarCodigo("0"), "0");
  });
});
