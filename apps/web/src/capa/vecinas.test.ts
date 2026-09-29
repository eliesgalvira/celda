import { distanciaMetros } from "@celda/dominio/area";
import { assert, describe, it } from "@effect/vitest";

import { BARCELONA, estados, RESUMEN } from "./pruebasNacional.ts";
import {
  ampliarRectangulo,
  cargadasDe,
  enumerar,
  estadoDeLasVecinas,
  mismasVecinas,
  provinciasCerca,
  rectanguloDePunto,
} from "./vecinas.ts";

// En la prueba, Barcelona llega hasta 2,4855° de longitud y Girona empieza en 2,5005°: 1,25 km
// de una a otra a 41,9° de latitud.
const JUNTO_AL_BORDE = rectanguloDePunto({ longitud: 2.48, latitud: 41.92 });
const LEJOS_DEL_BORDE = rectanguloDePunto({ longitud: 2.4, latitud: 41.92 });

describe("provincias vecinas", () => {
  it("ampliar un rectángulo lo alarga esos metros por cada lado, nunca menos", () => {
    const punto = { longitud: 2.48, latitud: 41.92 };
    const ampliado = ampliarRectangulo(rectanguloDePunto(punto), 1000);
    const alNorte = { ...punto, latitud: ampliado.noreste.latitud };
    const alEste = { ...punto, longitud: ampliado.noreste.longitud };
    assert.approximately(distanciaMetros(punto, alNorte), 1000, 1);
    assert.isAtLeast(distanciaMetros(punto, alEste), 999);
  });

  it("junto al borde hacen falta las dos provincias; lejos, solo la suya", () => {
    assert.deepStrictEqual(provinciasCerca(RESUMEN, [JUNTO_AL_BORDE], 2000), ["08", "17"]);
    assert.deepStrictEqual(provinciasCerca(RESUMEN, [LEJOS_DEL_BORDE], 2000), ["08"]);
    // Lleida no tiene capa: no hay nada que pedir.
    const enLleida = rectanguloDePunto({ longitud: 1, latitud: 42 });
    assert.deepStrictEqual(provinciasCerca(RESUMEN, [enLleida], 50_000), []);
  });

  it("dice cuáles faltan: primero las que han fallado, y una sin pedir cuenta como cargando", () => {
    const girona = { codigo: "17", nombre: "Girona" };
    const barcelona = { codigo: "08", nombre: "Barcelona" };
    const listaBarcelona = ["08", { tipo: "lista", provincia: BARCELONA }] as const;
    assert.deepStrictEqual(estadoDeLasVecinas(RESUMEN, estados(listaBarcelona), ["08"]), {
      tipo: "listas",
    });
    assert.deepStrictEqual(estadoDeLasVecinas(RESUMEN, estados(listaBarcelona), ["08", "17"]), {
      tipo: "cargando",
      provincias: [girona],
    });
    assert.deepStrictEqual(
      estadoDeLasVecinas(
        RESUMEN,
        estados(["08", { tipo: "cargando" }], ["17", { tipo: "fallo", motivo: "sin-descarga" }]),
        ["08", "17"],
      ),
      { tipo: "fallo", provincias: [girona] },
    );
    assert.isTrue(
      mismasVecinas(
        { tipo: "cargando", provincias: [barcelona, girona] },
        { tipo: "cargando", provincias: [{ ...barcelona }, { ...girona }] },
      ),
    );
    assert.isFalse(
      mismasVecinas(
        { tipo: "cargando", provincias: [girona] },
        { tipo: "fallo", provincias: [girona] },
      ),
    );
  });

  it("de las necesarias, da las que ya han llegado", () => {
    const provincias = estados(
      ["08", { tipo: "lista", provincia: BARCELONA }],
      ["17", { tipo: "cargando" }],
    );
    assert.deepStrictEqual(cargadasDe(provincias, ["08", "17"]), [BARCELONA]);
    assert.deepStrictEqual(cargadasDe(provincias, ["17"]), []);
  });

  it("enumera los nombres como se dicen", () => {
    assert.strictEqual(enumerar(["Girona"]), "Girona");
    assert.strictEqual(enumerar(["Barcelona", "Girona"]), "Barcelona y Girona");
    assert.strictEqual(enumerar(["Barcelona", "Girona", "Lleida"]), "Barcelona, Girona y Lleida");
  });
});
