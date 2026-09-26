// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { leerCapa } from "@celda/dominio/capa";
import { capaGrabada, muestraCampusNord } from "@celda/ingesta/pruebas/grabado";
import { MutationRunner, QueryRunner } from "@confect/server";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import { TestClock } from "effect/testing";

import refs from "../confect/_generated/refs";
import { AlmacenDeCapas, CapaInmutable, publicarCapa } from "../src/capas";
import { ejecutar } from "./ayudas";
import * as TestConfect from "./TestConfect";

const NOCHE = Date.UTC(2026, 8, 26, 2, 15);
const DIA = 86_400_000;
const ORIGEN = "http://capas.prueba";

/** Un almacén en memoria que se comporta como el de ficheros: no pisa un fichero distinto. */
const almacenEnMemoria = (ficheros: Ref.Ref<ReadonlyMap<string, string>>) =>
  Layer.succeed(
    AlmacenDeCapas,
    AlmacenDeCapas.of({
      guardar: (fichero, contenido) =>
        Effect.gen(function* () {
          const previo = (yield* Ref.get(ficheros)).get(fichero);
          if (previo === undefined) {
            yield* Ref.update(ficheros, (actuales) => new Map([...actuales, [fichero, contenido]]));
            return true;
          }
          if (previo !== contenido) {
            return yield* new CapaInmutable({ fichero });
          }
          return false;
        }),
      url: (fichero) => `${ORIGEN}/${fichero}`,
    }),
  );

/** Publica con el Convex en memoria y el almacén dado, como el generador real. */
const publicar = (ficheros: Ref.Ref<ReadonlyMap<string, string>>) =>
  Effect.gen(function* () {
    const convex = yield* TestConfect.TestConfect;
    return yield* publicarCapa().pipe(
      Effect.provide(
        Layer.mergeAll(
          almacenEnMemoria(ficheros),
          Layer.succeed(MutationRunner.MutationRunner, convex.mutation),
          Layer.succeed(QueryRunner.QueryRunner, convex.query),
        ),
      ),
    );
  });

const conConvex = <A, E, R>(efecto: Effect.Effect<A, E, R>) =>
  efecto.pipe(Effect.provide(Layer.merge(TestConfect.layer, NodeServices.layer)));

describe("capa de emplazamientos (API de Convex en memoria)", () => {
  it.effect("sin capa publicada, la vigente es ninguna", () =>
    conConvex(
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        assert.isTrue(Option.isNone(yield* convex.query(refs.public.capas.vigente)));
      }),
    ),
  );

  it.effect("publica la instantánea con su versión y Convex la da como vigente", () =>
    conConvex(
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        const grabada = yield* muestraCampusNord;
        yield* TestClock.setTime(NOCHE);
        yield* ejecutar(capaGrabada("registro-oficial", grabada));
        const ficheros = yield* Ref.make<ReadonlyMap<string, string>>(new Map());

        yield* TestClock.adjust(60_000);
        const publicada = yield* publicar(ficheros);
        assert.strictEqual(publicada.version, "sitios@2026-09-26T02:15:00Z");
        assert.strictEqual(publicada.url, `${ORIGEN}/sitios@2026-09-26T02:15:00Z.json`);
        assert.isTrue(publicada.ficheroNuevo && publicada.versionNueva);

        const vigente = yield* convex.query(refs.public.capas.vigente);
        assert.deepStrictEqual(
          vigente,
          Option.some({
            version: publicada.version,
            fecha: NOCHE,
            url: publicada.url,
            emplazamientos: publicada.emplazamientos,
          }),
        );

        // El fichero guardado es esa versión y lleva todos los emplazamientos, con todas las
        // compañías de los compartidos.
        const contenido = (yield* Ref.get(ficheros)).get("sitios@2026-09-26T02:15:00Z.json") ?? "";
        const leida = leerCapa(contenido, publicada.version);
        assert.isTrue(Result.isSuccess(leida));
        if (Result.isFailure(leida)) return;
        assert.strictEqual(leida.success.emplazamientos.length, publicada.emplazamientos);
        const campusNord = leida.success.emplazamientos.find((e) => e.clave === "movistar-0802532");
        assert.deepStrictEqual(campusNord?.companias, ["movistar", "vodafone", "orange"]);
      }),
    ),
  );

  it.effect("publicar otra vez sin cambios no escribe nada; con cambios, sale otra versión", () =>
    conConvex(
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        const grabada = yield* muestraCampusNord;
        yield* TestClock.setTime(NOCHE);
        yield* ejecutar(capaGrabada("registro-oficial", grabada));
        const ficheros = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
        const primera = yield* publicar(ficheros);
        const antes = yield* Ref.get(ficheros);

        yield* TestClock.adjust(DIA);
        const repetida = yield* publicar(ficheros);
        assert.strictEqual(repetida.version, primera.version);
        assert.isFalse(repetida.ficheroNuevo || repetida.versionNueva);
        assert.strictEqual(yield* Ref.get(ficheros), antes);

        // Una ingesta que cambia un emplazamiento da una capa nueva; la anterior sigue igual.
        const movida = {
          ...grabada,
          listado: {
            ...grabada.listado,
            registros: grabada.listado.registros.map((r) =>
              r.clave === "ORANGE ESPAGNE, S.A.U. - CATR0508Z"
                ? { ...r, posicion: { ...r.posicion, latitud: r.posicion.latitud + 0.0018 } }
                : r,
            ),
          },
        };
        yield* ejecutar(capaGrabada("registro-oficial", movida));
        const segunda = yield* publicar(ficheros);
        assert.notStrictEqual(segunda.version, primera.version);
        const despues = yield* Ref.get(ficheros);
        assert.strictEqual(despues.size, 2);
        assert.strictEqual(
          despues.get(`${primera.version}.json`),
          antes.get(`${primera.version}.json`),
        );
        const vigente = yield* convex.query(refs.public.capas.vigente);
        assert.strictEqual(Option.getOrNull(vigente)?.version, segunda.version);
      }),
    ),
  );

  it.effect("no pisa un fichero publicado con otro contenido ni registra la versión", () =>
    conConvex(
      Effect.gen(function* () {
        const convex = yield* TestConfect.TestConfect;
        const grabada = yield* muestraCampusNord;
        yield* TestClock.setTime(NOCHE);
        yield* ejecutar(capaGrabada("registro-oficial", grabada));
        const ficheros = yield* Ref.make<ReadonlyMap<string, string>>(
          new Map([["sitios@2026-09-26T02:15:00Z.json", '{"version":"otra cosa"}']]),
        );

        const fallo = yield* Effect.flip(publicar(ficheros));
        assert.strictEqual(fallo._tag, "CapaInmutable");
        assert.isTrue(Option.isNone(yield* convex.query(refs.public.capas.vigente)));
      }),
    ),
  );

  it.effect("sin emplazamientos no hay capa que publicar", () =>
    conConvex(
      Effect.gen(function* () {
        const ficheros = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
        const fallo = yield* Effect.flip(publicar(ficheros));
        assert.strictEqual(fallo._tag, "SinEmplazamientos");
        assert.strictEqual((yield* Ref.get(ficheros)).size, 0);
      }),
    ),
  );
});
