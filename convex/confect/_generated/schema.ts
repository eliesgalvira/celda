import { DatabaseSchema as $DatabaseSchema } from "@confect/server";

import aportaciones from "./tables/aportaciones";
import huellasDeIp from "./tables/huellasDeIp";
import identidades from "./tables/identidades";
import salesDeIp from "./tables/salesDeIp";
import vetos from "./tables/vetos";

const databaseSchema: $DatabaseSchema.DatabaseSchema<{
  readonly aportaciones: typeof aportaciones;
  readonly huellasDeIp: typeof huellasDeIp;
  readonly identidades: typeof identidades;
  readonly salesDeIp: typeof salesDeIp;
  readonly vetos: typeof vetos;
}> = $DatabaseSchema.make({
  aportaciones,
  huellasDeIp,
  identidades,
  salesDeIp,
  vetos,
});

export default databaseSchema;
