import { Banda } from "@celda/dominio/banda";
import { Emplazamiento } from "@celda/dominio/emplazamiento";
import { Fuente, Observacion } from "@celda/dominio/observacion";
import { ObservacionDePunto, Punto, Registro } from "@celda/ingesta/extractor";
import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "./_generated/id";
import ejecuciones from "./_generated/tables/ejecuciones";
import { Cambios } from "@celda/ingesta/ejecucion";

export const Inicio = Schema.Struct({
  tipo: Schema.Literals(["omitida", "iniciada"]),
  ejecucion: Id("ejecuciones"),
});

const Escritos = Schema.Struct({ creados: Schema.Int, cambiados: Schema.Int });

/** Estado de un extractor para el mantenedor: su interruptor y sus últimas ejecuciones. */
export const EstadoFuente = Schema.Struct({
  fuente: Fuente,
  activo: Schema.Boolean,
  motivo: Schema.String,
  ejecuciones: Schema.Array(ejecuciones.Doc),
});

/** Una página leída por clave: sigue después de `ultima` mientras no sea nula. */
const pagina = <Elemento extends Schema.Top>(elemento: Elemento) =>
  Schema.Struct({ elementos: Schema.Array(elemento), ultima: Schema.NullOr(Schema.String) });

const argumentosDePagina = { despuesDe: Schema.NullOr(Schema.String), limite: Schema.Int };

/**
 * Ingesta: las funciones internas que usa el proceso de cada extractor, el interruptor y el
 * estado de las ejecuciones, también interno. Las fechas llegan como argumento desde el proceso, que las
 * toma de su reloj. Cada función lee pocos documentos: Convex corta una función que lee más de
 * 4096, así que la fusión se lee y se escribe por páginas.
 */
export default GroupSpec.make()
  .addFunction(
    FunctionSpec.internalMutation({
      name: "iniciar",
      args: () => ({ fuente: Fuente, fecha: Schema.Finite }),
      returns: () => Inicio,
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "aplicarListado",
      args: () => ({ fuente: Fuente, fecha: Schema.Finite, registros: Schema.Array(Registro) }),
      returns: () => Escritos,
    }),
  )
  .addFunction(
    FunctionSpec.internalQuery({
      name: "pendientesDeFicha",
      args: () => ({
        fuente: Fuente,
        /** Las fichas leídas antes de esta fecha se vuelven a leer. */
        leidasAntesDe: Schema.Finite,
        limite: Schema.Int,
      }),
      returns: () => Schema.Array(Registro),
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "aplicarFicha",
      args: () => ({
        fuente: Fuente,
        clave: Schema.String,
        fecha: Schema.Finite,
        bandas: Schema.Array(Banda),
      }),
      returns: () => Schema.Boolean,
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "cerrarBarrido",
      args: () => ({
        ejecucion: Id("ejecuciones"),
        /** Todas las claves que ha traído el listado en esta ejecución. */
        vistas: Schema.Array(Schema.String),
      }),
      returns: () => Schema.Struct({ retirados: Schema.Int }),
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "aplicarPuntos",
      args: () => ({ fuente: Fuente, puntos: Schema.Array(Punto) }),
      returns: () => Escritos,
    }),
  )
  .addFunction(
    FunctionSpec.internalQuery({
      name: "pendientesDeDetalle",
      args: () => ({
        fuente: Fuente,
        /** Los detalles leídos antes de esta fecha se vuelven a leer. */
        leidosAntesDe: Schema.Finite,
        limite: Schema.Int,
      }),
      returns: () => Schema.Array(Punto),
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "aplicarDetalle",
      args: () => ({
        fuente: Fuente,
        /** Clave del punto. */
        punto: Schema.String,
        fecha: Schema.Finite,
        observaciones: Schema.Array(ObservacionDePunto),
      }),
      returns: () => Schema.Struct({ ...Escritos.fields, retirados: Schema.Int }),
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "cerrarBarridoDePuntos",
      args: () => ({
        ejecucion: Id("ejecuciones"),
        /** Todas las claves de punto que ha traído el listado en esta ejecución. */
        vistos: Schema.Array(Schema.String),
      }),
      returns: () => Schema.Struct({ puntos: Schema.Int, observaciones: Schema.Int }),
    }),
  )
  .addFunction(
    FunctionSpec.internalQuery({
      name: "observacionesVigentes",
      args: () => ({ fuente: Fuente, ...argumentosDePagina }),
      returns: () => pagina(Observacion),
    }),
  )
  .addFunction(
    FunctionSpec.internalQuery({
      name: "clavesDeEmplazamientos",
      args: () => argumentosDePagina,
      returns: () => pagina(Schema.String),
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "escribirEmplazamientos",
      args: () => ({ fecha: Schema.Finite, emplazamientos: Schema.Array(Emplazamiento) }),
      returns: () => Escritos,
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "retirarEmplazamientos",
      args: () => ({ claves: Schema.Array(Schema.String) }),
      returns: () => Schema.Struct({ retirados: Schema.Int }),
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "completar",
      args: () => ({
        ejecucion: Id("ejecuciones"),
        /** Fin de la ejecución. Los datos llevan la fecha de su inicio. */
        fin: Schema.Finite,
        registros: Schema.Int,
        cambios: Cambios,
        errores: Schema.Array(Schema.String),
      }),
      returns: () => Schema.Null,
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "fallar",
      args: () => ({
        ejecucion: Id("ejecuciones"),
        fin: Schema.Finite,
        cambios: Cambios,
        errores: Schema.Array(Schema.String),
      }),
      returns: () => Schema.Null,
    }),
  )
  .addFunction(
    FunctionSpec.internalMutation({
      name: "cambiarInterruptor",
      args: () => ({ fuente: Fuente, activo: Schema.Boolean, motivo: Schema.String }),
      returns: () => Schema.Null,
    }),
  )
  .addFunction(
    FunctionSpec.internalQuery({
      name: "ejecucion",
      args: () => ({ id: Id("ejecuciones") }),
      returns: () => ejecuciones.Doc,
    }),
  )
  .addFunction(
    FunctionSpec.internalAction({
      name: "registroOficial",
      returns: () => ejecuciones.Doc,
    }),
  )
  .addFunction(
    FunctionSpec.internalAction({
      name: "antenasMoviles",
      returns: () => ejecuciones.Doc,
    }),
  )
  .addFunction(
    FunctionSpec.internalAction({
      name: "recalcularFusion",
      returns: () => Cambios.fields.emplazamientos,
    }),
  )
  .addFunction(
    FunctionSpec.internalQuery({
      name: "estado",
      returns: () => Schema.Array(EstadoFuente),
    }),
  );
