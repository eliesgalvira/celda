import { type Ficha, fichaDe } from "@celda/dominio/ficha";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { DatabaseReader } from "../confect/_generated/services";

/**
 * La ficha de un emplazamiento (`fichaDe`): lee el emplazamiento, sus estaciones (una por
 * compañía) y una observación por código. `None` si no hay ningún emplazamiento con esa clave
 * exacta.
 */
export const leerFicha = Effect.fn("Lecturas.ficha")(function* (clave: string) {
  const reader = yield* DatabaseReader;
  const encontrado = yield* reader
    .table("emplazamientos")
    .index("por_clave", (q) => q.eq("clave", clave))
    .first();
  if (Option.isNone(encontrado)) {
    return Option.none<Ficha>();
  }
  const { version, ...emplazamiento } = encontrado.value;
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
      (observaciones) => ({ estacion, observaciones: observaciones.flatMap(Option.toArray) }),
    ),
  );
  return Option.some(fichaDe(emplazamiento, version, estaciones));
});
