// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { Extractor } from "@celda/ingesta/extractor";
import { OPCIONES_PROCESO, type OpcionesProceso } from "@celda/ingesta/proceso";
import { MutationRunner, QueryRunner } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { DatabaseReader } from "../confect/_generated/services";
import emplazamientos from "../confect/_generated/tables/emplazamientos";
import estacionesBase from "../confect/_generated/tables/estacionesBase";
import observaciones from "../confect/_generated/tables/observaciones";
import { Publicacion } from "../src/publicacion";
import { ejecutarIngesta } from "../src/proceso";
import * as TestConfect from "./TestConfect";

/** Una publicación que no publica, como la de un despliegue sin almacén de ficheros. */
export const sinAlmacen = Layer.succeed(
  Publicacion,
  Publicacion.of({ publicar: Effect.succeed({ tipo: "sin-almacen" }) }),
);

/** Las consultas y mutaciones del Convex en memoria, como las da Confect a una acción. */
export const convexEnMemoria = Effect.map(TestConfect.TestConfect, (convex) =>
  Layer.merge(
    Layer.succeed(MutationRunner.MutationRunner, convex.mutation),
    Layer.succeed(QueryRunner.QueryRunner, convex.query),
  ),
);

/**
 * Una ejecución del proceso de ingesta contra el Convex en memoria: las mutaciones y consultas
 * van por la API interna de Convex, como en la acción real, y el extractor y la publicación son
 * los que se pasen. Sin publicación, no publica nada.
 */
export const ejecutar = (
  extractor: Layer.Layer<Extractor>,
  opciones: OpcionesProceso = OPCIONES_PROCESO,
  publicacion: Layer.Layer<Publicacion> = sinAlmacen,
) =>
  Effect.gen(function* () {
    return yield* ejecutarIngesta(opciones).pipe(
      Effect.provide(Layer.mergeAll(extractor, yield* convexEnMemoria, publicacion)),
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
