import { Fuente } from "@celda/dominio/observacion";
import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "./_generated/schema";
import { DatabaseReader } from "./_generated/services";
import datos from "./datos.spec";

const version = FunctionImpl.make(databaseSchema, datos, "version", () =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const ultimo = yield* reader.table("emplazamientos").index("por_version", "desc").first();
    const consultas = yield* Effect.forEach(Fuente.literals, (fuente) =>
      Effect.map(
        reader
          .table("ejecuciones")
          .index("por_fuente", (q) => q.eq("fuente", fuente), "desc")
          .take(50),
        (ejecuciones) =>
          Option.fromNullishOr(ejecuciones.find((e) => e.estado === "completada")).pipe(
            Option.map((e) => ({ fuente, consultadoEl: e.inicio })),
          ),
      ),
    );
    return {
      version: Option.match(ultimo, { onNone: () => null, onSome: (e) => e.version }),
      consultas: consultas.flatMap(Option.toArray),
    };
  }).pipe(Effect.orDie),
);

const ficha = FunctionImpl.make(databaseSchema, datos, "ficha", ({ clave }) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const emplazamiento = yield* reader
      .table("emplazamientos")
      .index("por_clave", (q) => q.eq("clave", clave))
      .first();
    if (Option.isNone(emplazamiento)) {
      return Option.none();
    }
    const estaciones = yield* reader
      .table("estacionesBase")
      .index("por_emplazamiento", (q) => q.eq("emplazamiento", clave))
      .collect();
    const origenes = yield* Effect.forEach(
      estaciones.flatMap((e) => e.observaciones),
      ({ fuente, clave: claveFuente }) =>
        reader
          .table("observaciones")
          .index("por_clave", (q) => q.eq("fuente", fuente).eq("clave", claveFuente))
          .first()
          .pipe(
            Effect.map(
              Option.map((o) => ({ fuente: o.fuente, clave: o.clave, url: o.url, fecha: o.fecha })),
            ),
          ),
    );
    return Option.some({
      emplazamiento: emplazamiento.value,
      estaciones,
      origenes: origenes.flatMap(Option.toArray),
    });
  }).pipe(Effect.orDie),
);

export default GroupImpl.make(databaseSchema, datos).pipe(
  Layer.provide(version),
  Layer.provide(ficha),
  GroupImpl.finalize,
);
