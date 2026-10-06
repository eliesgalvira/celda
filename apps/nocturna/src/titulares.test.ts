// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { conEntorno, unaNoche } from "./pruebas/entorno.ts";
import { type ElementoDelListado, fichasGrabadas, geoportal } from "./pruebas/geoportal.ts";

const NOCHE = Date.UTC(2026, 9, 7, 2, 15);
const DIA = 86_400_000;

/** Un elemento del listado en el Campus Nord, de otro titular. */
const elemento = (id: string, codigo: string): ElementoDelListado => ({
  type: "Feature",
  id,
  geometry: { type: "Point", coordinates: [2.1151, 41.3871] },
  properties: { Gis_ID: codigo, Dirección: "CL Jordi Girona, 31. BARCELONA, BARCELONA" },
});

describe("titulares que no son los de siempre", () => {
  it.effect(
    "Retevisión Móvil entra como Orange y una licencia local se guarda aparte, fuera del mapa",
    () =>
      conEntorno((entorno) =>
        Effect.gen(function* () {
          const grabadas = yield* fichasGrabadas;
          const fichas = yield* Ref.make(grabadas.fichas);
          const listado = yield* Ref.make(
            (elementos: ReadonlyArray<ElementoDelListado>): ReadonlyArray<ElementoDelListado> => [
              ...elementos,
              elemento("RETEVISION MOVIL SA - 300123", "300123"),
              elemento("TELEAST DIGITAL, S.L. - 77", "77"),
            ],
          );
          const registro = yield* geoportal(fichas, listado);
          for (const noche of [0, 1]) {
            yield* TestClock.setTime(NOCHE + noche * DIA);
            yield* unaNoche(entorno, yield* registro.extractor);
          }
          const tablas = yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return {
              observaciones: yield* sql<{
                readonly clave: string;
                readonly compania: string;
              }>`SELECT clave, json_extract(datos, '$.compania') AS compania FROM observaciones
                  WHERE clave LIKE 'RETEVISION%' OR clave LIKE 'TELEAST%'`,
              otros: yield* sql`SELECT clave, titular, visto_desde, vista_en FROM otros_titulares`,
            };
          }).pipe(Effect.provide(SqliteClient.layer({ filename: entorno.base })));
          assert.deepStrictEqual(tablas.observaciones, [
            { clave: "RETEVISION MOVIL SA - 300123", compania: "orange" },
          ]);
          assert.deepStrictEqual(tablas.otros, [
            {
              clave: "TELEAST DIGITAL, S.L. - 77",
              titular: "TELEAST DIGITAL, S.L.",
              visto_desde: NOCHE,
              vista_en: NOCHE + DIA,
            },
          ]);
        }),
      ),
  );
});
