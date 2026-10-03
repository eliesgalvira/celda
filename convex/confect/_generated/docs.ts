import type { Document } from "@confect/server";
import type schemaDefinition from "./schema";

export type AportacionesDoc = Document.Document<typeof schemaDefinition, "aportaciones">;
export type HuellasDeIpDoc = Document.Document<typeof schemaDefinition, "huellasDeIp">;
export type IdentidadesDoc = Document.Document<typeof schemaDefinition, "identidades">;
export type SalesDeIpDoc = Document.Document<typeof schemaDefinition, "salesDeIp">;
export type VetosDoc = Document.Document<typeof schemaDefinition, "vetos">;

export interface Docs {
  aportaciones: AportacionesDoc;
  huellasDeIp: HuellasDeIpDoc;
  identidades: IdentidadesDoc;
  salesDeIp: SalesDeIpDoc;
  vetos: VetosDoc;
}
