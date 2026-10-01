// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { describirError, type ErrorDeExtractor, ExtractorDePuntos } from "../extractor.ts";
import { leerMuestra } from "../pruebas/grabado.ts";
import {
  clienteDePrueba,
  NO_HAY_ROBOTS,
  type Peticion,
  type Respondedor,
} from "../pruebas/http.ts";
import { esperarConReloj } from "../pruebas/reloj.ts";
import { capa, OPCIONES, type Opciones } from "./extractor.ts";

/** Ejecuta `programa` con el extractor real sobre el cliente de prueba y el reloj de prueba. */
const conExtractor = <A, E>(
  responder: Respondedor,
  programa: (extractor: typeof ExtractorDePuntos.Service) => Effect.Effect<A, E>,
  cambios: Partial<Opciones> = {},
) =>
  Effect.gen(function* () {
    const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
    const fibra = yield* Effect.gen(function* () {
      return yield* programa(yield* ExtractorDePuntos);
    }).pipe(
      Effect.provide(
        capa({ ...OPCIONES, ...cambios }).pipe(
          Layer.provide(clienteDePrueba(peticiones, responder)),
        ),
      ),
      Effect.exit,
      Effect.forkChild,
    );
    const salida = yield* esperarConReloj(fibra);
    return { salida, peticiones: yield* Ref.get(peticiones) };
  });

/** El error de una salida fallida, como lo apunta la ejecución de ingesta. */
const motivoDe = <A>(salida: Exit.Exit<A, ErrorDeExtractor>): string =>
  Exit.isFailure(salida)
    ? Option.match(Cause.findErrorOption(salida.cause), {
        onNone: () => "",
        onSome: describirError,
      })
    : "";

const muestra = (nombre: string) =>
  Effect.map(leerMuestra(`antenasmoviles/${nombre}`), (bytes) => new Uint8Array(bytes));

describe("extractor de antenasmoviles.es", () => {
  it.effect(
    "lee robots.txt, el listado una vez y el detalle de cada punto, con 5 s entre peticiones",
    () =>
      Effect.gen(function* () {
        const robots = yield* muestra("robots.txt");
        const listado = yield* muestra("v1-showf-er5_extracto-campus-nord.json");
        const detalle = yield* muestra("v1-markers_0802532.json");
        const { salida, peticiones } = yield* conExtractor(
          (url) => {
            if (url.pathname === "/robots.txt") return { estado: 200, cuerpo: robots };
            if (url.pathname === "/v1/showf") return { estado: 200, cuerpo: listado };
            return { estado: 200, cuerpo: detalle };
          },
          (extractor) =>
            Effect.gen(function* () {
              const { puntos } = yield* extractor.puntos;
              const campus = puntos.find((p) => p.clave === "0802532,086040,86040,CATR0228A");
              return campus === undefined ? undefined : yield* extractor.detalle(campus);
            }),
        );
        assert.isTrue(Exit.isSuccess(salida));
        if (Exit.isSuccess(salida)) {
          assert.deepStrictEqual(salida.value, { observaciones: [], avisos: [] });
        }
        assert.deepStrictEqual(
          peticiones.map((p) => p.ruta),
          ["/robots.txt", "/v1/showf?er5", "/v1/markers?id=0802532,086040,86040,CATR0228A"],
        );
        assert.isTrue(peticiones.every((p) => p.userAgent === OPCIONES.userAgent));
        const huecos = peticiones.slice(1).map((p, i) => p.en - (peticiones[i]?.en ?? 0));
        assert.isTrue(huecos.every((hueco) => hueco >= Duration.toMillis(Duration.seconds(5))));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("si robots.txt prohíbe /v1 no pide nada más", () =>
    Effect.gen(function* () {
      const { salida, peticiones } = yield* conExtractor(
        (url) =>
          url.pathname === "/robots.txt"
            ? { estado: 200, cuerpo: "User-agent: *\nDisallow: /v1\n" }
            : { estado: 200, cuerpo: "[]" },
        (extractor) => extractor.puntos,
      );
      assert.deepStrictEqual(
        peticiones.map((p) => p.ruta),
        ["/robots.txt"],
      );
      assert.isTrue(Exit.isFailure(salida));
      assert.include(motivoDe(salida), "ProhibidoPorRobots");
    }),
  );

  it.effect("un 403 o una página HTML es la fuente bloqueando a Celda, no una zona vacía", () =>
    Effect.gen(function* () {
      for (const respuesta of [
        { estado: 403, cuerpo: "Forbidden" },
        { estado: 200, cuerpo: "<!DOCTYPE html><title>Just a moment...</title>" },
      ]) {
        const { salida } = yield* conExtractor(
          (url) => (url.pathname === "/robots.txt" ? NO_HAY_ROBOTS : respuesta),
          (extractor) => extractor.puntos,
        );
        assert.isTrue(Exit.isFailure(salida));
        assert.include(motivoDe(salida), "FuenteNoDisponible");
        assert.include(motivoDe(salida), "bloqueando a Celda");
      }
    }),
  );

  it.effect("un listado sin ningún punto en la zona es un fallo de la fuente", () =>
    Effect.gen(function* () {
      const { salida } = yield* conExtractor(
        (url) =>
          url.pathname === "/robots.txt"
            ? NO_HAY_ROBOTS
            : { estado: 200, cuerpo: '[[40.45,-3.61,["000003"],"1",{"VF":["B3"]}]]' },
        (extractor) => extractor.puntos,
      );
      assert.isTrue(Exit.isFailure(salida));
      assert.include(motivoDe(salida), "ningún punto en la zona entre 1 filas");
    }),
  );

  it.effect("no pasa de su límite de peticiones", () =>
    Effect.gen(function* () {
      const listado = yield* muestra("v1-showf-er5_extracto-campus-nord.json");
      const { salida, peticiones } = yield* conExtractor(
        (url) =>
          url.pathname === "/robots.txt"
            ? NO_HAY_ROBOTS
            : url.pathname === "/v1/showf"
              ? { estado: 200, cuerpo: listado }
              : { estado: 200, cuerpo: "[]" },
        (extractor) =>
          Effect.gen(function* () {
            const { puntos } = yield* extractor.puntos;
            yield* Effect.forEach(puntos, extractor.detalle);
          }),
        { maxPeticiones: 4 },
      );
      assert.strictEqual(peticiones.length, 4);
      assert.isTrue(Exit.isFailure(salida));
      assert.include(motivoDe(salida), "LimiteDePeticiones");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reintenta un 503 con espera y, si sigue, deja la fuente como no disponible", () =>
    Effect.gen(function* () {
      const { salida, peticiones } = yield* conExtractor(
        (url) => (url.pathname === "/robots.txt" ? NO_HAY_ROBOTS : { estado: 503, cuerpo: "" }),
        (extractor) => extractor.puntos,
      );
      assert.strictEqual(peticiones.length, 1 + 1 + OPCIONES.reintentos);
      const [, primera, segunda] = peticiones.map((p) => p.en);
      assert.isAtLeast((segunda ?? 0) - (primera ?? 0), 5000);
      assert.isTrue(Exit.isFailure(salida));
      assert.include(motivoDe(salida), "FuenteNoDisponible");
    }),
  );

  it.effect("un 429 que no dice cuánto esperar no se reintenta: la fuente pide esperar", () =>
    Effect.gen(function* () {
      const { salida, peticiones } = yield* conExtractor(
        (url) => (url.pathname === "/robots.txt" ? NO_HAY_ROBOTS : { estado: 429, cuerpo: "" }),
        (extractor) => extractor.puntos,
      );
      assert.strictEqual(peticiones.length, 2);
      assert.isTrue(Exit.isFailure(salida));
      assert.include(motivoDe(salida), "FuentePideEsperar: HTTP 429");
    }),
  );
});
