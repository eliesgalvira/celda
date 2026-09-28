import { Fuente } from "@celda/dominio/observacion";
import { Cambios, EstadoEjecucion } from "@celda/ingesta/ejecucion";
import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

/** Una pasada de un extractor, con sus fechas, lo que ha cambiado y sus errores. */
export default Table.make(() =>
  Schema.Struct({
    fuente: Fuente,
    inicio: Schema.Finite,
    fin: Schema.NullOr(Schema.Finite),
    estado: EstadoEjecucion,
    /** Registros que trajo el listado, si se llegó a leer. */
    registros: Schema.NullOr(Schema.Int),
    cambios: Cambios,
    errores: Schema.Array(Schema.String),
  }),
).index("por_fuente", ["fuente", "inicio"]);
