// Cada prueba es su propio punto de entrada y monta sus capas.
// @effect-diagnostics strictEffectProvide:off
import { assert, describe, it } from "@effect/vitest";
import type { PaginaDeCola } from "@celda/dominio/moderacion";
import { makeFunctionReference } from "convex/server";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import refs from "../confect/_generated/refs";
import {
  avanzar,
  corroboracion,
  correccion,
  identidadDesde,
  medida,
  prepararBuzon,
  tablas,
} from "./ayudas";
import * as TestConfect from "./TestConfect";

const IP = "203.0.113.7";

const buzon = refs.public.buzon;
const moderacion = refs.internal.moderacion;

prepararBuzon();

describe("moderación", () => {
  it.effect("una corrección propuesta no llega a lo que se publica hasta que se acepta", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      const propuesta = correccion();
      yield* convex
        .desde(IP)
        .mutation(buzon.enviarCorreccion, { identidad, correccion: propuesta });
      yield* convex.desde(IP).mutation(buzon.enviarCorroboracion, {
        identidad,
        corroboracion: corroboracion(),
      });
      yield* convex.desde(IP).mutation(buzon.enviarMedida, { identidad, medida: medida() });

      // Lo que lee la publicación nocturna: nada, por mucho que pase el tiempo.
      avanzar(7 * 24 * 60 * 60 * 1000);
      yield* convex.mutation(refs.internal.limpieza.huellas);
      const nada = yield* convex.query(moderacion.aceptadas, { despuesDe: null, limite: 100 });
      assert.deepStrictEqual(nada, { aportaciones: [], ultima: null });
      const pendientes = yield* convex.query(moderacion.pendientes, {
        despuesDe: null,
        limite: 100,
      });
      assert.lengthOf(pendientes.aportaciones, 3);
      assert.isTrue(pendientes.aportaciones.every((a) => a.estado === "pendiente"));

      const aceptada = yield* convex.mutation(moderacion.aceptar, {
        id: propuesta.id,
        motivo: "Se ve en la foto aérea",
      });
      assert.strictEqual(aceptada.estado, "aceptada");
      const publicables = yield* convex.query(moderacion.aceptadas, {
        despuesDe: null,
        limite: 100,
      });
      assert.deepStrictEqual(
        publicables.aportaciones.map((a) => a.contenido),
        [propuesta],
      );
      // Leer otra vez desde la última da lo mismo: nada nuevo.
      const otraVez = yield* convex.query(moderacion.aceptadas, {
        despuesDe: aceptada.moderadaEl,
        limite: 100,
      });
      assert.lengthOf(otraVez.aportaciones, 0);
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("rechazar guarda el motivo y una aportación desconocida da error", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      const propuesta = correccion();
      yield* convex
        .desde(IP)
        .mutation(buzon.enviarCorreccion, { identidad, correccion: propuesta });
      const rechazada = yield* convex.mutation(moderacion.rechazar, {
        id: propuesta.id,
        motivo: "El punto cae en el mar",
      });
      assert.deepInclude(rechazada, { estado: "rechazada", motivo: "El punto cae en el mar" });
      assert.lengthOf(
        (yield* convex.query(moderacion.pendientes, { despuesDe: null, limite: 10 })).aportaciones,
        0,
      );
      const error = yield* Effect.flip(
        convex.mutation(moderacion.aceptar, { id: "no-existe", motivo: "x" }),
      );
      assert.deepInclude(error, { _tag: "AportacionDesconocida", id: "no-existe" });
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("la cola marca lo que envió una identidad vetada, y vetar dos veces no repite", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      yield* convex.desde(IP).mutation(buzon.enviarMedida, { identidad, medida: medida() });
      const [id = ""] = identidad.split(".");
      const primero = yield* convex.mutation(moderacion.vetar, {
        tipo: "identidad",
        valor: id,
        motivo: "spam",
      });
      const segundo = yield* convex.mutation(moderacion.vetar, {
        tipo: "identidad",
        valor: id,
        motivo: "spam",
      });
      assert.deepStrictEqual([primero.nuevo, segundo.nuevo], [true, false]);
      assert.lengthOf((yield* tablas).vetos, 1);
      const cola = yield* convex.query(moderacion.pendientes, { despuesDe: null, limite: 10 });
      assert.deepStrictEqual(
        cola.aportaciones.map((a) => [a.identidad, a.vetada]),
        [[id, true]],
      );
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("la cola se lee por páginas, de la más antigua a la más reciente", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      const enviadas = [correccion(), correccion(), correccion()];
      for (const enviada of enviadas) {
        yield* convex
          .desde(IP)
          .mutation(buzon.enviarCorreccion, { identidad, correccion: enviada });
        avanzar(1000);
      }
      const primera = yield* convex.query(moderacion.pendientes, { despuesDe: null, limite: 2 });
      const segunda = yield* convex.query(moderacion.pendientes, {
        despuesDe: primera.ultima,
        limite: 2,
      });
      assert.deepStrictEqual(
        [...primera.aportaciones, ...segunda.aportaciones].map((a) => a.id),
        enviadas.map((e) => e.id),
      );
      assert.isNull(segunda.ultima);
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("el contexto da el historial de quien envía y lo demás del mismo emplazamiento", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const ana = yield* identidadDesde(IP);
      const otra = yield* identidadDesde(IP);
      const aceptada = correccion();
      const rechazada = correccion();
      const pendiente = correccion();
      for (const enviada of [aceptada, rechazada, pendiente]) {
        yield* convex
          .desde(IP)
          .mutation(buzon.enviarCorreccion, { identidad: ana, correccion: enviada });
        avanzar(1000);
      }
      yield* convex.mutation(moderacion.aceptar, {
        id: aceptada.id,
        motivo: "Se ve en la foto aérea",
      });
      yield* convex.mutation(moderacion.rechazar, { id: rechazada.id, motivo: "Repetida" });
      // De otra identidad: una corroboración del mismo sitio, una medida (no cuenta) y otro sitio.
      const respaldo = corroboracion();
      yield* convex
        .desde(IP)
        .mutation(buzon.enviarCorroboracion, { identidad: otra, corroboracion: respaldo });
      yield* convex.desde(IP).mutation(buzon.enviarMedida, { identidad: otra, medida: medida() });
      yield* convex.desde(IP).mutation(buzon.enviarCorreccion, {
        identidad: otra,
        correccion: correccion({ emplazamiento: "orange-1" }),
      });

      const [contexto] = yield* convex.query(moderacion.contexto, { ids: [pendiente.id] });
      assert.isDefined(contexto);
      assert.strictEqual(contexto.aportacion.id, pendiente.id);
      assert.deepStrictEqual(contexto.historial, { aceptadas: 1, rechazadas: 1, pendientes: 0 });
      // De la más reciente a la más antigua, sin ella misma ni la medida.
      assert.deepStrictEqual(
        contexto.relacionadas.map((a) => [a.id, a.estado]),
        [
          [respaldo.id, "pendiente"],
          [rechazada.id, "rechazada"],
          [aceptada.id, "aceptada"],
        ],
      );

      const desconocida = yield* Effect.flip(
        convex.query(moderacion.contexto, { ids: ["no-existe"] }),
      );
      assert.deepInclude(desconocida, { _tag: "AportacionDesconocida", id: "no-existe" });
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("de un emplazamiento que falta, el contexto da los que dicen que falta uno cerca", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      const falta = (longitud: number) =>
        correccion({
          emplazamiento: null,
          cambio: {
            tipo: "falta",
            posicion: { longitud, latitud: 41.3889 },
            companias: ["orange"],
          },
        });
      // A unos 8 m y a unos 800 m.
      const [esta, cerca, lejos] = [falta(2.1141), falta(2.1142), falta(2.1237)];
      for (const enviada of [esta, cerca, lejos]) {
        yield* convex
          .desde(IP)
          .mutation(buzon.enviarCorreccion, { identidad, correccion: enviada });
      }
      const [contexto] = yield* convex.query(moderacion.contexto, { ids: [esta.id] });
      assert.deepStrictEqual(
        contexto?.relacionadas.map((a) => a.id),
        [cerca.id],
      );
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("un veredicto no se cambia, y repetirlo no cambia nada", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      const propuesta = correccion();
      yield* convex
        .desde(IP)
        .mutation(buzon.enviarCorreccion, { identidad, correccion: propuesta });
      const primera = yield* convex.mutation(moderacion.aceptar, {
        id: propuesta.id,
        motivo: "Bien",
      });
      avanzar(1000);
      const otraVez = yield* convex.mutation(moderacion.aceptar, {
        id: propuesta.id,
        motivo: "Otra",
      });
      assert.deepStrictEqual(otraVez, primera);
      const error = yield* Effect.flip(
        convex.mutation(moderacion.rechazar, { id: propuesta.id, motivo: "Me lo pienso" }),
      );
      assert.deepInclude(error, {
        _tag: "AportacionYaModerada",
        id: propuesta.id,
        estado: "aceptada",
      });
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("aceptar o rechazar sin motivo da error y no cambia nada", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      const propuesta = correccion();
      yield* convex
        .desde(IP)
        .mutation(buzon.enviarCorreccion, { identidad, correccion: propuesta });
      for (const motivo of ["", "   "]) {
        assert.isTrue(
          Exit.isFailure(
            yield* Effect.exit(convex.mutation(moderacion.aceptar, { id: propuesta.id, motivo })),
          ),
        );
        assert.isTrue(
          Exit.isFailure(
            yield* Effect.exit(convex.mutation(moderacion.rechazar, { id: propuesta.id, motivo })),
          ),
        );
      }
      // Ni saltándose el esquema del cliente: el servidor lo vuelve a comprobar.
      const crudo = yield* Effect.exit(
        Effect.promise(() =>
          convex.crudo.mutation(makeFunctionReference<"mutation">("moderacion:aceptar"), {
            id: propuesta.id,
            motivo: " ",
          }),
        ),
      );
      assert.isTrue(Exit.isFailure(crudo));
      assert.deepStrictEqual(
        (yield* tablas).aportaciones.map((a) => a.estado),
        ["pendiente"],
      );
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect(
    "dos aceptadas en el mismo milisegundo tienen horas distintas y la noche no se salta ninguna",
    () =>
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        const identidad = yield* identidadDesde(IP);
        const enviadas = [correccion(), correccion(), correccion()];
        for (const enviada of enviadas) {
          yield* convex
            .desde(IP)
            .mutation(buzon.enviarCorreccion, { identidad, correccion: enviada });
        }
        // El reloj no se mueve entre una aceptación y otra.
        for (const enviada of enviadas) {
          yield* convex.mutation(moderacion.aceptar, { id: enviada.id, motivo: "Bien" });
        }
        const leidas: Array<string> = [];
        let despuesDe: number | null = null;
        for (let vuelta = 0; vuelta < 10; vuelta++) {
          const pagina: typeof PaginaDeCola.Type = yield* convex.query(moderacion.aceptadas, {
            despuesDe,
            limite: 1,
          });
          leidas.push(...pagina.aportaciones.map((a) => a.id));
          if (pagina.ultima === null) break;
          despuesDe = pagina.ultima;
        }
        assert.deepStrictEqual(
          leidas,
          enviadas.map((e) => e.id),
        );
      }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("una identidad vetada ya no puede enviar, y sus pendientes quedan marcadas", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      const otra = yield* identidadDesde(IP);
      yield* convex
        .desde(IP)
        .mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() });
      yield* convex
        .desde(IP)
        .mutation(buzon.enviarCorreccion, { identidad: otra, correccion: correccion() });
      const [id = ""] = identidad.split(".");
      yield* convex.mutation(moderacion.vetar, { tipo: "identidad", valor: id, motivo: "spam" });
      const error = yield* Effect.flip(
        convex.desde(IP).mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() }),
      );
      assert.deepInclude(error, { _tag: "Vetada", que: "identidad" });
      const cola = yield* convex.query(moderacion.pendientes, { despuesDe: null, limite: 10 });
      assert.deepStrictEqual(
        cola.aportaciones.map((a) => a.vetada),
        [true, false],
      );
    }).pipe(Effect.provide(TestConfect.layer)),
  );
});
