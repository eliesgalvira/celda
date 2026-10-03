import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { diaUtc, VIDA_DE_UNA_HUELLA_MS } from "../src/huella";
import { olvidarHuella } from "../src/limites";
import refs from "./_generated/refs";
import databaseSchema from "./_generated/schema";
import { DatabaseReader, DatabaseWriter, MutationCtx, Scheduler } from "./_generated/services";
import limpieza from "./limpieza.spec";

/**
 * Huellas que se borran en una pasada. Una huella puede llevar unas 650 filas en un día (los
 * límites por IP de las tres aportaciones y de las identidades), así que cinco quedan lejos del
 * tope de escrituras de una mutación. Si quedan más, la pasada lanza la siguiente.
 */
const HUELLAS_POR_PASADA = 5;

/** Borra una huella y la quita de todo lo que la lleva. */
const borrarHuella = Effect.fn("Limpieza.borrarHuella")(function* (fila: {
  readonly _id: typeof import("./_generated/tables/huellasDeIp").default.Doc.Type._id;
  readonly huella: string;
}) {
  const ctx = yield* MutationCtx;
  const reader = yield* DatabaseReader;
  const writer = yield* DatabaseWriter;
  const { huella } = fila;
  const aportaciones = yield* reader
    .table("aportaciones")
    .index("por_huella", (q) => q.eq("huellaIp", huella))
    .collect();
  yield* Effect.forEach(
    aportaciones,
    (a) => writer.table("aportaciones").patch(a._id, { huellaIp: null }),
    { discard: true },
  );
  const identidades = yield* reader
    .table("identidades")
    .index("por_huella", (q) => q.eq("huellaIp", huella))
    .collect();
  yield* Effect.forEach(
    identidades,
    (i) => writer.table("identidades").patch(i._id, { huellaIp: null }),
    { discard: true },
  );
  const vetos = yield* reader
    .table("vetos")
    .index("por_valor", (q) => q.eq("tipo", "ip").eq("valor", huella))
    .collect();
  yield* Effect.forEach(vetos, (v) => writer.table("vetos").delete(v._id), { discard: true });
  yield* olvidarHuella(ctx, huella);
  yield* writer.table("huellasDeIp").delete(fila._id);
});

const huellas = FunctionImpl.make(databaseSchema, limpieza, "huellas", () =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const scheduler = yield* Scheduler;
    const ahora = yield* Clock.currentTimeMillis;

    const viejas = yield* reader
      .table("huellasDeIp")
      .index("por_vista", (q) => q.lte("vistaEl", ahora - VIDA_DE_UNA_HUELLA_MS))
      .take(HUELLAS_POR_PASADA);
    yield* Effect.forEach(viejas, borrarHuella, { discard: true });
    if (viejas.length === HUELLAS_POR_PASADA) {
      yield* scheduler.runAfter(Duration.zero, refs.internal.limpieza.huellas, {});
    }

    // Con la sal de un día pasado ya no se calcula ninguna huella: se borra en cuanto cambia el día.
    const sales = yield* reader
      .table("salesDeIp")
      .index("por_dia", (q) => q.lt("dia", diaUtc(ahora)))
      .collect();
    yield* Effect.forEach(sales, (s) => writer.table("salesDeIp").delete(s._id), {
      discard: true,
    });
    return { huellas: viejas.length, sales: sales.length };
  }).pipe(Effect.orDie),
);

export default GroupImpl.make(databaseSchema, limpieza).pipe(
  Layer.provide(huellas),
  GroupImpl.finalize,
);
