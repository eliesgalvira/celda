import { Fuente } from "@celda/dominio/observacion";
import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

/**
 * Interruptor de cada extractor. Sin fila, vale `INTERRUPTOR_POR_DEFECTO`
 * (`@celda/ingesta/ejecucion`).
 */
export default Table.make(() =>
  Schema.Struct({
    fuente: Fuente,
    activo: Schema.Boolean,
    motivo: Schema.String,
    cambiadoEn: Schema.Finite,
  }),
).index("por_fuente", ["fuente"]);
