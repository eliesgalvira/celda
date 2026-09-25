import { Observacion } from "@celda/dominio/observacion";
import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

/**
 * Lo último que dice cada fuente de cada estación base. `fecha` cambia solo cuando cambia lo
 * que dice la fuente, así que una ejecución sin cambios no escribe nada.
 */
export default Table.make(() =>
  Schema.Struct({
    ...Observacion.fields,
    /** Cuándo se leyó la ficha por última vez. Nulo si está pendiente. */
    fichaLeidaEn: Schema.NullOr(Schema.Finite),
    /** Barridos completos seguidos en los que el listado no la trae. */
    ausencias: Schema.Int,
    /** Cuándo se dio por retirada: tras dos barridos completos sin verla. */
    retiradaEn: Schema.NullOr(Schema.Finite),
  }),
)
  .index("por_clave", ["fuente", "clave"])
  .index("por_ficha", ["fuente", "fichaLeidaEn"]);
