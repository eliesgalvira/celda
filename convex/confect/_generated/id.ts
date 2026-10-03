import { GenericId } from "@confect/core";

export type TableNames = "ejecuciones" | "emplazamientos" | "estacionesBase" | "interruptores" | "observaciones" | "versionesCapa";

export const Id = <const TableName extends TableNames>(
  tableName: TableName,
) => GenericId.GenericId(tableName);
