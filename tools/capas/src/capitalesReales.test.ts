// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { distanciaMetros } from "@celda/dominio/area";
import {
  CapitalesDeMunicipios,
  LimitesDeMunicipios,
  municipioDelPunto,
} from "@celda/dominio/municipio";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { ficheroDeCapitales } from "./capitales.ts";
import { leerMunicipios } from "./descargaDeMunicipios.ts";

/** Lo que escribe `pnpm run capitales` y los límites con que lo cruza, en el repositorio. */
const CAPITALES = "../../packages/publicacion/datos/capitales.json";
const MUNICIPIOS = "../../packages/publicacion/datos/municipios.json";

const decodificarCapitales = Schema.decodeEffect(Schema.fromJsonString(CapitalesDeMunicipios));
const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));

const leer = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const texto = yield* fs.readFileString(CAPITALES);
  return {
    texto,
    capitales: yield* decodificarCapitales(texto),
    limites: yield* decodificarLimites(yield* fs.readFileString(MUNICIPIOS)),
    indice: yield* leerMunicipios(MUNICIPIOS),
  };
}).pipe(Effect.provide(NodeServices.layer));

describe("capitales guardadas en el repositorio", () => {
  it.effect("hay una por municipio de los límites, con su fuente, y la orden las escribe así", () =>
    Effect.gen(function* () {
      const { texto, capitales, limites } = yield* leer;
      assert.deepStrictEqual(
        capitales.capitales.map((c) => c.codigo),
        limites.territorios.filter((t) => t.tipo === "municipio").map((t) => t.codigo),
      );
      assert.strictEqual(capitales.fuente.producto, "Nomenclátor Geográfico Básico de España");
      assert.strictEqual(capitales.fuente.licencia, "CC BY 4.0");
      assert.strictEqual(texto, ficheroDeCapitales(capitales));
    }),
  );

  it.effect("Gavà tiene la suya en el pueblo, lejos del centro de su término en el Garraf", () =>
    Effect.gen(function* () {
      const { capitales, limites, indice } = yield* leer;
      const capital = capitales.capitales.find((c) => c.codigo === "08089")?.posicion;
      const etiqueta = limites.territorios.find((t) => t.codigo === "08089")?.etiqueta;
      if (capital === undefined || etiqueta === undefined) return assert.fail("sin Gavà");
      assert.strictEqual(municipioDelPunto(capital, indice).municipio?.codigo, "08089");
      assert.isAbove(distanciaMetros(capital, etiqueta), 1500);
    }),
  );

  it.effect(
    "las de Llocnou de la Corona y Encío, que caen en Alfafar y Pancorbo, van a su municipio",
    () =>
      Effect.gen(function* () {
        const { capitales, indice } = yield* leer;
        for (const [codigo, delPunto] of [
          ["46152", "46022"],
          ["09120", "09251"],
        ] as const) {
          const capital = capitales.capitales.find((c) => c.codigo === codigo);
          if (capital === undefined) return assert.fail(`sin ${codigo}`);
          assert.strictEqual(
            municipioDelPunto(capital.posicion, indice).municipio?.codigo,
            delPunto,
          );
        }
      }),
  );
});
