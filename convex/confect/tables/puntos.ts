import { Fuente } from "@celda/dominio/observacion";
import { Punto } from "@celda/ingesta/extractor";
import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

/**
 * Puntos del listado de las fuentes que agrupan estaciones base, como los marcadores de
 * antenasmoviles.es. Cada punto guarda la huella de lo que dice el listado de él, cuándo se
 * leyó su detalle y qué observaciones salieron de ese detalle.
 */
export default Table.make(() =>
  Schema.Struct({
    fuente: Fuente,
    ...Punto.fields,
    /** Cuándo se leyó el detalle por última vez. Nulo si está pendiente. */
    detalleLeidoEn: Schema.NullOr(Schema.Finite),
    /** Claves de las observaciones que salieron de su último detalle. */
    observaciones: Schema.Array(Schema.String),
    /** Barridos completos seguidos en los que el listado no lo trae. */
    ausencias: Schema.Int,
    /** Cuándo se dio por retirado: tras dos barridos completos sin verlo. */
    retiradoEn: Schema.NullOr(Schema.Finite),
  }),
)
  .index("por_clave", ["fuente", "clave"])
  // Los pendientes primero (nulos), y entre ellos los de menos prioridad numérica.
  .index("por_detalle", ["fuente", "detalleLeidoEn", "prioridad"]);
