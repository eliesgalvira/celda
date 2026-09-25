import { EstacionBase } from "@celda/dominio/emplazamiento";
import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

/** Estaciones base de cada emplazamiento, una por compañía, con sus bandas. */
export default Table.make(() =>
  Schema.Struct({
    ...EstacionBase.fields,
    /** Clave del emplazamiento. */
    emplazamiento: Schema.String,
    version: Schema.Finite,
  }),
).index("por_emplazamiento", ["emplazamiento", "compania"]);
