// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import {
  indexarMunicipios,
  LimitesDeMunicipios,
  municipioDelPunto,
} from "@celda/dominio/municipio";
import { IndiceDeZonas } from "@celda/dominio/zonaDelEjercicio";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { ficherosDeZonas } from "./zonas.ts";

/** Los límites del repositorio y las zonas que escribe `pnpm run zonas` para la web. */
const MUNICIPIOS = "../../packages/publicacion/datos/municipios.json";
const ZONAS = "../../apps/web/src/ejercicio/zonas";

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));
const decodificarIndice = Schema.decodeEffect(Schema.fromJsonString(IndiceDeZonas));

const leer = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const limites = yield* decodificarLimites(yield* fs.readFileString(MUNICIPIOS));
  const guardados = new Map<string, string>();
  for (const nombre of yield* fs.readDirectory(ZONAS)) {
    guardados.set(nombre, yield* fs.readFileString(`${ZONAS}/${nombre}`));
  }
  return { limites, guardados };
}).pipe(Effect.provide(NodeServices.layer));

/** Dónde está el punto y qué municipio le toca con el contorno de su provincia. */
const CASOS: ReadonlyArray<readonly [string, number, number, string]> = [
  ["plaza de Catalunya", 2.17, 41.387, "08019"],
  ["Tordera", 2.719, 41.699, "08284"],
  ["Queralbs", 2.165, 42.35, "17043"],
  ["Soria", -2.468, 41.764, "42173"],
  ["Puerta del Sol", -3.7038, 40.4168, "28079"],
  ["Llívia, rodeada de Francia", 1.9807, 42.4637, "17094"],
];

describe("zonas del ejercicio guardadas en la web", () => {
  it.effect("son lo que escribe la orden, byte a byte, sin ficheros de más", () =>
    Effect.gen(function* () {
      const { limites, guardados } = yield* leer;
      const escritos = ficherosDeZonas(limites);
      assert.sameMembers([...guardados.keys()], [...escritos.keys()]);
      for (const [nombre, contenido] of escritos) {
        assert.isTrue(guardados.get(nombre) === contenido, nombre);
      }
    }),
  );

  it.effect("el índice tiene los 8.132 municipios y las 52 provincias", () =>
    Effect.gen(function* () {
      const { guardados } = yield* leer;
      const indice = yield* decodificarIndice(guardados.get("indice.json") ?? "");
      assert.lengthOf(indice.municipios, 8132);
      assert.lengthOf(indice.provincias, 52);
    }),
  );

  it.effect("con el contorno de su provincia, cada punto de prueba cae en su municipio", () =>
    Effect.gen(function* () {
      const { guardados } = yield* leer;
      for (const [lugar, longitud, latitud, codigo] of CASOS) {
        const contorno = yield* decodificarLimites(
          guardados.get(`${codigo.slice(0, 2)}.json`) ?? "",
        );
        const { municipio } = municipioDelPunto({ longitud, latitud }, indexarMunicipios(contorno));
        assert.strictEqual(municipio?.codigo, codigo, lugar);
      }
    }),
  );
});
