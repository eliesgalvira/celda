import { DatabaseSchema as $DatabaseSchema } from "@confect/server";

import ejecuciones from "./tables/ejecuciones";
import emplazamientos from "./tables/emplazamientos";
import estacionesBase from "./tables/estacionesBase";
import interruptores from "./tables/interruptores";
import observaciones from "./tables/observaciones";
import puntos from "./tables/puntos";
import versionesCapa from "./tables/versionesCapa";

const databaseSchema: $DatabaseSchema.DatabaseSchema<{
  readonly ejecuciones: typeof ejecuciones;
  readonly emplazamientos: typeof emplazamientos;
  readonly estacionesBase: typeof estacionesBase;
  readonly interruptores: typeof interruptores;
  readonly observaciones: typeof observaciones;
  readonly puntos: typeof puntos;
  readonly versionesCapa: typeof versionesCapa;
}> = $DatabaseSchema.make({
  ejecuciones,
  emplazamientos,
  estacionesBase,
  interruptores,
  observaciones,
  puntos,
  versionesCapa,
});

export default databaseSchema;
