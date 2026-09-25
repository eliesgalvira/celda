import { EmplazamientoSinEstaciones } from "@celda/dominio/emplazamiento";
import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

/**
 * Emplazamientos canónicos que salen de la fusión. Sus estaciones base viven en su propia
 * tabla, para que un cambio en una banda no reescriba el emplazamiento entero.
 */
export default Table.make(() =>
  Schema.Struct({
    ...EmplazamientoSinEstaciones.fields,
    /** Fecha de la ejecución que lo cambió por última vez: la versión de sus datos. */
    version: Schema.Finite,
  }),
)
  .index("por_clave", ["clave"])
  .index("por_version", ["version"]);
