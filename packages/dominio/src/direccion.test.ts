import { assert, describe, it } from "@effect/vitest";

import { claveDeDireccion } from "./direccion.ts";

const MADRID = ". MADRID, MADRID";

describe("claveDeDireccion", () => {
  it("escribe igual la misma dirección de compañías distintas", () => {
    // Pares reales del listado del centro de Madrid del 28/09/2026.
    for (const [a, b] of [
      ["CL DE JOSE ORTEGA Y GASSET, 91", "CL JOSE ORTEGA Y GASSET, 91"],
      ["VP PZ DE LAS CORTES, 7", "PZ CORTES, 7"],
      ["CL Santa Engracia, 62", "CL SANTA ENGRACIA, 62 , 62"],
      ["CL BURGOS, 00002", "CL BURGOS, 2"],
      ["CL PRÍNCIPE DE VERGARA, 291", "CL Principe de Vergara, 291"],
      ["GL DE CUATRO CAMINOS, 6-7", "GL CUATRO CAMINOS, 6"],
    ]) {
      assert.strictEqual(claveDeDireccion(`${a}${MADRID}`), claveDeDireccion(`${b}${MADRID}`));
    }
    assert.strictEqual(
      claveDeDireccion(`CL DE JOSE ORTEGA Y GASSET, 91${MADRID}`),
      "JOSE ORTEGA GASSET, 91. MADRID MADRID",
    );
  });

  it("distingue otro número, otra vía y otro municipio", () => {
    const base = claveDeDireccion(`CL ALCALA, 27${MADRID}`);
    assert.notStrictEqual(claveDeDireccion(`CL ALCALA, 28${MADRID}`), base);
    assert.notStrictEqual(claveDeDireccion(`CL GOYA, 27${MADRID}`), base);
    assert.notStrictEqual(claveDeDireccion("CL ALCALA, 27. ALCORCON, MADRID"), base);
  });

  it("no da clave sin nombre de vía o sin número", () => {
    for (const direccion of [
      "CL , 92. MADRID, MADRID",
      "PZ ESPAÑA, S/N. MADRID, MADRID",
      "CL PRINCESA. MADRID, MADRID",
      "",
    ]) {
      assert.isUndefined(claveDeDireccion(direccion), direccion);
    }
  });
});
