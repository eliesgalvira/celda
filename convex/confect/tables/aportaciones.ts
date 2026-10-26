import { AportacionCompartible, TIPOS_COMPARTIBLES } from "@celda/dominio/aportacion";
import { EstadoDeModeracion } from "@celda/dominio/moderacion";
import { GenericId, Table } from "@confect/core";
import * as Schema from "effect/Schema";

/**
 * Una aportación compartida: la cola de moderación (ADR 0020). Llega pendiente y solo la
 * herramienta de moderación (#57) la acepta o la rechaza, con su motivo. Nada de esta tabla sale
 * por una función pública: lo aceptado llega al público por la publicación nocturna.
 */
export default Table.make(() =>
  Schema.Struct({
    /** El identificador que puso el dispositivo: la clave idempotente del envío. */
    id: Schema.String,
    tipo: Schema.Literals(TIPOS_COMPARTIBLES),
    identidad: GenericId.GenericId("identidades"),
    /** HMAC de la IP con la sal del día. Lo borra la limpieza a las 24 horas. */
    huellaIp: Schema.NullOr(Schema.String),
    recibidaEl: Schema.Finite,
    contenido: AportacionCompartible,
    /**
     * El emplazamiento al que se refiere, o `null` si dice que falta uno. Va fuera del contenido
     * para buscar las demás aportaciones del mismo emplazamiento.
     */
    emplazamiento: Schema.NullOr(Schema.String),
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
  .index("por_emplazamiento", ["emplazamiento", "recibidaEl"])
  .index("por_huella", ["huellaIp"]);
