import { Fuente } from "@celda/dominio/observacion";
import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import emplazamientos from "./_generated/tables/emplazamientos";
import estacionesBase from "./_generated/tables/estacionesBase";

/** De dónde sale un dato de la ficha: fuente, enlace y desde cuándo lo dice. */
export const Origen = Schema.Struct({
  fuente: Fuente,
  clave: Schema.String,
  url: Schema.String,
  fecha: Schema.Finite,
});

export const Ficha = Schema.Struct({
  emplazamiento: emplazamientos.Doc,
  estaciones: Schema.Array(estacionesBase.Doc),
  origenes: Schema.Array(Origen),
});

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
    FunctionSpec.publicQuery({
      name: "ficha",
      args: () => ({ clave: Schema.String }),
      returns: () => Schema.OptionFromNullOr(Ficha),
    }),
  );
