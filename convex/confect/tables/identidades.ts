import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

/**
 * La identidad anónima de un dispositivo, que crea el buzón al pedirla (ADR 0020). El dispositivo
 * recibe un token firmado con su `_id` y lo presenta en cada envío. No guarda nada de la persona:
 * solo cuándo se creó y, durante 24 horas como mucho, la huella de la IP desde la que se pidió.
 */
export default Table.make(() =>
  Schema.Struct({
    creadaEl: Schema.Finite,
    /** HMAC de la IP con la sal del día. Lo borra la limpieza a las 24 horas. */
    huellaIp: Schema.NullOr(Schema.String),
  }),
).index("por_huella", ["huellaIp"]);
