import { CapaPublicada, EmplazamientoDeCapa } from "@celda/dominio/capa";
import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

/** Una página de la instantánea, leída por clave: sigue después de `ultima` mientras no sea nula. */
export const PaginaDeInstantanea = Schema.Struct({
  elementos: Schema.Array(EmplazamientoDeCapa),
  ultima: Schema.NullOr(Schema.String),
});

/**
 * Capas: la instantánea de la que sale cada capa, el registro de las publicadas y la vigente.
 * Leer la instantánea y registrar una capa son funciones internas: solo las usa el generador de
 * capas, con la clave de administración del despliegue.
 */
export default GroupSpec.make()
  .addFunction(
    FunctionSpec.internalQuery({
      name: "instantanea",
      args: () => ({ despuesDe: Schema.NullOr(Schema.String), limite: Schema.Int }),
      returns: () => PaginaDeInstantanea,
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "registrar",
      args: () => ({
        version: Schema.String,
        fecha: Schema.Finite,
        url: Schema.String,
        emplazamientos: Schema.Int,
        bytes: Schema.Int,
        publicadaEn: Schema.Finite,
      }),
      returns: () => Schema.Struct({ nueva: Schema.Boolean }),
    }),
  )
  .addFunction(
    FunctionSpec.publicQuery({
      name: "vigente",
      returns: () => Schema.OptionFromNullOr(CapaPublicada),
    }),
  );
