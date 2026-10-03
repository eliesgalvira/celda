import { defineSchema as $defineSchema } from "convex/server";
import { Table as $Table } from "@confect/server";

import ejecuciones from "./tables/ejecuciones";
import emplazamientos from "./tables/emplazamientos";
import estacionesBase from "./tables/estacionesBase";
import interruptores from "./tables/interruptores";
import observaciones from "./tables/observaciones";
import versionesCapa from "./tables/versionesCapa";

export default $defineSchema({
  ejecuciones: $Table.tableDefinition(ejecuciones),
  emplazamientos: $Table.tableDefinition(emplazamientos),
  estacionesBase: $Table.tableDefinition(estacionesBase),
  interruptores: $Table.tableDefinition(interruptores),
  observaciones: $Table.tableDefinition(observaciones),
  versionesCapa: $Table.tableDefinition(versionesCapa),
});
