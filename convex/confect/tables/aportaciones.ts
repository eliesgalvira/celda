import { AportacionCompartible } from "@celda/dominio/aportacion";
import { GenericId, Table } from "@confect/core";
import * as Schema from "effect/Schema";

/** En qué punto de la moderación está una aportación compartida. */
export const EstadoDeModeracion = Schema.Literals(["pendiente", "aceptada", "rechazada"]);
export type EstadoDeModeracion = typeof EstadoDeModeracion.Type;

/**
 * Una aportación compartida: la cola de moderación (ADR 0020). Llega pendiente y solo la
 * herramienta de moderación (#57) la acepta o la rechaza, con su motivo. Nada de esta tabla sale
 * por una función pública: lo aceptado llega al público por la publicación nocturna.
 */
export default Table.make(() =>
  Schema.Struct({
    /** El identificador que puso el dispositivo: la clave idempotente del envío. */
    id: Schema.String,
    tipo: Schema.Literals(["propia", "correccion-propuesta", "corroboracion"]),
    identidad: GenericId.GenericId("identidades"),
    /** HMAC de la IP con la sal del día. Lo borra la limpieza a las 24 horas. */
    huellaIp: Schema.NullOr(Schema.String),
    recibidaEl: Schema.Finite,
    contenido: AportacionCompartible,
    estado: EstadoDeModeracion,
    /** Cuándo la aceptó o la rechazó la moderación. */
    moderadaEl: Schema.NullOr(Schema.Finite),
    /** Por qué la aceptó o la rechazó. */
    motivo: Schema.NullOr(Schema.String),
  }),
)
  .index("por_id", ["id"])
  .index("por_estado", ["estado", "recibidaEl"])
  .index("por_moderacion", ["estado", "moderadaEl"])
  .index("por_identidad", ["identidad", "recibidaEl"])
  .index("por_huella", ["huellaIp"]);
