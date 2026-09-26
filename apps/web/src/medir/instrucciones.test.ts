import {
  CODIGO_ANDROID_GENERAL,
  CODIGO_IPHONE,
  CODIGOS_POR_MARCA,
} from "@celda/dominio/modoInformacion";
import { assert, describe, it } from "@effect/vitest";

import { instruccionesPara } from "./instrucciones.ts";

describe("instruccionesPara", () => {
  it("en un Samsung reconocido enseña el código de Samsung, y dice que la marca es deducida", () => {
    const instrucciones = instruccionesPara({ tipo: "android", marca: "samsung" }, {});
    assert.deepStrictEqual(instrucciones, {
      tipo: "android",
      marca: "samsung",
      deducida: true,
      codigo: CODIGOS_POR_MARCA.samsung,
    });
    assert.strictEqual(
      instrucciones.tipo === "android" ? instrucciones.codigo?.codigo : undefined,
      "*#0011#",
    );
  });

  it("si no reconoce la marca no da ningún código hasta que se elige", () => {
    const sinMarca = instruccionesPara({ tipo: "android", marca: undefined }, {});
    assert.deepStrictEqual(sinMarca, {
      tipo: "android",
      marca: undefined,
      deducida: false,
      codigo: undefined,
    });

    const elegida = instruccionesPara({ tipo: "android", marca: undefined }, { marca: "xiaomi" });
    assert.deepStrictEqual(elegida, {
      tipo: "android",
      marca: "xiaomi",
      deducida: false,
      codigo: CODIGOS_POR_MARCA.xiaomi,
    });
  });

  it("la marca elegida a mano gana a la deducida", () => {
    const instrucciones = instruccionesPara(
      { tipo: "android", marca: "samsung" },
      { marca: "motorola" },
    );
    assert.strictEqual(instrucciones.tipo === "android" && instrucciones.marca, "motorola");
    assert.strictEqual(instrucciones.tipo === "android" && instrucciones.deducida, false);
  });

  it("«otra marca» da el código general de Android", () => {
    const instrucciones = instruccionesPara(
      { tipo: "android", marca: undefined },
      { marca: "otra" },
    );
    assert.strictEqual(
      instrucciones.tipo === "android" ? instrucciones.codigo : undefined,
      CODIGO_ANDROID_GENERAL,
    );
  });

  it("en un iPhone enseña Field Test", () => {
    assert.deepStrictEqual(instruccionesPara({ tipo: "iphone" }, {}), {
      tipo: "iphone",
      codigo: CODIGO_IPHONE,
    });
  });

  it("el tipo elegido a mano gana al detectado", () => {
    assert.deepStrictEqual(instruccionesPara({ tipo: "iphone" }, { tipo: "ordenador" }), {
      tipo: "ordenador",
    });
    // Un ordenador que en realidad es un Android: sin marca, no se adivina el código.
    assert.deepStrictEqual(instruccionesPara({ tipo: "ordenador" }, { tipo: "android" }), {
      tipo: "android",
      marca: undefined,
      deducida: false,
      codigo: undefined,
    });
    assert.deepStrictEqual(instruccionesPara({ tipo: "desconocido" }, {}), {
      tipo: "desconocido",
    });
  });
});
