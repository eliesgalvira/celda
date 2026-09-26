import { Fuente } from "@celda/dominio/observacion";
import { Table } from "@confect/core";
import * as Schema from "effect/Schema";

/** Cómo está un extractor mientras nadie haya tocado su interruptor. */
export interface Interruptor {
  readonly activo: boolean;
  readonly motivo: string;
}

/**
 * Interruptor de cada fuente sin fila en la tabla. antenasmoviles.es empieza apagado: antes de
 * publicar sus datos hay que escribir a su administrador (investigación de fuentes comunitarias).
 */
export const INTERRUPTOR_POR_DEFECTO: Readonly<Record<Fuente, Interruptor>> = {
  "registro-oficial": { activo: true, motivo: "" },
  antenasmoviles: {
    activo: false,
    motivo: "apagado por defecto hasta escribir a su administrador antes de publicar sus datos",
  },
  opencellid: { activo: false, motivo: "apagado por defecto: aún no tiene extractor" },
};

/** Interruptor de cada extractor. Sin fila, vale `INTERRUPTOR_POR_DEFECTO`. */
export default Table.make(() =>
  Schema.Struct({
    fuente: Fuente,
    activo: Schema.Boolean,
    motivo: Schema.String,
    cambiadoEn: Schema.Finite,
  }),
).index("por_fuente", ["fuente"]);
