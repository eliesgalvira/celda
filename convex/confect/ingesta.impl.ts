import { EmplazamientoSinEstaciones, EstacionBase } from "@celda/dominio/emplazamiento";
import { Banda } from "@celda/dominio/banda";
import { Fuente, Observacion } from "@celda/dominio/observacion";
import { Registro } from "@celda/ingesta/extractor";
import * as RegistroOficial from "@celda/ingesta/registro-oficial/extractor";
import { ConvexConfigProvider, FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { ejecutarIngesta, fusionarTodo, opcionesProcesoDesdeConfig } from "../src/proceso";
import databaseSchema from "./_generated/schema";
import { DatabaseReader, DatabaseWriter } from "./_generated/services";
import ingesta from "./ingesta.spec";
import { SIN_CAMBIOS } from "./tables/ejecuciones";

const mismoEmplazamiento = Schema.toEquivalence(EmplazamientoSinEstaciones);
const mismaEstacion = Schema.toEquivalence(EstacionBase);
const mismoRegistro = Schema.toEquivalence(Registro);
const mismasBandas = Schema.toEquivalence(Schema.Array(Banda));

/** Los campos del listado de una observación guardada. */
const registroDe = (o: Registro): Registro => ({
  clave: o.clave,
  compania: o.compania,
  codigo: o.codigo,
  posicion: o.posicion,
  direccion: o.direccion,
  municipio: o.municipio,
  url: o.url,
});

const iniciar = FunctionImpl.make(databaseSchema, ingesta, "iniciar", ({ fuente, fecha }) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    // Una ejecución que sigue «en curso» al empezar otra se cortó sin cerrar.
    const anteriores = yield* reader
      .table("ejecuciones")
      .index("por_fuente", (q) => q.eq("fuente", fuente), "desc")
      .take(20);
    yield* Effect.forEach(
      anteriores.filter((e) => e.estado === "en curso"),
      (e) => writer.table("ejecuciones").patch(e._id, { estado: "interrumpida", fin: fecha }),
    );
    const interruptor = yield* reader
      .table("interruptores")
      .index("por_fuente", (q) => q.eq("fuente", fuente))
      .first();
    const apagado = Option.filter(interruptor, (i) => !i.activo);
    const ejecucion = yield* writer.table("ejecuciones").insert({
      fuente,
      inicio: fecha,
      fin: Option.isSome(apagado) ? fecha : null,
      estado: Option.isSome(apagado) ? "omitida" : "en curso",
      registros: null,
      cambios: SIN_CAMBIOS,
      errores: Option.match(apagado, {
        onNone: () => [],
        onSome: (i) => [`Interruptor apagado: ${i.motivo}`],
      }),
    });
    return {
      tipo: Option.isSome(apagado) ? ("omitida" as const) : ("iniciada" as const),
      ejecucion,
    };
  }).pipe(Effect.orDie),
);

const aplicarListado = FunctionImpl.make(
  databaseSchema,
  ingesta,
  "aplicarListado",
  ({ fuente, fecha, registros }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      let creados = 0;
      let cambiados = 0;
      for (const registro of registros) {
        const previa = yield* reader
          .table("observaciones")
          .index("por_clave", (q) => q.eq("fuente", fuente).eq("clave", registro.clave))
          .first();
        if (Option.isNone(previa)) {
          yield* writer.table("observaciones").insert({
            ...registro,
            fuente,
            afirma: "presente",
            bandas: [],
            fecha,
            fichaLeidaEn: null,
            ausencias: 0,
            retiradaEn: null,
          });
          creados++;
          continue;
        }
        const { _id, _creationTime, ...guardada } = previa.value;
        const igual = mismoRegistro(registroDe(guardada), registro);
        if (igual && guardada.ausencias === 0 && guardada.retiradaEn === null) {
          continue;
        }
        yield* writer.table("observaciones").replace(_id, {
          ...guardada,
          ...registro,
          fecha: igual ? guardada.fecha : fecha,
          // Si cambia el listado, la ficha se vuelve a leer en esta misma ejecución.
          fichaLeidaEn: igual ? guardada.fichaLeidaEn : null,
          ausencias: 0,
          retiradaEn: null,
        });
        if (!igual || guardada.retiradaEn !== null) {
          cambiados++;
        }
      }
      return { creados, cambiados };
    }).pipe(Effect.orDie),
);

const pendientesDeFicha = FunctionImpl.make(
  databaseSchema,
  ingesta,
  "pendientesDeFicha",
  ({ fuente, leidasAntesDe, limite }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const pendientes = yield* reader
        .table("observaciones")
        .index("por_ficha", (q) => q.eq("fuente", fuente).lt("fichaLeidaEn", leidasAntesDe))
        .stream()
        .pipe(
          Stream.filter((o) => o.retiradaEn === null),
          Stream.take(limite),
          Stream.runCollect,
        );
      return pendientes.map(registroDe);
    }).pipe(Effect.orDie),
);

const aplicarFicha = FunctionImpl.make(
  databaseSchema,
  ingesta,
  "aplicarFicha",
  ({ fuente, clave, fecha, bandas }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const previa = yield* reader
        .table("observaciones")
        .index("por_clave", (q) => q.eq("fuente", fuente).eq("clave", clave))
        .first();
      if (Option.isNone(previa)) {
        return false;
      }
      const { _id, _creationTime, ...guardada } = previa.value;
      const iguales = mismasBandas(guardada.bandas, bandas);
      yield* writer.table("observaciones").replace(_id, {
        ...guardada,
        bandas,
        fecha: iguales ? guardada.fecha : fecha,
        fichaLeidaEn: fecha,
      });
      return !iguales;
    }).pipe(Effect.orDie),
);

const cerrarBarrido = FunctionImpl.make(
  databaseSchema,
  ingesta,
  "cerrarBarrido",
  ({ ejecucion, vistas }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const actual = yield* reader.table("ejecuciones").get(ejecucion);
      if (actual.estado !== "en curso") {
        return { retirados: 0 };
      }
      const vistasEnListado = new Set(vistas);
      // Lee todas las observaciones de la fuente: unas 2400 en Barcelona, por debajo del
      // límite de 4096 lecturas. Para una zona mayor habría que repartirlo por páginas.
      const guardadas = yield* reader
        .table("observaciones")
        .index("por_clave", (q) => q.eq("fuente", actual.fuente))
        .collect();
      let retirados = 0;
      for (const { _id, _creationTime, ...o } of guardadas) {
        if (o.retiradaEn !== null || vistasEnListado.has(o.clave)) {
          continue;
        }
        // Una baja solo cuenta tras dos barridos completos sin verla.
        const ausencias = o.ausencias + 1;
        const retirada = ausencias >= 2;
        yield* writer
          .table("observaciones")
          .replace(_id, { ...o, ausencias, retiradaEn: retirada ? actual.inicio : null });
        retirados += retirada ? 1 : 0;
      }
      return { retirados };
    }).pipe(Effect.orDie),
);

const observacionesVigentes = FunctionImpl.make(
  databaseSchema,
  ingesta,
  "observacionesVigentes",
  ({ fuente, despuesDe, limite }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const pagina = yield* reader
        .table("observaciones")
        .index("por_clave", (q) =>
          despuesDe === null
            ? q.eq("fuente", fuente)
            : q.eq("fuente", fuente).gt("clave", despuesDe),
        )
        .take(limite);
      return {
        elementos: pagina
          .filter((o) => o.retiradaEn === null)
          .map((o): Observacion => ({
            fuente: o.fuente,
            clave: o.clave,
            compania: o.compania,
            codigo: o.codigo,
            posicion: o.posicion,
            direccion: o.direccion,
            municipio: o.municipio,
            bandas: o.bandas,
            url: o.url,
            fecha: o.fecha,
            afirma: o.afirma,
          })),
        ultima: pagina.length < limite ? null : (pagina.at(-1)?.clave ?? null),
      };
    }).pipe(Effect.orDie),
);

const clavesDeEmplazamientos = FunctionImpl.make(
  databaseSchema,
  ingesta,
  "clavesDeEmplazamientos",
  ({ despuesDe, limite }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const pagina = yield* reader
        .table("emplazamientos")
        .index("por_clave", (q) => (despuesDe === null ? q : q.gt("clave", despuesDe)))
        .take(limite);
      return {
        elementos: pagina.map((e) => e.clave),
        ultima: pagina.length < limite ? null : (pagina.at(-1)?.clave ?? null),
      };
    }).pipe(Effect.orDie),
);

/**
 * Escribe lo que ha cambiado de cada emplazamiento y de sus estaciones base. Un cambio en una
 * estación también cambia la versión del emplazamiento. Si encuentra documentos repetidos con
 * la misma clave (o la misma compañía en un emplazamiento), se queda con uno y borra el resto.
 */
const escribirEmplazamientos = FunctionImpl.make(
  databaseSchema,
  ingesta,
  "escribirEmplazamientos",
  ({ fecha, emplazamientos }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      let creados = 0;
      let cambiados = 0;
      for (const { estaciones, ...campos } of emplazamientos) {
        const guardadas = yield* reader
          .table("estacionesBase")
          .index("por_emplazamiento", (q) => q.eq("emplazamiento", campos.clave))
          .collect();
        const previas = new Map(guardadas.map((e) => [e.compania, e]));
        let estacionesCambiadas = false;
        for (const repetida of guardadas.filter((e) => previas.get(e.compania) !== e)) {
          yield* writer.table("estacionesBase").delete(repetida._id);
          estacionesCambiadas = true;
        }
        for (const estacion of estaciones) {
          const previa = previas.get(estacion.compania);
          previas.delete(estacion.compania);
          const documento = { ...estacion, emplazamiento: campos.clave, version: fecha };
          if (previa === undefined) {
            yield* writer.table("estacionesBase").insert(documento);
            estacionesCambiadas = true;
          } else if (!mismaEstacion(previa, estacion)) {
            yield* writer.table("estacionesBase").replace(previa._id, documento);
            estacionesCambiadas = true;
          }
        }
        for (const sobrante of previas.values()) {
          yield* writer.table("estacionesBase").delete(sobrante._id);
          estacionesCambiadas = true;
        }
        const [previo, ...repetidos] = yield* reader
          .table("emplazamientos")
          .index("por_clave", (q) => q.eq("clave", campos.clave))
          .collect();
        yield* Effect.forEach(repetidos, (e) => writer.table("emplazamientos").delete(e._id));
        if (previo === undefined) {
          yield* writer.table("emplazamientos").insert({ ...campos, version: fecha });
          creados++;
        } else if (
          !mismoEmplazamiento(previo, campos) ||
          estacionesCambiadas ||
          repetidos.length > 0
        ) {
          yield* writer.table("emplazamientos").replace(previo._id, { ...campos, version: fecha });
          cambiados++;
        }
      }
      return { creados, cambiados };
    }).pipe(Effect.orDie),
);

const retirarEmplazamientos = FunctionImpl.make(
  databaseSchema,
  ingesta,
  "retirarEmplazamientos",
  ({ claves }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      let retirados = 0;
      for (const clave of claves) {
        const estaciones = yield* reader
          .table("estacionesBase")
          .index("por_emplazamiento", (q) => q.eq("emplazamiento", clave))
          .collect();
        yield* Effect.forEach(estaciones, (e) => writer.table("estacionesBase").delete(e._id));
        const guardados = yield* reader
          .table("emplazamientos")
          .index("por_clave", (q) => q.eq("clave", clave))
          .collect();
        yield* Effect.forEach(guardados, (e) => writer.table("emplazamientos").delete(e._id));
        retirados += guardados.length > 0 ? 1 : 0;
      }
      return { retirados };
    }).pipe(Effect.orDie),
);

const completar = FunctionImpl.make(
  databaseSchema,
  ingesta,
  "completar",
  ({ ejecucion, fin, registros, cambios, errores }) =>
    Effect.gen(function* () {
      const writer = yield* DatabaseWriter;
      yield* writer
        .table("ejecuciones")
        .patch(ejecucion, { estado: "completada", fin, registros, cambios, errores });
      return null;
    }).pipe(Effect.orDie),
);

const fallar = FunctionImpl.make(
  databaseSchema,
  ingesta,
  "fallar",
  ({ ejecucion, fin, cambios, errores }) =>
    Effect.gen(function* () {
      const writer = yield* DatabaseWriter;
      yield* writer
        .table("ejecuciones")
        .patch(ejecucion, { estado: "fallida", fin, cambios, errores });
      return null;
    }).pipe(Effect.orDie),
);

const cambiarInterruptor = FunctionImpl.make(
  databaseSchema,
  ingesta,
  "cambiarInterruptor",
  ({ fuente, activo, motivo }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const cambiadoEn = yield* Clock.currentTimeMillis;
      const previo = yield* reader
        .table("interruptores")
        .index("por_fuente", (q) => q.eq("fuente", fuente))
        .first();
      const documento = { fuente, activo, motivo, cambiadoEn };
      yield* Option.match(previo, {
        onNone: () => Effect.asVoid(writer.table("interruptores").insert(documento)),
        onSome: (p) => writer.table("interruptores").replace(p._id, documento),
      });
      return null;
    }).pipe(Effect.orDie),
);

const ejecucion = FunctionImpl.make(databaseSchema, ingesta, "ejecucion", ({ id }) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    return yield* reader.table("ejecuciones").get(id);
  }).pipe(Effect.orDie),
);

const estado = FunctionImpl.make(databaseSchema, ingesta, "estado", () =>
  Effect.forEach(Fuente.literals, (fuente) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const interruptor = yield* reader
        .table("interruptores")
        .index("por_fuente", (q) => q.eq("fuente", fuente))
        .first();
      const ejecuciones = yield* reader
        .table("ejecuciones")
        .index("por_fuente", (q) => q.eq("fuente", fuente), "desc")
        .take(10);
      return {
        fuente,
        activo: Option.match(interruptor, { onNone: () => true, onSome: (i) => i.activo }),
        motivo: Option.match(interruptor, { onNone: () => "", onSome: (i) => i.motivo }),
        ejecuciones,
      };
    }),
  ).pipe(Effect.orDie),
);

/** La ingesta del registro oficial que lanza el cron, con el extractor real. */
const registroOficial = FunctionImpl.make(databaseSchema, ingesta, "registroOficial", () =>
  Effect.gen(function* () {
    const opciones = yield* RegistroOficial.opcionesDesdeConfig;
    const proceso = yield* opcionesProcesoDesdeConfig;
    return yield* ejecutarIngesta(proceso).pipe(
      Effect.provide(RegistroOficial.capa(opciones).pipe(Layer.provide(FetchHttpClient.layer))),
    );
  }).pipe(Effect.provide(ConvexConfigProvider.layer), Effect.orDie),
);

/** Vuelve a fusionar sin pedir nada a las fuentes, por ejemplo tras cambiar la regla. */
const recalcularFusion = FunctionImpl.make(databaseSchema, ingesta, "recalcularFusion", () =>
  Effect.flatMap(Clock.currentTimeMillis, fusionarTodo),
);

export default GroupImpl.make(databaseSchema, ingesta).pipe(
  Layer.provide(iniciar),
  Layer.provide(aplicarListado),
  Layer.provide(pendientesDeFicha),
  Layer.provide(aplicarFicha),
  Layer.provide(cerrarBarrido),
  Layer.provide(observacionesVigentes),
  Layer.provide(clavesDeEmplazamientos),
  Layer.provide(escribirEmplazamientos),
  Layer.provide(retirarEmplazamientos),
  Layer.provide(completar),
  Layer.provide(fallar),
  Layer.provide(cambiarInterruptor),
  Layer.provide(ejecucion),
  Layer.provide(estado),
  Layer.provide(registroOficial),
  Layer.provide(recalcularFusion),
  GroupImpl.finalize,
);
