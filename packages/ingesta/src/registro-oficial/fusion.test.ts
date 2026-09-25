import { fusionar } from "@celda/dominio/fusion";
import type { Observacion } from "@celda/dominio/observacion";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { muestraCampusNord } from "../pruebas/grabado.ts";

const FECHA = Date.UTC(2026, 8, 26);

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
        expect(`${JSON.stringify(emplazamientos, null, 2)}\n`).toMatchFileSnapshot(
          "./referencia/fusion-campus-nord.json",
        ),
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
