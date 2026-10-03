import { GenericId } from "@confect/core";

export type TableNames = "aportaciones" | "huellasDeIp" | "identidades" | "salesDeIp" | "vetos";

export const Id = <const TableName extends TableNames>(
  tableName: TableName,
) => GenericId.GenericId(tableName);
