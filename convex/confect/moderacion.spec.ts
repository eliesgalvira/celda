import {
  AportacionDesconocida,
  AportacionEnCola,
  AportacionYaModerada,
  CONTEXTOS_POR_LLAMADA,
  ContextoEnElBuzon,
  Motivo,
  PAGINA_MAXIMA,
  PaginaDeCola,
  PaginaParaPublicar,
  TipoDeVeto,
} from "@celda/dominio/moderacion";
import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

export { AportacionDesconocida, AportacionYaModerada };

const Limite = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: PAGINA_MAXIMA })),
);

/**
 * Lo que necesita la herramienta de moderación (#57), que habla con Convex por estas funciones
 * internas con la clave de administración: listar con su contexto, aceptar, rechazar, vetar y leer
 * lo aceptado para la publicación nocturna. Ninguna es pública.
 */
export default GroupSpec.make()
  .addFunction(
    /** Las pendientes, de la más antigua a la más reciente, después de `despuesDe` (`recibidaEl`). */
    FunctionSpec.internalQuery({
      name: "pendientes",
      args: () => ({ despuesDe: Schema.NullOr(Schema.Finite), limite: Limite }),
      returns: () => PaginaDeCola,
    }),
  )
  .addFunction(
    /**
     * Lo que sabe el buzón de cada aportación, en el mismo orden: el historial de quien la envió y
     * las demás del mismo emplazamiento. Como mucho `CONTEXTOS_POR_LLAMADA` de una vez.
     */
    FunctionSpec.internalQuery({
      name: "contexto",
      args: () => ({
        ids: Schema.Array(Schema.String).pipe(
          Schema.check(Schema.isMaxLength(CONTEXTOS_POR_LLAMADA)),
        ),
      }),
      returns: () => Schema.Array(ContextoEnElBuzon),
      error: () => AportacionDesconocida,
    }),
  )
  .addFunction(
    /**
     * Las aceptadas después de `despuesDe` (`moderadaEl`), en el orden en que se aceptaron: lo que
     * la ingesta nocturna lleva a la publicación. Dos aceptadas nunca tienen la misma hora, así que
     * seguir desde la última no se salta ninguna, y leer dos veces lo mismo da lo mismo.
     */
    FunctionSpec.internalQuery({
      name: "aceptadas",
      args: () => ({ despuesDe: Schema.NullOr(Schema.Finite), limite: Limite }),
      returns: () => PaginaDeCola,
    }),
  )
  .addFunction(
    /**
     * Lo aceptado para la publicación nocturna, como `aceptadas` pero con lo mínimo: solo
     * correcciones propuestas y corroboraciones, sin la nota, sin la huella de la IP y con un
     * seudónimo en lugar de la identidad (`AceptadaParaPublicar`). La llama la acción HTTP de
     * `confect/http.ts`, que es lo único que ve la noche.
     */
    FunctionSpec.internalQuery({
      name: "publicables",
      args: () => ({ despuesDe: Schema.NullOr(Schema.Finite), limite: Limite }),
      returns: () => PaginaParaPublicar,
    }),
  )
  .addFunction(
    /** Acepta una pendiente. Aceptar otra vez una aceptada no cambia nada. */
    FunctionSpec.internalMutation({
      name: "aceptar",
      args: () => ({ id: Schema.String, motivo: Motivo }),
      returns: () => AportacionEnCola,
      error: () => Schema.Union([AportacionDesconocida, AportacionYaModerada]),
    }),
  )
  .addFunction(
    /** Rechaza una pendiente. Rechazar otra vez una rechazada no cambia nada. */
    FunctionSpec.internalMutation({
      name: "rechazar",
      args: () => ({ id: Schema.String, motivo: Motivo }),
      returns: () => AportacionEnCola,
      error: () => Schema.Union([AportacionDesconocida, AportacionYaModerada]),
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
