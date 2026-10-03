import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "./_generated/schema";
import { DatabaseReader, DatabaseWriter } from "./_generated/services";
import moderacion, { AportacionDesconocida, type AportacionEnCola } from "./moderacion.spec";
import type { EstadoDeModeracion } from "./tables/aportaciones";

type Fila = typeof import("./_generated/tables/aportaciones").default.Doc.Type;

/** La aportación como la ve la moderación, con si quien la envió está vetado. */
const enCola = Effect.fn("Moderacion.enCola")(function* (fila: Fila) {
  const reader = yield* DatabaseReader;
  const vetado = (tipo: "identidad" | "ip", valor: string | null) =>
    valor === null
      ? Effect.succeed(false)
      : Effect.map(
          reader
            .table("vetos")
            .index("por_valor", (q) => q.eq("tipo", tipo).eq("valor", valor))
            .first(),
          Option.isSome,
        );
  const vetada =
    (yield* vetado("identidad", fila.identidad)) || (yield* vetado("ip", fila.huellaIp));
  return {
    id: fila.id,
    identidad: fila.identidad,
    huellaIp: fila.huellaIp,
    recibidaEl: fila.recibidaEl,
    contenido: fila.contenido,
    estado: fila.estado,
    moderadaEl: fila.moderadaEl,
    motivo: fila.motivo,
    vetada,
  } satisfies AportacionEnCola;
});

/** Una página de la cola; sigue después de la última si ha llegado al límite. */
const pagina = (
  filas: ReadonlyArray<Fila>,
  limite: number,
  cursor: (fila: Fila) => number | null,
) =>
  Effect.map(Effect.forEach(filas, enCola), (aportaciones) => {
    const ultima = filas.at(-1);
    return {
      aportaciones,
      ultima: ultima === undefined || filas.length < limite ? null : cursor(ultima),
    };
  });

const pendientes = FunctionImpl.make(
  databaseSchema,
  moderacion,
  "pendientes",
  ({ despuesDe, limite }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const filas = yield* reader
        .table("aportaciones")
        .index("por_estado", (q) => {
          const pendiente = q.eq("estado", "pendiente");
          return despuesDe === null ? pendiente : pendiente.gt("recibidaEl", despuesDe);
        })
        .take(limite);
      return yield* pagina(filas, limite, (fila) => fila.recibidaEl);
    }).pipe(Effect.orDie),
);

const aceptadas = FunctionImpl.make(
  databaseSchema,
  moderacion,
  "aceptadas",
  ({ despuesDe, limite }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const filas = yield* reader
        .table("aportaciones")
        .index("por_moderacion", (q) => {
          const aceptada = q.eq("estado", "aceptada");
          return despuesDe === null ? aceptada : aceptada.gt("moderadaEl", despuesDe);
        })
        .take(limite);
      return yield* pagina(filas, limite, (fila) => fila.moderadaEl);
    }).pipe(Effect.orDie),
);

/** Pone el veredicto de la moderación, con su motivo y su hora. */
const moderar = Effect.fn("Moderacion.moderar")(function* (
  id: string,
  estado: Exclude<EstadoDeModeracion, "pendiente">,
  motivo: string,
) {
  const reader = yield* DatabaseReader;
  const writer = yield* DatabaseWriter;
  const fila = yield* reader
    .table("aportaciones")
    .index("por_id", (q) => q.eq("id", id))
    .first();
  if (Option.isNone(fila)) return yield* new AportacionDesconocida({ id });
  const moderadaEl = yield* Clock.currentTimeMillis;
  yield* writer.table("aportaciones").patch(fila.value._id, { estado, moderadaEl, motivo });
  return yield* enCola({ ...fila.value, estado, moderadaEl, motivo });
});

const soloDesconocida = <A, E, R>(efecto: Effect.Effect<A, E, R>) =>
  Effect.catch(efecto, (error) =>
    error instanceof AportacionDesconocida ? Effect.fail(error) : Effect.die(error),
  );

const aceptar = FunctionImpl.make(databaseSchema, moderacion, "aceptar", ({ id, motivo }) =>
  soloDesconocida(moderar(id, "aceptada", motivo)),
);

const rechazar = FunctionImpl.make(databaseSchema, moderacion, "rechazar", ({ id, motivo }) =>
  soloDesconocida(moderar(id, "rechazada", motivo)),
);

const vetar = FunctionImpl.make(databaseSchema, moderacion, "vetar", ({ tipo, valor, motivo }) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const previo = yield* reader
      .table("vetos")
      .index("por_valor", (q) => q.eq("tipo", tipo).eq("valor", valor))
      .first();
    if (Option.isSome(previo)) return { nuevo: false };
    yield* writer
      .table("vetos")
      .insert({ tipo, valor, motivo, creadoEl: yield* Clock.currentTimeMillis });
    return { nuevo: true };
  }).pipe(Effect.orDie),
);

export default GroupImpl.make(databaseSchema, moderacion).pipe(
  Layer.provide(pendientes),
  Layer.provide(aceptadas),
  Layer.provide(aceptar),
  Layer.provide(rechazar),
  Layer.provide(vetar),
  GroupImpl.finalize,
);
