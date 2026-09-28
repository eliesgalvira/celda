import { CapaPublicada, EmplazamientoDeCapa } from "@celda/dominio/capa";
import { Ficha } from "@celda/dominio/ficha";
import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

/** Una página de la instantánea, leída por clave: sigue después de `ultima` mientras no sea nula. */
export const PaginaDeInstantanea = Schema.Struct({
  elementos: Schema.Array(EmplazamientoDeCapa),
  ultima: Schema.NullOr(Schema.String),
});

/**
 * Capas: la instantánea de la que sale cada capa, las fichas que se publican con ella, el
 * registro de las publicadas y la última. Todas son internas: las usa la publicación, dentro de
 * Convex o con la clave de administración del despliegue. La web no las llama; lee la capa y las
 * fichas del almacén de ficheros (ADR 0008).
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
    /**
     * Las fichas de unos emplazamientos, en el orden de `claves`. Una clave sin emplazamiento no
     * da ficha: quien publica comprueba que estén todas.
     */
    FunctionSpec.internalQuery({
      name: "fichas",
      args: () => ({ claves: Schema.Array(Schema.String) }),
      returns: () => Schema.Array(Ficha),
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
    FunctionSpec.internalQuery({
      name: "vigente",
      returns: () => Schema.OptionFromNullOr(CapaPublicada),
    }),
  );
