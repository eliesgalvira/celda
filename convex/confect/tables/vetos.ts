import { TipoDeVeto } from "@celda/dominio/moderacion";
import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

/**
 * Lo que la moderación ha vetado (ADR 0020). Las funciones de envío lo miran antes que nada. El
 * veto de una IP lleva su huella, así que dura lo que dura la huella: la limpieza lo borra con
 * ella a las 24 horas, y con la sal de otro día la misma IP ya da otra huella.
 */
export default Table.make(() =>
  Schema.Struct({
    tipo: TipoDeVeto,
    valor: Schema.String,
    motivo: Schema.String,
    creadoEl: Schema.Finite,
  }),
).index("por_valor", ["tipo", "valor"]);
