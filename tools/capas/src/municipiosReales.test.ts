// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { dentroDelPoligono } from "@celda/dominio/barrio";
import {
  LimitesDeMunicipios,
  municipioDelPunto,
  PadronDeMunicipios,
} from "@celda/dominio/municipio";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { leerMunicipios } from "./descargaDeMunicipios.ts";
import { cruzarConElPadron, ficheroDeMunicipios, ficheroDePadron } from "./municipios.ts";

/** Los ficheros que escribe `pnpm run municipios`, tal como están en el repositorio. */
const MUNICIPIOS = "../../convex/datos/municipios.json";
const PADRON = "../../convex/datos/padron.json";

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));
const decodificarPadron = Schema.decodeEffect(Schema.fromJsonString(PadronDeMunicipios));

const leer = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const textoLimites = yield* fs.readFileString(MUNICIPIOS);
  const textoPadron = yield* fs.readFileString(PADRON);
  return {
    textoLimites,
    textoPadron,
    limites: yield* decodificarLimites(textoLimites),
    padron: yield* decodificarPadron(textoPadron),
    indice: yield* leerMunicipios(MUNICIPIOS),
  };
}).pipe(Effect.provide(NodeServices.layer));

/** Casos de verdad: dónde está el punto y qué municipio y qué provincia le tocan. */
const CASOS: ReadonlyArray<
  readonly [string, number, number, string | undefined, string | undefined]
> = [
  ["plaza de Catalunya", 2.17, 41.387, "08019", "08"],
  ["L'Hospitalet de Llobregat", 2.1, 41.36, "08101", "08"],
  ["Puerta del Sol", -3.7038, 40.4168, "28079", "28"],
  ["Ceuta", -5.316, 35.889, "51001", "51"],
  ["Melilla", -2.938, 35.292, "52001", "52"],
  ["Palma, en Mallorca", 2.6502, 39.5696, "07040", "07"],
  ["Santa Cruz de Tenerife", -16.2519, 28.4636, "38038", "38"],
  ["Valverde, en El Hierro", -17.915, 27.81, "38048", "38"],
  ["Llívia, rodeada de Francia", 1.9807, 42.4637, "17094", "17"],
  ["el Condado de Treviño, de Burgos y rodeado de Álava", -2.747, 42.735, "09109", "09"],
  ["Bardenas Reales, territorio compartido de Navarra", -1.49, 42.19, undefined, "31"],
  ["Gibraltar, sin provincia", -5.3536, 36.1408, undefined, undefined],
  ["el mar, a 10 km de Barcelona", 2.3, 41.3, undefined, undefined],
];

describe("límites de municipios guardados en el repositorio", () => {
  it.effect("tienen los 8.132 municipios, 81 territorios compartidos y 52 provincias", () =>
    Effect.gen(function* () {
      const { limites, padron } = yield* leer;
      const porTipo = (tipo: string) => limites.territorios.filter((t) => t.tipo === tipo).length;
      assert.strictEqual(porTipo("municipio"), 8132);
      assert.strictEqual(porTipo("compartido"), 81);
      assert.strictEqual(porTipo("sin-provincia"), 7);
      assert.lengthOf(limites.provincias, 52);
      assert.strictEqual(limites.fuente.licencia, "CC BY 4.0");
      assert.strictEqual(padron.fuente.licencia, "CC BY 4.0");
      assert.isTrue(Result.isSuccess(cruzarConElPadron(limites, padron)));
    }),
  );

  it.effect("son lo que escribe la orden, byte a byte", () =>
    Effect.gen(function* () {
      const { textoLimites, textoPadron, limites, padron } = yield* leer;
      assert.isTrue(ficheroDeMunicipios(limites) === textoLimites);
      assert.isTrue(ficheroDePadron(padron) === textoPadron);
    }),
  );

  it.effect("ponen cada punto de prueba en su municipio y su provincia", () =>
    Effect.gen(function* () {
      const { indice } = yield* leer;
      for (const [lugar, longitud, latitud, municipio, provincia] of CASOS) {
        const asignado = municipioDelPunto({ longitud, latitud }, indice);
        assert.deepStrictEqual(
          [asignado.municipio?.codigo, asignado.provincia?.codigo],
          [municipio, provincia],
          lugar,
        );
      }
    }),
  );

  it.effect("un punto en el mar junto a la playa de la Barceloneta es de Barcelona", () =>
    Effect.gen(function* () {
      const { indice } = yield* leer;
      const enElAgua = { longitud: 2.196, latitud: 41.3765 };
      const enAlguno = indice.territorios.some((_, i) =>
        indice.poligonosDe(i).some((poligono) => dentroDelPoligono(enElAgua, poligono)),
      );
      assert.isFalse(enAlguno, "el punto tiene que caer fuera de la costa simplificada");
      assert.strictEqual(municipioDelPunto(enElAgua, indice).municipio?.codigo, "08019");
    }),
  );
});
