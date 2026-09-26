import { Ficha } from "@celda/dominio/ficha";
import { Fuente } from "@celda/dominio/observacion";
import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

/** Versión de los datos: la marca de agua con la que se comparan las vistas. */
export const Version = Schema.Struct({
  /**
   * Fecha de la ejecución que cambió los emplazamientos por última vez, también si solo retiró
   * alguno. Nula sin datos. De ella sale la versión de la capa.
   */
  version: Schema.NullOr(Schema.Finite),
  /** Última ejecución completa de cada fuente: «consultado el». */
  consultas: Schema.Array(Schema.Struct({ fuente: Fuente, consultadoEl: Schema.Finite })),
});

export default GroupSpec.make()
  .addFunction(
    FunctionSpec.publicQuery({
      name: "version",
      returns: () => Version,
    }),
  )
  .addFunction(
    /**
     * La ficha de un emplazamiento para el panel, con la marca de agua de sus datos. Nula si no
     * hay ningún emplazamiento con esa clave, por ejemplo porque se retiró después de la capa.
     */
    FunctionSpec.publicQuery({
      name: "ficha",
      args: () => ({ clave: Schema.String }),
      returns: () => Schema.OptionFromNullOr(Ficha),
    }),
  );
