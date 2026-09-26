import { compararBandas } from "@celda/dominio/banda";
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
    const porFuente = yield* Effect.forEach(Fuente.literals, (fuente) =>
      Effect.map(
        reader
          .table("ejecuciones")
          .index("por_fuente", (q) => q.eq("fuente", fuente), "desc")
          .take(50),
        (ejecuciones) => ({
          consulta: Option.fromNullishOr(ejecuciones.find((e) => e.estado === "completada")).pipe(
            Option.map((e) => ({ fuente, consultadoEl: e.inicio })),
          ),
          // Un emplazamiento retirado se borra y no deja versión: la fecha de su retirada es
          // la de la ejecución que lo retiró.
          retirada: Option.fromNullishOr(
            ejecuciones.find(
              (e) => e.estado === "completada" && e.cambios.emplazamientos.retirados > 0,
            ),
          ).pipe(Option.map((e) => e.inicio)),
        }),
      ),
    );
    const candidatas = [
      ...Option.toArray(Option.map(ultimo, (e) => e.version)),
      ...porFuente.flatMap((f) => Option.toArray(f.retirada)),
    ];
    return {
      version: candidatas.length === 0 ? null : Math.max(...candidatas),
      consultas: porFuente.flatMap((f) => Option.toArray(f.consulta)),
    };
  }).pipe(Effect.orDie),
);

/**
 * La ficha de un emplazamiento: sus campos, sus estaciones base con las bandas ordenadas y, para
 * cada una, las observaciones de las que sale con su fecha y su enlace. Lee el emplazamiento,
 * sus estaciones (una por compañía) y una observación por código.
 */
const ficha = FunctionImpl.make(databaseSchema, datos, "ficha", ({ clave }) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const encontrado = yield* reader
      .table("emplazamientos")
      .index("por_clave", (q) => q.eq("clave", clave))
      .first();
    if (Option.isNone(encontrado)) {
      return Option.none();
    }
    const emplazamiento = encontrado.value;
    const guardadas = yield* reader
      .table("estacionesBase")
      .index("por_emplazamiento", (q) => q.eq("emplazamiento", clave))
      .collect();
    const estaciones = yield* Effect.forEach(guardadas, (estacion) =>
      Effect.map(
        Effect.forEach(estacion.observaciones, ({ fuente, clave: claveFuente }) =>
          reader
            .table("observaciones")
            .index("por_clave", (q) => q.eq("fuente", fuente).eq("clave", claveFuente))
            .first(),
        ),
        (observaciones) => ({
          compania: estacion.compania,
          codigos: estacion.codigos,
          bandas: estacion.bandas.toSorted(compararBandas),
          origenes: observaciones
            .flatMap(Option.toArray)
            .map(({ fuente, clave: claveFuente, url, fecha, afirma }) => ({
              fuente,
              clave: claveFuente,
              url,
              fecha,
              afirma,
            })),
        }),
      ),
    );
    return Option.some({
      clave: emplazamiento.clave,
      posicion: emplazamiento.posicion,
      direccion: emplazamiento.direccion,
      municipio: emplazamiento.municipio,
      estado: emplazamiento.estado,
      confianza: emplazamiento.confianza,
      conflictos: emplazamiento.conflictos,
      estaciones,
      datosDel: emplazamiento.datosDel,
      version: emplazamiento.version,
    });
  }).pipe(Effect.orDie),
);

export default GroupImpl.make(databaseSchema, datos).pipe(
  Layer.provide(version),
  Layer.provide(ficha),
  GroupImpl.finalize,
);
