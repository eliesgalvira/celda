import { Fuente } from "@celda/dominio/observacion";
import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

export const EstadoEjecucion = Schema.Literals([
  "en curso",
  "completada",
  "fallida",
  "omitida",
  "interrumpida",
]);
export type EstadoEjecucion = typeof EstadoEjecucion.Type;

const Cuentas = Schema.Struct({
  creados: Schema.Int,
  cambiados: Schema.Int,
  retirados: Schema.Int,
});

/** Lo que ha escrito una ejecución. Todo a cero si no ha cambiado nada. */
export const Cambios = Schema.Struct({
  observaciones: Cuentas,
  fichas: Schema.Struct({ leidas: Schema.Int, cambiadas: Schema.Int }),
  emplazamientos: Cuentas,
});
export type Cambios = typeof Cambios.Type;

export const SIN_CAMBIOS: Cambios = {
  observaciones: { creados: 0, cambiados: 0, retirados: 0 },
  fichas: { leidas: 0, cambiadas: 0 },
  emplazamientos: { creados: 0, cambiados: 0, retirados: 0 },
};

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
