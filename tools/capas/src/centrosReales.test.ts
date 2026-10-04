// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { Coordenada } from "@celda/dominio/area";
import { LimitesDeMunicipios, PadronDeMunicipios } from "@celda/dominio/municipio";
import { dentroDelPoligono } from "@celda/dominio/poligono";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  centrosDeProvincia,
  ficheroDeCentros,
  ficheroDeCiudades,
  PRECISION_CENTROS_METROS,
  type ProvinciaConCentro,
  tablaDeCentros,
  tablaDeCiudades,
  TOLERANCIA_CENTROS_METROS,
} from "./centros.ts";

/** Los límites y el padrón del repositorio, y lo que escribe `pnpm run centros`. */
const MUNICIPIOS = "../../packages/publicacion/datos/municipios.json";
const PADRON = "../../packages/publicacion/datos/padron.json";
const CENTROS = "../../packages/dominio/datos/centros-de-provincia.json";
const CIUDADES = "../../packages/dominio/datos/habitantes-de-ciudades.json";

const decodificarLimites = Schema.decodeEffect(Schema.fromJsonString(LimitesDeMunicipios));
const decodificarPadron = Schema.decodeEffect(Schema.fromJsonString(PadronDeMunicipios));

const leer = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const limites = yield* decodificarLimites(yield* fs.readFileString(MUNICIPIOS));
  const padron = yield* decodificarPadron(yield* fs.readFileString(PADRON));
  return {
    limites,
    padron,
    provincias: Result.getOrThrow(
      centrosDeProvincia(limites, padron, TOLERANCIA_CENTROS_METROS, PRECISION_CENTROS_METROS),
    ),
    centros: yield* fs.readFileString(CENTROS),
    ciudades: yield* fs.readFileString(CIUDADES),
  };
}).pipe(Effect.provide(NodeServices.layer));

/** Metros entre dos puntos cercanos. */
const metros = ([x1, y1]: readonly [number, number], [x2, y2]: readonly [number, number]) =>
  Math.hypot(
    (x1 - x2) * 111_320 * Math.cos((((y1 + y2) / 2) * Math.PI) / 180),
    (y1 - y2) * 110_574,
  );

/**
 * Los centros que salieron en el prototipo (e0b75de, `PROTOTIPO.md`), que el usuario vio en el
 * mapa: las islas, las provincias con islas o enclaves y las más grandes.
 */
const DEL_PROTOTIPO: ReadonlyArray<readonly [string, string, readonly [number, number]]> = [
  ["07", "Illes Balears, en Mallorca", [3.017, 39.578]],
  ["35", "Las Palmas, en Gran Canaria", [-15.583, 27.946]],
  ["38", "Santa Cruz de Tenerife, en Tenerife", [-16.618, 28.223]],
  ["15", "A Coruña, en la península", [-8.608, 43.03]],
  ["36", "Pontevedra, en la península", [-8.546, 42.568]],
  ["11", "Cádiz, en la península", [-5.897, 36.605]],
  ["06", "Badajoz", [-6.373, 38.563]],
  ["10", "Cáceres", [-6.18, 39.747]],
  ["31", "Navarra", [-1.74, 42.684]],
  ["46", "València", [-0.729, 39.237]],
];

const etiquetaDe = (limites: LimitesDeMunicipios, codigo: string): Coordenada => {
  const territorio = limites.territorios.find((t) => t.codigo === codigo);
  assert.isDefined(territorio, codigo);
  return territorio?.etiqueta ?? { longitud: 0, latitud: 0 };
};

const provincia = (provincias: ReadonlyArray<ProvinciaConCentro>, codigo: string) => {
  const suya = provincias.find((p) => p.codigo === codigo);
  assert.isDefined(suya, codigo);
  return suya ?? provincias[0];
};

describe("centros de provincia de los límites del repositorio", () => {
  it.effect("los ficheros están al día con los límites y el padrón", () =>
    Effect.gen(function* () {
      const { limites, padron, provincias, centros, ciudades } = yield* leer;
      assert.lengthOf(provincias, 52);
      assert.strictEqual(centros, ficheroDeCentros(tablaDeCentros(limites, padron, provincias)));
      assert.strictEqual(ciudades, ficheroDeCiudades(tablaDeCiudades(limites, padron)));
    }),
  );

  it.effect("caen a menos de 200 m de los que salieron en el prototipo", () =>
    Effect.gen(function* () {
      const { provincias } = yield* leer;
      for (const [codigo, nombre, esperado] of DEL_PROTOTIPO) {
        const { centro } = provincia(provincias, codigo)?.centro ?? { centro: [0, 0] as const };
        assert.isAtMost(metros(centro, esperado), 200, nombre);
      }
    }),
  );

  it.effect(
    "en las islas, el polígono más poblado: Gran Canaria y no Fuerteventura, que es mayor",
    () =>
      Effect.gen(function* () {
        const { limites, provincias } = yield* leer;
        const casos: ReadonlyArray<readonly [string, string]> = [
          ["07", "07040"], // Palma, en Mallorca
          ["35", "35016"], // Las Palmas de Gran Canaria
          ["38", "38038"], // Santa Cruz de Tenerife
        ];
        for (const [codigo, capital] of casos) {
          const elegido = provincia(provincias, codigo)?.poligonos[0];
          assert.isTrue(
            dentroDelPoligono(etiquetaDe(limites, capital), elegido?.poligono ?? []),
            `${codigo}: la capital no está en el polígono elegido`,
          );
        }
        const palmas = provincia(provincias, "35")?.poligonos ?? [];
        const fuerteventura = palmas.find((p) =>
          dentroDelPoligono(etiquetaDe(limites, "35017"), p.poligono),
        );
        assert.isAbove(fuerteventura?.areaKm2 ?? 0, palmas[0]?.areaKm2 ?? 0);
        assert.isBelow(fuerteventura?.habitantes ?? 0, palmas[0]?.habitantes ?? 0);
      }),
  );

  it.effect("en A Coruña, Pontevedra y Cádiz, la península, no una isla", () =>
    Effect.gen(function* () {
      const { limites, provincias } = yield* leer;
      for (const [codigo, capital] of [
        ["15", "15030"],
        ["36", "36038"],
        ["11", "11012"],
      ] as const) {
        const suya = provincia(provincias, codigo);
        assert.isAbove(suya?.poligonos.length ?? 0, 1, `${codigo} tiene islas`);
        const mayor = Math.max(...(suya?.poligonos ?? []).map((p) => p.areaKm2));
        assert.strictEqual(suya?.poligonos[0]?.areaKm2, mayor, codigo);
        assert.isTrue(
          dentroDelPoligono(etiquetaDe(limites, capital), suya?.poligonos[0]?.poligono ?? []),
          codigo,
        );
      }
      // A Illa de Arousa, con su padrón, queda aparte.
      const pontevedra = provincia(provincias, "36")?.poligonos ?? [];
      const illa = pontevedra.findIndex((p) =>
        dentroDelPoligono(etiquetaDe(limites, "36901"), p.poligono),
      );
      assert.isAbove(illa, 0);
    }),
  );

  it.effect("Navarra sin el enclave de Petilla de Aragón y València sin el Rincón de Ademuz", () =>
    Effect.gen(function* () {
      const { limites, provincias } = yield* leer;
      for (const [codigo, capital, aparte] of [
        ["31", "31201", "31203"],
        ["46", "46250", "46001"],
      ] as const) {
        const [principal, ...otros] = provincia(provincias, codigo)?.poligonos ?? [];
        assert.isTrue(dentroDelPoligono(etiquetaDe(limites, capital), principal?.poligono ?? []));
        assert.isFalse(dentroDelPoligono(etiquetaDe(limites, aparte), principal?.poligono ?? []));
        assert.isTrue(
          otros.some((p) => dentroDelPoligono(etiquetaDe(limites, aparte), p.poligono)),
          `${aparte} va en otro polígono`,
        );
      }
    }),
  );

  it.effect("Álava rodea el condado de Treviño, de Burgos, y su centro no cae en él", () =>
    Effect.gen(function* () {
      const { limites, provincias } = yield* leer;
      const alava = provincia(provincias, "01");
      const [principal] = alava?.poligonos ?? [];
      assert.isAbove(principal?.poligono.length ?? 0, 1, "sin agujero");
      const trevino = etiquetaDe(limites, "09109");
      assert.isFalse(dentroDelPoligono(trevino, principal?.poligono ?? []));
      const [longitud = 0, latitud = 0] = alava?.centro.centro ?? [];
      assert.isTrue(dentroDelPoligono({ longitud, latitud }, principal?.poligono ?? []));
    }),
  );
});
