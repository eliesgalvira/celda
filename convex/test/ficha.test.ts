// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { capaGrabada, muestraCampusNord } from "@celda/ingesta/pruebas/grabado";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { TestClock } from "effect/testing";

import refs from "../confect/_generated/refs";
import { ejecutar } from "./ayudas";
import * as TestConfect from "./TestConfect";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);

const conConvex = <A, E, R>(efecto: Effect.Effect<A, E, R>) =>
  efecto.pipe(Effect.provide(Layer.merge(TestConfect.layer, NodeServices.layer)));

describe("ficha de un emplazamiento (API de Convex en memoria)", () => {
  it.effect(
    "trae la dirección, cada compañía con sus bandas ordenadas y de dónde sale cada dato",
    () =>
      conConvex(
        Effect.gen(function* () {
          const convex = yield* TestConfect.TestConfect;
          yield* TestClock.setTime(NOCHE);
          yield* ejecutar(capaGrabada("registro-oficial", yield* muestraCampusNord));

          const leida = yield* convex.query(refs.public.datos.ficha, {
            clave: "movistar-0802532",
          });
          assert.isTrue(Option.isSome(leida));
          if (Option.isNone(leida)) return;
          const ficha = leida.value;

          assert.strictEqual(ficha.direccion, "CL JORDI GIRONA, 1. BARCELONA, BARCELONA");
          assert.strictEqual(ficha.municipio, "BARCELONA");
          assert.strictEqual(ficha.estado, "verificado");
          // La marca de agua: la ejecución que lo escribió.
          assert.strictEqual(ficha.version, NOCHE);
          assert.deepStrictEqual(
            ficha.estaciones.map((e) => [e.compania, e.codigos]),
            [
              ["movistar", ["0802532"]],
              ["orange", ["CATR0228A"]],
              ["vodafone", ["086040", "86040"]],
            ],
          );

          const movistar = ficha.estaciones[0];
          assert.deepStrictEqual(
            movistar?.bandas.map((b) => b.mhz),
            [700, 800, 900, 900, 1800, 2100, 2600, 3500],
          );
          // Cada código tiene su observación, con la fecha en que la fuente empezó a decirlo y el
          // enlace a su ficha en el registro.
          assert.deepStrictEqual(
            ficha.estaciones.map((e) => e.origenes.length),
            [1, 1, 2],
          );
          for (const origen of ficha.estaciones.flatMap((e) => e.origenes)) {
            assert.strictEqual(origen.fuente, "registro-oficial");
            assert.strictEqual(origen.fecha, NOCHE);
            assert.strictEqual(origen.afirma, "presente");
            assert.isTrue(
              origen.url.startsWith("https://geoportal.minetur.gob.es/VCTEL/detalleEstacion.do?"),
            );
          }
          assert.match(movistar?.origenes[0]?.clave ?? "", / - 0802532$/u);
          // La ficha no enseña los identificadores internos de Convex.
          assert.notProperty(ficha, "_id");
          assert.isTrue(ficha.estaciones.every((e) => !("_id" in e)));
        }),
      ),
  );

  it.effect("sin emplazamiento con esa clave exacta, no hay ficha", () =>
    conConvex(
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        assert.isTrue(
          Option.isNone(
            yield* convex.query(refs.public.datos.ficha, { clave: "movistar-0802532" }),
          ),
        );
        yield* TestClock.setTime(NOCHE);
        yield* ejecutar(capaGrabada("registro-oficial", yield* muestraCampusNord));
        // Sin el cero no es la misma clave (ADR 0012).
        assert.isTrue(
          Option.isNone(yield* convex.query(refs.public.datos.ficha, { clave: "movistar-802532" })),
        );
      }),
    ),
  );
});
