import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

/**
 * Capas publicadas. Cada versión es un fichero inmutable en el origen estático; esta tabla dice
 * cuál es y dónde está. La vigente es la de la instantánea más reciente.
 */
export default Table.make(() =>
  Schema.Struct({
    /** `sitios@<fecha ISO>`, igual que el nombre del fichero y su cabecera. */
    version: Schema.String,
    /** Fecha de la instantánea de la que sale, en milisegundos. */
    fecha: Schema.Finite,
    url: Schema.String,
    emplazamientos: Schema.Int,
    /** Tamaño del fichero sin comprimir. */
    bytes: Schema.Int,
    publicadaEn: Schema.Finite,
  }),
)
  .index("por_version", ["version"])
  .index("por_fecha", ["fecha"]);
