import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

/** Lo que borra el buzón por el RGPD (ADR 0020). La lanza el cron cada hora. */
export default GroupSpec.make().addFunction(
  /**
   * Borra las huellas de IP de más de 24 horas y todo lo que las lleva (aportaciones, identidades,
   * vetos y cubos de los límites por IP), y las sales de los días pasados. Devuelve cuántas
   * huellas y cuántas sales ha borrado.
   */
  FunctionSpec.internalMutation({
    name: "huellas",
    returns: () => Schema.Struct({ huellas: Schema.Int, sales: Schema.Int }),
  }),
);
