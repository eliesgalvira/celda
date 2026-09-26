// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { Emplazamiento } from "@celda/dominio/emplazamiento";
import { fusionar } from "@celda/dominio/fusion";
import type { Observacion } from "@celda/dominio/observacion";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { movistarUrquinaona, muestraAntenasMoviles } from "../pruebas/antenasmoviles.ts";
import { muestraCampusNord } from "../pruebas/grabado.ts";

const FECHA = Date.UTC(2026, 8, 26);
const DESPUES = Date.UTC(2026, 8, 27);

const json = (emplazamientos: ReadonlyArray<Emplazamiento>) =>
  `${JSON.stringify(emplazamientos, null, 2)}\n`;

/**
 * Las observaciones que guardarían las dos ingestas: el registro oficial de Campus Nord y la
 * estación de Urquinaona, y lo que antenasmoviles.es dice de sus puntos grabados un día después.
 */
const observaciones = Effect.gen(function* () {
  const { listado, fichas } = yield* muestraCampusNord;
  const registro = listado.registros.map((r): Observacion => ({
    ...r,
    fuente: "registro-oficial",
    bandas: fichas.get(r.clave) ?? [],
    fecha: FECHA,
    afirma: "presente",
  }));
  const comunidad = yield* muestraAntenasMoviles;
  const correcciones = [...comunidad.detalles.values()].flatMap((d) =>
    d.observaciones.map((o): Observacion => ({
      ...o,
      fuente: "antenasmoviles",
      bandas: [],
      fecha: DESPUES,
    })),
  );
  return [...registro, movistarUrquinaona(FECHA), ...correcciones];
});

const conMuestras = Effect.provide(NodeServices.layer);

describe("fusión del registro oficial con antenasmoviles.es grabados", () => {
  it.effect("coincide con el resultado de referencia", () =>
    Effect.gen(function* () {
      const emplazamientos = fusionar(yield* observaciones);
      yield* Effect.promise(() =>
        expect(json(emplazamientos)).toMatchFileSnapshot(
          "./referencia/fusion-campus-nord-con-comunidad.json",
        ),
      );
    }).pipe(conMuestras),
  );

  it.effect("corregido: la estación de Vodafone de la entrada del campus, desmontada", () =>
    Effect.gen(function* () {
      const emplazamientos = fusionar(yield* observaciones);
      const campus = emplazamientos.find((e) => e.clave === "movistar-0802532");
      assert.strictEqual(campus?.estado, "corregido");
      assert.strictEqual(campus?.confianza, "baja");
      assert.deepStrictEqual(campus?.conflictos, [
        {
          tipo: "desmontada",
          compania: "vodafone",
          procedencia: { fuente: "antenasmoviles", clave: "vodafone - 086040" },
          fecha: DESPUES,
        },
      ]);
      // El registro sigue diciendo lo suyo: la estación de Vodafone conserva sus bandas.
      const vodafone = campus?.estaciones.find((e) => e.compania === "vodafone");
      assert.deepStrictEqual(vodafone?.codigos, ["086040", "86040"]);
      assert.deepStrictEqual(
        vodafone?.observaciones.map((o) => o.fuente),
        ["registro-oficial", "registro-oficial", "antenasmoviles"],
      );
    }).pipe(conMuestras),
  );

  it.effect("nuevo y corregido: las dos ER5 grabadas", () =>
    Effect.gen(function* () {
      const emplazamientos = fusionar(yield* observaciones);
      const tarragona = emplazamientos.find((e) => e.clave === "movistar-MV-BCN-82383");
      assert.strictEqual(tarragona?.estado, "nuevo");
      assert.strictEqual(
        tarragona?.direccion,
        "Carrer de Tarragona, 177, Sants-Montjuïc, 08014 Barcelona",
      );
      // La ER5 de Orange está a 7 m de Movistar en el registro: añade una compañía allí.
      const urquinaona = emplazamientos.find((e) => e.clave === "movistar-0800542");
      assert.strictEqual(urquinaona?.estado, "corregido");
      assert.deepStrictEqual(
        urquinaona?.estaciones.map((e) => [e.compania, e.codigos]),
        [
          ["movistar", ["0800542"]],
          ["orange", ["CATR6031A"]],
        ],
      );
      assert.deepStrictEqual(urquinaona?.conflictos, []);
    }).pipe(conMuestras),
  );

  it.effect("verificado: el resto, que antenasmoviles.es copia del registro", () =>
    Effect.gen(function* () {
      const emplazamientos = fusionar(yield* observaciones);
      const estados = emplazamientos.map((e) => e.estado);
      assert.strictEqual(emplazamientos.length, 19 + 2);
      assert.strictEqual(estados.filter((e) => e === "verificado").length, 18);
      assert.strictEqual(estados.filter((e) => e === "corregido").length, 2);
      assert.strictEqual(estados.filter((e) => e === "nuevo").length, 1);
    }).pipe(conMuestras),
  );
});
