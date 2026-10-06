// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { Emplazamiento } from "@celda/dominio/emplazamiento";
import { fusionar, REGLA_FUSION } from "@celda/dominio/fusion";
import type { Observacion } from "@celda/dominio/observacion";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { Registro } from "../extractor.ts";
import { listadoGrabado, muestraCampusNord } from "../pruebas/grabado.ts";

const FECHA = Date.UTC(2026, 8, 26);

/** El resultado de referencia es JSON legible, para revisarlo en cada cambio de la regla. */
const json = (emplazamientos: ReadonlyArray<Emplazamiento>) =>
  `${JSON.stringify(emplazamientos, null, 2)}\n`;

/** Las observaciones que guardaría la ingesta con la muestra de Campus Nord. */
const observacionesDeLaMuestra = Effect.map(muestraCampusNord, ({ listado, fichas }) =>
  listado.registros.map((registro): Observacion => ({
    ...registro,
    fuente: "registro-oficial",
    bandas: fichas.get(registro.clave)?.bandas ?? [],
    medidasDeExposicion: fichas.get(registro.clave)?.medidasDeExposicion ?? [],
    fecha: FECHA,
    afirma: "presente",
  })),
);

describe("fusión del registro oficial grabado en Campus Nord", () => {
  it.effect("coincide con el resultado de referencia", () =>
    Effect.gen(function* () {
      const emplazamientos = fusionar(yield* observacionesDeLaMuestra);
      yield* Effect.promise(() =>
        expect(json(emplazamientos)).toMatchFileSnapshot("./referencia/fusion-campus-nord.json"),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("la entrada del campus es un emplazamiento compartido por tres compañías", () =>
    Effect.gen(function* () {
      const emplazamientos = fusionar(yield* observacionesDeLaMuestra);
      const campus = emplazamientos.find((e) => e.clave === "movistar-0802532");
      assert.deepStrictEqual(
        campus?.estaciones.map((e) => [e.compania, e.codigos, e.bandas.length]),
        [
          ["movistar", ["0802532"], 8],
          ["orange", ["CATR0228A"], 6],
          // Dos registros de Vodafone en el mismo punto, con expedientes distintos.
          ["vodafone", ["086040", "86040"], 4],
        ],
      );
      // Los dos registros de Vodafone publican la misma medida de exposición, que cuenta una vez.
      assert.deepStrictEqual(
        campus?.estaciones.map((e) => e.medidasDeExposicion?.length),
        [5, 6, 1],
      );
      assert.strictEqual(campus?.estado, "verificado");
      assert.deepStrictEqual(campus?.conflictos, []);
      // 40 registros en 19 puntos distintos, todos a más de 15 m unos de otros.
      assert.strictEqual(emplazamientos.length, 19);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

/** Lo que guardaría la ingesta de un registro del listado, aún sin su ficha. */
const sinFicha = (registro: Registro): Observacion => ({
  ...registro,
  fuente: "registro-oficial",
  bandas: [],
  fecha: FECHA,
  afirma: "presente",
});

/**
 * Un emplazamiento por línea, con sus estaciones base y sus códigos. Es lo que cambia la regla, y
 * en el diff se ve qué emplazamientos se juntan o se separan.
 */
const lineas = (emplazamientos: ReadonlyArray<Emplazamiento>) =>
  `${emplazamientos
    .map(
      (e) =>
        `${e.clave}\t${e.estaciones.map((s) => `${s.compania}:${s.codigos.join(",")}`).join(" ")}`,
    )
    .join("\n")}\n`;

const fusionDelListado = (nombre: string) =>
  Effect.map(listadoGrabado(nombre), (listado) => fusionar(listado.registros.map(sinFicha)));

describe("fusión de los listados grabados el 28/09/2026", () => {
  for (const [nombre, registros] of [
    ["madrid-centro", 2397],
    ["barcelona", 2380],
    ["valencia-centro", 654],
  ] as const) {
    it.effect(`${nombre}: coincide con el resultado de referencia`, () =>
      Effect.gen(function* () {
        const listado = yield* listadoGrabado(nombre);
        assert.strictEqual(listado.registros.length, registros);
        assert.deepStrictEqual(listado.avisos, []);
        const emplazamientos = yield* fusionDelListado(nombre);
        yield* Effect.promise(() =>
          expect(lineas(emplazamientos)).toMatchFileSnapshot(
            `./referencia/fusion-listado-${nombre}.txt`,
          ),
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    );
  }

  it.effect(
    "Madrid: cada registro trae sus coordenadas, y la azotea y la estación siguen juntas",
    () =>
      Effect.gen(function* () {
        const emplazamientos = yield* fusionDelListado("madrid-centro");
        const con = (compania: string, codigo: string) =>
          emplazamientos
            .filter((e) =>
              e.estaciones.some((s) => s.compania === compania && s.codigos.includes(codigo)),
            )
            .map((e) => e.estaciones.map((s) => `${s.compania}:${s.codigos.join(",")}`));
        // La misma estación de Vodafone con otros ceros, a 15,4 m y en la misma dirección.
        assert.deepStrictEqual(con("vodafone", "17803"), [["vodafone:017803,17803"]]);
        // Orange y Vodafone en CL COMANDANTE FORTEA, 3, a 16,9 m.
        assert.deepStrictEqual(con("orange", "MADR3818O"), [
          ["orange:MADR3818O", "vodafone:058469,58469"],
        ]);
        // Vodafone 00073 está a 55 m de 000073 y 73, en CL LIGULA, 4-6.
        assert.deepStrictEqual(con("vodafone", "00073"), [
          ["movistar:2802294", "orange:MADR0375A", "vodafone:000073,00073,73"],
        ]);
        // Con 15 m salían 1418, y 1331 antes de reparar `±`: Telefónica escribe «Casta±eda» y
        // Orange «CASTAÑEDA» en la misma dirección, a 17 m.
        assert.strictEqual(emplazamientos.length, 1330);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "Barcelona: 24 emplazamientos juntan dos de los de solo 15 m y los demás no cambian",
    () =>
      Effect.gen(function* () {
        const observaciones = (yield* listadoGrabado("barcelona")).registros.map(sinFicha);
        const soloDistancia = fusionar(observaciones, {
          ...REGLA_FUSION,
          radioMismaDireccionMetros: 0,
          radioMismoCodigoMetros: 0,
        });
        const ahora = fusionar(observaciones);
        const firma = (e: Emplazamiento) =>
          e.estaciones.flatMap((s) => s.codigos.map((c) => `${s.compania}:${c}`)).join(" ");
        const antes = new Set(soloDistancia.map(firma));
        const cambian = ahora.filter((e) => !antes.has(firma(e)));
        assert.strictEqual(soloDistancia.length, 1318);
        assert.strictEqual(ahora.length, 1294);
        // La regla solo añade uniones: 1318 − 1294 = 24 emplazamientos nuevos que juntan dos cada uno.
        assert.strictEqual(cambian.length, 24);
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
