import { compararBandas } from "@celda/dominio/banda";
import type { Ficha } from "@celda/dominio/ficha";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { DatabaseReader } from "../confect/_generated/services";

/**
 * La ficha de un emplazamiento: sus campos, sus estaciones base con las bandas ordenadas y, para
 * cada una, las observaciones de las que sale con su fecha y su enlace. Lee el emplazamiento,
 * sus estaciones (una por compañía) y una observación por código. `None` si no hay ningún
 * emplazamiento con esa clave exacta.
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
  return Option.some<Ficha>({
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
});
