import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

/**
 * Cada huella de IP que ha visto el buzón, con la primera vez que la vio. La limpieza borra a las
 * 24 horas la fila y todo lo que lleva la huella: las aportaciones, las identidades, los vetos y
 * los cubos de los límites por IP (ADR 0020).
 */
export default Table.make(() =>
  Schema.Struct({
    huella: Schema.String,
    vistaEl: Schema.Finite,
  }),
)
  .index("por_huella", ["huella"])
  .index("por_vista", ["vistaEl"]);
