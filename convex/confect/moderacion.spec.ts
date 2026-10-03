import { AportacionCompartible } from "@celda/dominio/aportacion";
import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { EstadoDeModeracion } from "./tables/aportaciones";
import { TipoDeVeto } from "./tables/vetos";

/** Ninguna aportación tiene ese identificador. */
export class AportacionDesconocida extends Schema.TaggedError<AportacionDesconocida>()(
  "AportacionDesconocida",
  { id: Schema.String },
) {}

/** Un motivo de moderación: siempre hace falta uno, al aceptar, al rechazar y al vetar. */
const Motivo = Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(500)));

/** Una aportación compartida tal como la ve la moderación. */
export const AportacionEnCola = Schema.Struct({
  id: Schema.String,
  /** El `_id` de la identidad que la envió: el historial de quien envía sale de aquí. */
  identidad: Schema.String,
  /** La huella de la IP, si aún no han pasado 24 horas. */
  huellaIp: Schema.NullOr(Schema.String),
  recibidaEl: Schema.Finite,
  contenido: AportacionCompartible,
  estado: EstadoDeModeracion,
  moderadaEl: Schema.NullOr(Schema.Finite),
  motivo: Schema.NullOr(Schema.String),
  /** Si la identidad o la huella que la enviaron están vetadas. */
  vetada: Schema.Boolean,
});
export type AportacionEnCola = typeof AportacionEnCola.Type;

/** Una página de la cola: sigue después de `ultima` mientras no sea nula. */
export const PaginaDeCola = Schema.Struct({
  aportaciones: Schema.Array(AportacionEnCola),
  ultima: Schema.NullOr(Schema.Finite),
});

/**
 * Lo que necesita la herramienta de moderación (#57), que habla con Convex por estas funciones
 * internas con la clave de administración. Son la costura con ella: listar, aceptar, rechazar,
 * vetar y leer lo aceptado para la publicación nocturna. Ninguna es pública.
 */
export default GroupSpec.make()
  .addFunction(
    /** Las pendientes, de la más antigua a la más reciente, después de `despuesDe` (`recibidaEl`). */
    FunctionSpec.internalQuery({
      name: "pendientes",
      args: () => ({ despuesDe: Schema.NullOr(Schema.Finite), limite: Schema.Int }),
      returns: () => PaginaDeCola,
    }),
  )
  .addFunction(
    /**
     * Las aceptadas después de `despuesDe` (`moderadaEl`), en el orden en que se aceptaron: lo que
     * la ingesta nocturna lleva a la publicación. Leer dos veces lo mismo da lo mismo.
     */
    FunctionSpec.internalQuery({
      name: "aceptadas",
      args: () => ({ despuesDe: Schema.NullOr(Schema.Finite), limite: Schema.Int }),
      returns: () => PaginaDeCola,
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "aceptar",
      args: () => ({ id: Schema.String, motivo: Motivo }),
      returns: () => AportacionEnCola,
      error: () => AportacionDesconocida,
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "rechazar",
      args: () => ({ id: Schema.String, motivo: Motivo }),
      returns: () => AportacionEnCola,
      error: () => AportacionDesconocida,
    }),
  )
  .addFunction(
    /** Veta una identidad (su `_id`) o una huella de IP. Vetar dos veces lo mismo no repite el veto. */
    FunctionSpec.internalMutation({
      name: "vetar",
      args: () => ({ tipo: TipoDeVeto, valor: Schema.String, motivo: Motivo }),
      returns: () => Schema.Struct({ nuevo: Schema.Boolean }),
    }),
  );
