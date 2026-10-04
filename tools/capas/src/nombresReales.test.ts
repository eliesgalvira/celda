// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { dentroDelPoligono } from "@celda/dominio/barrio";
import { LimitesDeMunicipios } from "@celda/dominio/municipio";
import { deLaComunitatValenciana } from "@celda/dominio/nombreDeLugar";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { type Contorno, ficheroDeContorno } from "./espana.ts";
import { FORMAS_CASTELLANAS } from "./formasCastellanas.ts";
import {
  AREA_MINIMA_COMUNITAT_KM2,
  contornoDeLaComunitatValenciana,
  ficheroDeNombres,
  tablaDeNombres,
  TOLERANCIA_COMUNITAT_METROS,
} from "./nombres.ts";

/** Los límites del repositorio y lo que escribe `pnpm run nombres`. */
const MUNICIPIOS = "../../packages/publicacion/datos/municipios.json";
const TABLA = "../../packages/dominio/datos/nombres-de-lugar.json";
const CONTORNO = "../../packages/dominio/datos/comunitat-valenciana.json";

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));

const leer = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return {
    limites: yield* decodificarLimites(yield* fs.readFileString(MUNICIPIOS)),
    tabla: yield* fs.readFileString(TABLA),
    contorno: yield* fs.readFileString(CONTORNO),
  };
}).pipe(Effect.provide(NodeServices.layer));

const dentro = (contorno: Contorno, longitud: number, latitud: number) =>
  contorno.coordinates.some((poligono) => dentroDelPoligono({ longitud, latitud }, poligono));

/**
 * Lugares a los dos lados del límite de la Comunitat, con el punto aproximado de su rótulo en
 * OpenStreetMap: la simplificación a 400 m no puede cambiarlos de lado.
 */
const CASOS: ReadonlyArray<readonly [string, number, number, boolean]> = [
  ["València", -0.3763, 39.4699, true],
  ["Alacant", -0.481, 38.3452, true],
  ["Castelló de la Plana", -0.0513, 39.9864, true],
  ["Vinaròs", 0.4747, 40.4705, true],
  ["Alcanar", 0.4806, 40.5434, false],
  ["Morella", -0.1007, 40.6189, true],
  ["Ademuz, en el Rincón", -1.2858, 40.0614, true],
  ["Torrebaja, en el Rincón", -1.2513, 40.1158, true],
  ["Utiel", -1.205, 39.5686, true],
  ["Camporrobles", -1.3967, 39.6475, true],
  ["Mira", -1.4378, 39.7186, false],
  ["Ayora", -1.0563, 39.0583, true],
  ["Almansa", -1.0973, 38.8694, false],
  ["Villena", -0.8657, 38.6355, true],
  ["Caudete", -1.0006, 38.7058, false],
  ["Yecla", -1.115, 38.6136, false],
  ["Orihuela", -0.944, 38.0848, true],
  ["Beniel", -1.0013, 38.0464, false],
  ["Pilar de la Horadada", -0.792, 37.8653, true],
  ["San Pedro del Pinatar", -0.7914, 37.835, false],
  ["Segorbe", -0.4889, 39.8517, true],
  ["Manzanera", -0.8306, 40.0597, false],
];

describe("nombres de lugar guardados en el repositorio", () => {
  it.effect("la tabla es la que sale de los límites y de las formas castellanas", () =>
    Effect.gen(function* () {
      const { limites, tabla } = yield* leer;
      const esperada = Result.getOrThrow(tablaDeNombres(limites, FORMAS_CASTELLANAS));
      assert.strictEqual(
        tabla,
        ficheroDeNombres(esperada),
        "la tabla está desfasada: vuelve a escribirla con `pnpm run nombres`",
      );
      assert.strictEqual(Object.keys(esperada.provincias).length, 4);
      assert.strictEqual(Object.keys(esperada.municipios).length, 130);
    }),
  );

  it.effect("el contorno es el que sale de los límites", () =>
    Effect.gen(function* () {
      const { limites, contorno } = yield* leer;
      const esperado = Result.getOrThrow(
        contornoDeLaComunitatValenciana(
          limites,
          TOLERANCIA_COMUNITAT_METROS,
          AREA_MINIMA_COMUNITAT_KM2,
        ),
      );
      assert.strictEqual(
        contorno,
        ficheroDeContorno(
          limites,
          esperado,
          TOLERANCIA_COMUNITAT_METROS,
          AREA_MINIMA_COMUNITAT_KM2,
        ),
        "el contorno está desfasado: vuelve a escribirlo con `pnpm run nombres`",
      );
    }),
  );

  it.effect("ningún municipio del IGN cambia de lado al simplificar el contorno", () =>
    Effect.gen(function* () {
      const { limites } = yield* leer;
      const simplificado = Result.getOrThrow(
        contornoDeLaComunitatValenciana(
          limites,
          TOLERANCIA_COMUNITAT_METROS,
          AREA_MINIMA_COMUNITAT_KM2,
        ),
      );
      const exacto = Result.getOrThrow(
        contornoDeLaComunitatValenciana(limites, 0, AREA_MINIMA_COMUNITAT_KM2),
      );
      const municipios = limites.territorios.filter((t) => t.tipo === "municipio");
      assert.isAbove(municipios.length, 8000);
      const cambiados = municipios.flatMap((municipio) => {
        const { longitud, latitud } = municipio.etiqueta;
        const esperado = deLaComunitatValenciana(municipio.codigo);
        return dentro(exacto, longitud, latitud) === esperado &&
          dentro(simplificado, longitud, latitud) === esperado
          ? []
          : [`${municipio.codigo} ${municipio.nombre}`];
      });
      assert.deepStrictEqual(cambiados, []);
    }),
  );

  it.effect("deja cada lugar del límite en su lado, como el contorno sin simplificar", () =>
    Effect.gen(function* () {
      const { limites } = yield* leer;
      const simplificado = Result.getOrThrow(
        contornoDeLaComunitatValenciana(
          limites,
          TOLERANCIA_COMUNITAT_METROS,
          AREA_MINIMA_COMUNITAT_KM2,
        ),
      );
      const exacto = Result.getOrThrow(
        contornoDeLaComunitatValenciana(limites, 0, AREA_MINIMA_COMUNITAT_KM2),
      );
      for (const [lugar, longitud, latitud, enLaComunitat] of CASOS) {
        assert.strictEqual(
          dentro(exacto, longitud, latitud),
          enLaComunitat,
          `${lugar}, sin simplificar`,
        );
        assert.strictEqual(dentro(simplificado, longitud, latitud), enLaComunitat, lugar);
      }
    }),
  );
});
