import type { Extractor } from "@celda/ingesta/extractor";
import { MutationRunner, QueryRunner } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { DatabaseReader } from "../confect/_generated/services";
import emplazamientos from "../confect/_generated/tables/emplazamientos";
import estacionesBase from "../confect/_generated/tables/estacionesBase";
import observaciones from "../confect/_generated/tables/observaciones";
import { ejecutarIngesta, OPCIONES_PROCESO, type OpcionesProceso } from "../src/proceso";
import * as TestConfect from "./TestConfect";

/**
 * Una ejecución del proceso de ingesta contra el Convex en memoria: las mutaciones y consultas
 * van por la API interna de Convex, como en la acción real, y el extractor es el que se pase.
 */
export const ejecutar = (
  extractor: Layer.Layer<Extractor>,
  opciones: OpcionesProceso = OPCIONES_PROCESO,
) =>
  Effect.gen(function* () {
    const convex = yield* TestConfect.TestConfect;
    return yield* ejecutarIngesta(opciones).pipe(
      Effect.provide(
        Layer.mergeAll(
          extractor,
          Layer.succeed(MutationRunner.MutationRunner, convex.mutation),
          Layer.succeed(QueryRunner.QueryRunner, convex.query),
        ),
      ),
    );
  });

interface Instantanea {
  readonly observaciones: ReadonlyArray<typeof observaciones.Doc.Type>;
  readonly emplazamientos: ReadonlyArray<typeof emplazamientos.Doc.Type>;
  readonly estaciones: ReadonlyArray<typeof estacionesBase.Doc.Type>;
}

/** Todos los datos de la base, para comparar antes y después de una ejecución. */
export const instantanea = Effect.gen(function* () {
  const convex = yield* TestConfect.TestConfect;
  const leida = yield* Ref.make<Instantanea>({
    observaciones: [],
    emplazamientos: [],
    estaciones: [],
  });
  yield* convex.run(
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      yield* Ref.set(leida, {
        observaciones: yield* reader.table("observaciones").index("por_clave").collect(),
        emplazamientos: yield* reader.table("emplazamientos").index("por_clave").collect(),
        estaciones: yield* reader.table("estacionesBase").index("por_emplazamiento").collect(),
      });
    }).pipe(Effect.orDie),
  );
  return yield* Ref.get(leida);
});

type ConSistema = { readonly _id: string; readonly _creationTime: number };

/** Los documentos sin `_id` ni `_creationTime`, para comparar dos bases distintas. */
export const sinSistema = <Documento extends ConSistema>(documentos: ReadonlyArray<Documento>) =>
  documentos.map(({ _id, _creationTime, ...resto }) => resto);
