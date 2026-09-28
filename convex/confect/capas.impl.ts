import type { BandasDeCapa } from "@celda/dominio/capa";
import type { EstacionBase } from "@celda/dominio/emplazamiento";
import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { leerFicha } from "../src/lecturas";
import databaseSchema from "./_generated/schema";
import { DatabaseReader, DatabaseWriter } from "./_generated/services";
import capas from "./capas.spec";

/**
 * Las bandas de cada estación base que el registro ya ha dado, sin repetir. Una estación base de
 * la que no se conoce ninguna no aparece: en la capa, eso es «sin leer», no «sin bandas».
 */
const bandasConocidas = (
  estaciones: ReadonlyArray<Pick<EstacionBase, "compania" | "bandas">>,
): Array<BandasDeCapa> =>
  estaciones.flatMap(({ compania, bandas }) => {
    const mhz = [...new Set(bandas.flatMap((b) => (b.mhz === null ? [] : [b.mhz])))].toSorted(
      (a, b) => a - b,
    );
    return mhz.length === 0 ? [] : [{ compania, mhz }];
  });

/**
 * Una página de emplazamientos con sus compañías y sus bandas. Lee `limite` emplazamientos y sus estaciones
 * base (entre una y cuatro cada uno), lejos del límite de 4096 lecturas por función.
 */
const instantanea = FunctionImpl.make(
  databaseSchema,
  capas,
  "instantanea",
  ({ despuesDe, limite }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const pagina = yield* reader
        .table("emplazamientos")
        .index("por_clave", (q) => (despuesDe === null ? q : q.gt("clave", despuesDe)))
        .take(limite);
      const elementos = yield* Effect.forEach(pagina, (e) =>
        Effect.map(
          reader
            .table("estacionesBase")
            .index("por_emplazamiento", (q) => q.eq("emplazamiento", e.clave))
            .collect(),
          (estaciones) => ({
            clave: e.clave,
            posicion: e.posicion,
            estado: e.estado,
            companias: estaciones.map((estacion) => estacion.compania),
            bandas: bandasConocidas(estaciones),
          }),
        ),
      );
      return {
        elementos,
        ultima: pagina.length < limite ? null : (pagina.at(-1)?.clave ?? null),
      };
    }).pipe(Effect.orDie),
);

/**
 * Las fichas de un lote. Con 64 emplazamientos lee unos 500 documentos, lejos del límite de 4096
 * lecturas por función.
 */
const fichas = FunctionImpl.make(databaseSchema, capas, "fichas", ({ claves }) =>
  Effect.forEach(claves, leerFicha).pipe(
    Effect.map((leidas) => leidas.flatMap(Option.toArray)),
    Effect.orDie,
  ),
);

/**
 * Apunta una capa publicada. Registrar otra vez la misma versión solo actualiza su URL: el
 * fichero es el mismo y puede haber cambiado de origen.
 */
const registrar = FunctionImpl.make(databaseSchema, capas, "registrar", (capa) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const previa = yield* reader
      .table("versionesCapa")
      .index("por_version", (q) => q.eq("version", capa.version))
      .first();
    if (Option.isNone(previa)) {
      yield* writer.table("versionesCapa").insert(capa);
      return { nueva: true };
    }
    if (previa.value.url !== capa.url) {
      yield* writer.table("versionesCapa").patch(previa.value._id, { url: capa.url });
    }
    return { nueva: false };
  }).pipe(Effect.orDie),
);

/** La última capa registrada: la de la instantánea más reciente. */
const vigente = FunctionImpl.make(databaseSchema, capas, "vigente", () =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const ultima = yield* reader.table("versionesCapa").index("por_fecha", "desc").first();
    return Option.map(ultima, ({ version, fecha, url, emplazamientos }) => ({
      version,
      fecha,
      url,
      emplazamientos,
    }));
  }).pipe(Effect.orDie),
);

export default GroupImpl.make(databaseSchema, capas).pipe(
  Layer.provide(instantanea),
  Layer.provide(fichas),
  Layer.provide(registrar),
  Layer.provide(vigente),
  GroupImpl.finalize,
);
