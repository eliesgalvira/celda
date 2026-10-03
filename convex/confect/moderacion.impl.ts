import { distanciaMetros } from "@celda/dominio/area";
import {
  type AportacionEnCola,
  type ContextoEnElBuzon,
  DISTANCIA_FALTA_RELACIONADA_M,
  type EstadoDeModeracion,
  type HistorialDeIdentidad,
} from "@celda/dominio/moderacion";
import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "./_generated/schema";
import { DatabaseReader, DatabaseWriter } from "./_generated/services";
import moderacion, { AportacionDesconocida, AportacionYaModerada } from "./moderacion.spec";

type Fila = typeof import("./_generated/tables/aportaciones").default.Doc.Type;

/**
 * Cuántas aportaciones de una identidad se leen para su historial, y cuántas del mismo
 * emplazamiento. Los límites del buzón dejan a una identidad unas 1.500 aportaciones al mes:
 * más allá, el historial ya dice lo que hace falta.
 */
const HISTORIAL_MAXIMO = 2000;
const RELACIONADAS_MAXIMAS = 50;

/** La aportación como la ve la moderación, con si quien la envió está vetado. */
const enCola = Effect.fn("Moderacion.enCola")(function* (fila: Fila) {
  const reader = yield* DatabaseReader;
  const vetado = (tipo: "identidad" | "ip", valor: string | null) =>
    valor === null
      ? Effect.succeed(false)
      : Effect.map(
          reader
            .table("vetos")
            .index("por_valor", (q) => q.eq("tipo", tipo).eq("valor", valor))
            .first(),
          Option.isSome,
        );
  const vetada =
    (yield* vetado("identidad", fila.identidad)) || (yield* vetado("ip", fila.huellaIp));
  return {
    id: fila.id,
    identidad: fila.identidad,
    huellaIp: fila.huellaIp,
    recibidaEl: fila.recibidaEl,
    contenido: fila.contenido,
    estado: fila.estado,
    moderadaEl: fila.moderadaEl,
    motivo: fila.motivo,
    vetada,
  } satisfies AportacionEnCola;
});

/** Una página de la cola; sigue después de la última si ha llegado al límite. */
const pagina = (
  filas: ReadonlyArray<Fila>,
  limite: number,
  cursor: (fila: Fila) => number | null,
) =>
  Effect.map(Effect.forEach(filas, enCola), (aportaciones) => {
    const ultima = filas.at(-1);
    return {
      aportaciones,
      ultima: ultima === undefined || filas.length < limite ? null : cursor(ultima),
    };
  });

const filaDe = Effect.fn("Moderacion.filaDe")(function* (id: string) {
  const reader = yield* DatabaseReader;
  const fila = yield* reader
    .table("aportaciones")
    .index("por_id", (q) => q.eq("id", id))
    .first();
  if (Option.isNone(fila)) return yield* new AportacionDesconocida({ id });
  return fila.value;
});

const pendientes = FunctionImpl.make(
  databaseSchema,
  moderacion,
  "pendientes",
  ({ despuesDe, limite }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const filas = yield* reader
        .table("aportaciones")
        .index("por_estado", (q) => {
          const pendiente = q.eq("estado", "pendiente");
          return despuesDe === null ? pendiente : pendiente.gt("recibidaEl", despuesDe);
        })
        .take(limite);
      return yield* pagina(filas, limite, (fila) => fila.recibidaEl);
    }).pipe(Effect.orDie),
);

/** Lo que la moderación ha hecho con lo que envió la misma identidad, sin contar esta. */
const historialDe = Effect.fn("Moderacion.historialDe")(function* (fila: Fila) {
  const reader = yield* DatabaseReader;
  const suyas = yield* reader
    .table("aportaciones")
    .index("por_identidad", (q) => q.eq("identidad", fila.identidad))
    .take(HISTORIAL_MAXIMO);
  const cuentas: Record<EstadoDeModeracion, number> = { aceptada: 0, rechazada: 0, pendiente: 0 };
  for (const suya of suyas) {
    if (suya.id !== fila.id) cuentas[suya.estado] += 1;
  }
  const historial: HistorialDeIdentidad = {
    aceptadas: cuentas.aceptada,
    rechazadas: cuentas.rechazada,
    pendientes: cuentas.pendiente,
  };
  return historial;
});

/**
 * Las demás correcciones propuestas y corroboraciones del mismo emplazamiento, de la más reciente
 * a la más antigua. De un emplazamiento que falta, las que dicen que falta uno cerca.
 */
const relacionadasCon = Effect.fn("Moderacion.relacionadasCon")(function* (fila: Fila) {
  const reader = yield* DatabaseReader;
  const { contenido } = fila;
  const mismas = yield* reader
    .table("aportaciones")
    .index("por_emplazamiento", (q) => q.eq("emplazamiento", fila.emplazamiento), "desc")
    .take(HISTORIAL_MAXIMO);
  const cerca = (otra: Fila) => {
    if (contenido.tipo !== "correccion-propuesta" || contenido.cambio.tipo !== "falta") return true;
    const suya = otra.contenido;
    return (
      suya.tipo === "correccion-propuesta" &&
      suya.cambio.tipo === "falta" &&
      distanciaMetros(contenido.cambio.posicion, suya.cambio.posicion) <=
        DISTANCIA_FALTA_RELACIONADA_M
    );
  };
  const relacionadas = mismas
    .filter((otra) => otra.id !== fila.id && otra.tipo !== "propia" && cerca(otra))
    .slice(0, RELACIONADAS_MAXIMAS);
  return yield* Effect.forEach(relacionadas, enCola);
});

const contexto = FunctionImpl.make(databaseSchema, moderacion, "contexto", ({ ids }) =>
  Effect.forEach(ids, (id) =>
    Effect.gen(function* () {
      const fila = yield* filaDe(id);
      const deLaFila: ContextoEnElBuzon = {
        aportacion: yield* enCola(fila),
        historial: yield* historialDe(fila),
        relacionadas: yield* relacionadasCon(fila),
      };
      return deLaFila;
    }),
  ).pipe(
    Effect.catch((error) =>
      error instanceof AportacionDesconocida ? Effect.fail(error) : Effect.die(error),
    ),
  ),
);

const aceptadas = FunctionImpl.make(
  databaseSchema,
  moderacion,
  "aceptadas",
  ({ despuesDe, limite }) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const filas = yield* reader
        .table("aportaciones")
        .index("por_moderacion", (q) => {
          const aceptada = q.eq("estado", "aceptada");
          return despuesDe === null ? aceptada : aceptada.gt("moderadaEl", despuesDe);
        })
        .take(limite);
      return yield* pagina(filas, limite, (fila) => fila.moderadaEl);
    }).pipe(Effect.orDie),
);

/**
 * La hora del veredicto. La de una aceptada es siempre posterior a la de la última aceptada, aunque
 * el reloj no haya avanzado: la noche sigue desde la última que leyó (`aceptadas`), y dos con la
 * misma hora en el corte de una página harían que se saltara una. Las mutaciones de Convex son
 * serializables, así que dos aceptaciones a la vez no pueden leer la misma última.
 */
const horaDelVeredicto = Effect.fn("Moderacion.horaDelVeredicto")(function* (
  estado: Exclude<EstadoDeModeracion, "pendiente">,
) {
  const ahora = yield* Clock.currentTimeMillis;
  if (estado === "rechazada") return ahora;
  const reader = yield* DatabaseReader;
  const ultima = yield* reader
    .table("aportaciones")
    .index("por_moderacion", (q) => q.eq("estado", "aceptada"), "desc")
    .first();
  const anterior = Option.match(ultima, { onNone: () => null, onSome: (f) => f.moderadaEl });
  return anterior === null ? ahora : Math.max(ahora, anterior + 1);
});

/**
 * Pone el veredicto de la moderación, con su motivo y su hora. Solo a una pendiente: repetir el
 * mismo veredicto no cambia nada, y el otro falla con `AportacionYaModerada`.
 */
const moderar = Effect.fn("Moderacion.moderar")(function* (
  id: string,
  estado: Exclude<EstadoDeModeracion, "pendiente">,
  motivo: string,
) {
  const writer = yield* DatabaseWriter;
  const fila = yield* filaDe(id);
  if (fila.estado === estado) return yield* enCola(fila);
  if (fila.estado !== "pendiente") {
    return yield* new AportacionYaModerada({ id, estado: fila.estado });
  }
  const moderadaEl = yield* horaDelVeredicto(estado);
  yield* writer.table("aportaciones").patch(fila._id, { estado, moderadaEl, motivo });
  return yield* enCola({ ...fila, estado, moderadaEl, motivo });
});

const soloDeLaModeracion = <A, E, R>(efecto: Effect.Effect<A, E, R>) =>
  Effect.catch(efecto, (error) =>
    error instanceof AportacionDesconocida || error instanceof AportacionYaModerada
      ? Effect.fail(error)
      : Effect.die(error),
  );

const aceptar = FunctionImpl.make(databaseSchema, moderacion, "aceptar", ({ id, motivo }) =>
  soloDeLaModeracion(moderar(id, "aceptada", motivo)),
);

const rechazar = FunctionImpl.make(databaseSchema, moderacion, "rechazar", ({ id, motivo }) =>
  soloDeLaModeracion(moderar(id, "rechazada", motivo)),
);

const vetar = FunctionImpl.make(databaseSchema, moderacion, "vetar", ({ tipo, valor, motivo }) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;
    const previo = yield* reader
      .table("vetos")
      .index("por_valor", (q) => q.eq("tipo", tipo).eq("valor", valor))
      .first();
    if (Option.isSome(previo)) return { nuevo: false };
    yield* writer
      .table("vetos")
      .insert({ tipo, valor, motivo, creadoEl: yield* Clock.currentTimeMillis });
    return { nuevo: true };
  }).pipe(Effect.orDie),
);

export default GroupImpl.make(databaseSchema, moderacion).pipe(
  Layer.provide(pendientes),
  Layer.provide(contexto),
  Layer.provide(aceptadas),
  Layer.provide(aceptar),
  Layer.provide(rechazar),
  Layer.provide(vetar),
  GroupImpl.finalize,
);
