import { DatabaseSchema as $DatabaseSchema } from "@confect/server";

import ejecuciones from "./tables/ejecuciones";
import emplazamientos from "./tables/emplazamientos";
import estacionesBase from "./tables/estacionesBase";
import interruptores from "./tables/interruptores";
import observaciones from "./tables/observaciones";

const databaseSchema: $DatabaseSchema.DatabaseSchema<{
  readonly ejecuciones: typeof ejecuciones;
  readonly emplazamientos: typeof emplazamientos;
  readonly estacionesBase: typeof estacionesBase;
  readonly interruptores: typeof interruptores;
  readonly observaciones: typeof observaciones;
}> = $DatabaseSchema.make({
  ejecuciones,
  emplazamientos,
  estacionesBase,
  interruptores,
  observaciones,
});

export default databaseSchema;
