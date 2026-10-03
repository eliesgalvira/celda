// Cada prueba es su propio punto de entrada y monta sus capas.
// @effect-diagnostics strictEffectProvide:off
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

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
});
