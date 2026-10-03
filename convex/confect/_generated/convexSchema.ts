import { defineSchema as $defineSchema } from "convex/server";
import { Table as $Table } from "@confect/server";

import aportaciones from "./tables/aportaciones";
import huellasDeIp from "./tables/huellasDeIp";
import identidades from "./tables/identidades";
import salesDeIp from "./tables/salesDeIp";
import vetos from "./tables/vetos";

export default $defineSchema({
  aportaciones: $Table.tableDefinition(aportaciones),
  huellasDeIp: $Table.tableDefinition(huellasDeIp),
  identidades: $Table.tableDefinition(identidades),
  salesDeIp: $Table.tableDefinition(salesDeIp),
  vetos: $Table.tableDefinition(vetos),
});
