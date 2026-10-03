import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

/**
 * La sal de cada día (UTC) con la que se calcula la huella de la IP. Cambia cada día y la de un
 * día pasado se borra, así que la huella de una IP de ayer no se puede volver a calcular.
 */
export default Table.make(() =>
  Schema.Struct({
    /** El día, como «2026-10-03». */
    dia: Schema.String,
    /** 32 bytes aleatorios en base64url. */
    sal: Schema.String,
  }),
).index("por_dia", ["dia"]);
