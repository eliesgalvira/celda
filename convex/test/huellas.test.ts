// Cada prueba es su propio punto de entrada y monta sus capas.
// @effect-diagnostics strictEffectProvide:off
// Las tablas se pasan a texto para buscar en ellas la IP o la huella, sin leer su forma.
// @effect-diagnostics preferSchemaOverJson:off
import { HOUR } from "@convex-dev/rate-limiter";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import refs from "../confect/_generated/refs";
import { MutationCtx } from "../confect/_generated/services";
import { VIDA_DE_UNA_HUELLA_MS } from "../src/huella";
import { limitador } from "../src/limites";
import { avanzar, correccion, identidadDesde, prepararBuzon, tablas } from "./ayudas";
import * as TestConfect from "./TestConfect";

const IP = "203.0.113.7";
const IP_V6 = "2001:db8::1f";

const buzon = refs.public.buzon;

prepararBuzon();

/** Cuántas fichas le quedan a la huella en el límite de correcciones por IP. */
const fichasDeCorreccionesPorIp = (huella: string) =>
  Effect.gen(function* () {
    const convex = yield* TestConfect.TestConfect;
    const fichas = yield* Ref.make(0);
    yield* convex.run(
      Effect.gen(function* () {
        const ctx = yield* MutationCtx;
        const { value } = yield* Effect.promise(() =>
          limitador.getValue(ctx, "correccionesPorIp", { key: huella }),
        );
        yield* Ref.set(fichas, value);
      }),
    );
    return yield* Ref.get(fichas);
  });

describe("huellas de IP", () => {
  it.effect("la IP no se guarda en claro en ninguna tabla, ni en IPv4 ni en IPv6", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      for (const ip of [IP, IP_V6]) {
        const identidad = yield* identidadDesde(ip);
        yield* convex
          .desde(ip)
          .mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() });
      }
      const guardado = JSON.stringify(yield* tablas);
      assert.notInclude(guardado, IP);
      assert.notInclude(guardado, IP_V6);
      assert.notInclude(guardado, "203.0.113");
      const { huellasDeIp, aportaciones } = yield* tablas;
      assert.lengthOf(huellasDeIp, 2);
      for (const { huella } of huellasDeIp) assert.match(huella, /^[A-Za-z0-9_-]{43}$/u);
      assert.sameMembers(
        aportaciones.map((a) => a.huellaIp),
        huellasDeIp.map((h) => h.huella),
      );
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("la misma IP da la misma huella durante el día y otra al día siguiente", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      const identidad = yield* identidadDesde(IP);
      yield* convex
        .desde(IP)
        .mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() });
      avanzar(3 * HOUR);
      yield* convex
        .desde(IP)
        .mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() });
      const hoy = yield* tablas;
      assert.lengthOf(hoy.huellasDeIp, 1);
      assert.lengthOf(hoy.salesDeIp, 1);

      // Del 3 a las 13:00 al 4 a las 01:00 UTC: otro día, otra sal.
      avanzar(12 * HOUR);
      yield* convex
        .desde(IP)
        .mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() });
      const manana = yield* tablas;
      assert.lengthOf(manana.huellasDeIp, 2);
      assert.deepStrictEqual(
        manana.salesDeIp.map((s) => s.dia),
        ["2026-10-03", "2026-10-04"],
      );
      assert.notStrictEqual(manana.huellasDeIp[0]?.huella, manana.huellasDeIp[1]?.huella);
    }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect(
    "a las 24 horas se borran la huella, su veto, sus cubos por IP y la huella de todo lo que la llevaba",
    () =>
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        const identidad = yield* identidadDesde(IP);
        for (let i = 0; i < 2; i++) {
          yield* convex
            .desde(IP)
            .mutation(buzon.enviarCorreccion, { identidad, correccion: correccion() });
        }
        const [vista] = (yield* tablas).huellasDeIp;
        const huella = vista?.huella ?? "";
        yield* convex.mutation(refs.internal.moderacion.vetar, {
          tipo: "ip",
          valor: huella,
          motivo: "spam",
        });
        assert.isBelow(yield* fichasDeCorreccionesPorIp(huella), 50);

        // Un minuto antes de las 24 horas no se borra nada, salvo la sal de ayer.
        avanzar(VIDA_DE_UNA_HUELLA_MS - 60_000);
        const antes = yield* convex.mutation(refs.internal.limpieza.huellas);
        assert.deepStrictEqual(antes, { huellas: 0, sales: 1 });
        assert.lengthOf((yield* tablas).huellasDeIp, 1);

        avanzar(60_000);
        const despues = yield* convex.mutation(refs.internal.limpieza.huellas);
        assert.deepStrictEqual(despues, { huellas: 1, sales: 0 });
        const limpias = yield* tablas;
        assert.lengthOf(limpias.huellasDeIp, 0);
        assert.lengthOf(limpias.vetos, 0);
        assert.lengthOf(limpias.salesDeIp, 0);
        assert.lengthOf(limpias.aportaciones, 2);
        assert.isTrue(limpias.aportaciones.every((a) => a.huellaIp === null));
        assert.isTrue(limpias.identidades.every((i) => i.huellaIp === null));
        assert.notInclude(JSON.stringify(limpias), huella);
        assert.strictEqual(yield* fichasDeCorreccionesPorIp(huella), 50);
      }).pipe(Effect.provide(TestConfect.layer)),
  );

  it.effect("con muchas huellas viejas la limpieza sigue en otra pasada hasta acabar", () =>
    Effect.gen(function* () {
      const convex = yield* TestConfect.TestConfect;
      for (let i = 1; i <= 12; i++) yield* identidadDesde(`192.0.2.${i}`);
      avanzar(VIDA_DE_UNA_HUELLA_MS);
      const primera = yield* convex.mutation(refs.internal.limpieza.huellas);
      assert.strictEqual(primera.huellas, 5);
      yield* convex.finishAllScheduledFunctions(() => undefined);
      assert.lengthOf((yield* tablas).huellasDeIp, 0);
    }).pipe(Effect.provide(TestConfect.layer)),
  );
});
