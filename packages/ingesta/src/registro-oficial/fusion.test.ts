// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { Emplazamiento } from "@celda/dominio/emplazamiento";
import { fusionar } from "@celda/dominio/fusion";
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
    bandas: fichas.get(registro.clave) ?? [],
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
});
