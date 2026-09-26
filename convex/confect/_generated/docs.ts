import type { Document } from "@confect/server";
import type schemaDefinition from "./schema";

export type EjecucionesDoc = Document.Document<typeof schemaDefinition, "ejecuciones">;
export type EmplazamientosDoc = Document.Document<typeof schemaDefinition, "emplazamientos">;
export type EstacionesBaseDoc = Document.Document<typeof schemaDefinition, "estacionesBase">;
export type InterruptoresDoc = Document.Document<typeof schemaDefinition, "interruptores">;
export type ObservacionesDoc = Document.Document<typeof schemaDefinition, "observaciones">;
export type PuntosDoc = Document.Document<typeof schemaDefinition, "puntos">;
export type VersionesCapaDoc = Document.Document<typeof schemaDefinition, "versionesCapa">;

export interface Docs {
  ejecuciones: EjecucionesDoc;
  emplazamientos: EmplazamientosDoc;
  estacionesBase: EstacionesBaseDoc;
  interruptores: InterruptoresDoc;
  observaciones: ObservacionesDoc;
  puntos: PuntosDoc;
  versionesCapa: VersionesCapaDoc;
}
