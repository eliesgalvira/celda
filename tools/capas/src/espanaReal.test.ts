// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { dentroDelPoligono } from "@celda/dominio/barrio";
import { LimitesDeMunicipios } from "@celda/dominio/municipio";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  AREA_MINIMA_ESPANA_KM2,
  contornoDeLaUnion,
  type Contorno,
  ficheroDeContorno,
  TOLERANCIA_ESPANA_METROS,
} from "./espana.ts";

/** Los límites del repositorio y el contorno que escribe `pnpm run espana` para el mapa base. */
const MUNICIPIOS = "../../packages/publicacion/datos/municipios.json";
const ESPANA = "../../packages/ui/src/mapa/espana.json";

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));

const leer = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return {
    limites: yield* decodificarLimites(yield* fs.readFileString(MUNICIPIOS)),
    guardado: yield* fs.readFileString(ESPANA),
  };
}).pipe(Effect.provide(NodeServices.layer));

const dentro = (contorno: Contorno, longitud: number, latitud: number) =>
  contorno.coordinates.some((poligono) => dentroDelPoligono({ longitud, latitud }, poligono));

/**
 * Lugares a los dos lados de la frontera, a pocos kilómetros unos de otros, con el punto del
 * rótulo de OpenStreetMap: la simplificación a 400 m no puede cambiarlos de lado.
 */
const CASOS: ReadonlyArray<readonly [string, number, number, boolean]> = [
  ["Madrid", -3.7035, 40.4167, true],
  ["Irun", -1.7894, 43.3381, true],
  ["Hendaya", -1.7745, 43.3593, false],
  ["Tui", -8.6448, 42.0472, true],
  ["Valença", -8.6421, 42.0283, false],
  ["Ayamonte", -7.4027, 37.2134, true],
  ["Vila Real de Santo António", -7.4167, 37.1945, false],
  ["Badajoz", -6.9707, 38.8786, true],
  ["Elvas", -7.1631, 38.8811, false],
  ["Puigcerdà", 1.9277, 42.4318, true],
  ["Bourg-Madame", 1.9471, 42.4329, false],
  ["Llívia, rodeada de Francia", 1.9807, 42.4637, true],
  ["La Jonquera", 2.8744, 42.4188, true],
  ["Le Perthus", 2.8619, 42.4636, false],
  ["Andorra la Vella", 1.5218, 42.5063, false],
  ["La Línea de la Concepción", -5.3476, 36.1677, true],
  // El IGN lo da como territorio sin provincia. Su rótulo lo quita el mapa base por el nombre.
  ["Gibraltar", -5.3536, 36.1408, true],
  ["Ceuta", -5.316, 35.889, true],
  ["Fnideq", -5.3573, 35.8494, false],
  ["Melilla", -2.938, 35.292, true],
  ["Beni Ansar", -2.9306, 35.2622, false],
  ["Oporto", -8.611, 41.1496, false],
  ["Perpiñán", 2.8956, 42.6976, false],
  ["Tánger", -5.8129, 35.7806, false],
  ["Palma", 2.6502, 39.5696, true],
  ["Valverde, en El Hierro", -17.915, 27.81, true],
];

describe("contorno de España guardado en el repositorio", () => {
  it.effect("es el que sale de los límites de municipios", () =>
    Effect.gen(function* () {
      const { limites, guardado } = yield* leer;
      const contorno = Result.getOrThrow(
        contornoDeLaUnion(limites, TOLERANCIA_ESPANA_METROS, AREA_MINIMA_ESPANA_KM2),
      );
      assert.strictEqual(
        guardado,
        ficheroDeContorno(limites, contorno, TOLERANCIA_ESPANA_METROS, AREA_MINIMA_ESPANA_KM2),
        "el contorno está desfasado: vuelve a escribirlo con `pnpm run espana`",
      );
    }),
  );

  it.effect("deja cada lugar de la frontera en su lado, como el contorno sin simplificar", () =>
    Effect.gen(function* () {
      const { limites } = yield* leer;
      const simplificado = Result.getOrThrow(
        contornoDeLaUnion(limites, TOLERANCIA_ESPANA_METROS, AREA_MINIMA_ESPANA_KM2),
      );
      const exacto = Result.getOrThrow(contornoDeLaUnion(limites, 0, AREA_MINIMA_ESPANA_KM2));
      for (const [lugar, longitud, latitud, enEspana] of CASOS) {
        assert.strictEqual(
          dentro(exacto, longitud, latitud),
          enEspana,
          `${lugar}, sin simplificar`,
        );
        assert.strictEqual(dentro(simplificado, longitud, latitud), enEspana, lugar);
      }
    }),
  );
});
