// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { AceptadasDelBuzon, aceptadasPorHttp, conexionDePublicacionDesdeConfig } from "./buzon.ts";

const SITIO = "https://ejemplo-123.convex.site";
const CLAVE = "clave-de-publicacion-de-prueba-0123456789";

interface Peticion {
  readonly url: string;
  readonly autorizacion: string | undefined;
}

/** Un buzón de prueba que contesta en otra tarea, por orden, lo que se le dé, y apunta lo que recibe. */
const buzonQueContesta = (respuestas: ReadonlyArray<readonly [number, string]>) =>
  Effect.gen(function* () {
    const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
    const cliente = HttpClient.make((request, url) =>
      Effect.gen(function* () {
        yield* Effect.yieldNow;
        const anteriores = yield* Ref.getAndUpdate(peticiones, (p) => [
          ...p,
          { url: url.href, autorizacion: request.headers.authorization },
        ]);
        const [estado, texto] = respuestas[Math.min(anteriores.length, respuestas.length - 1)] ?? [
          500,
          "",
        ];
        return HttpClientResponse.fromWeb(request, new Response(texto, { status: estado }));
      }),
    );
    const capa = aceptadasPorHttp({ sitio: SITIO, clave: Redacted.make(CLAVE) }).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, cliente)),
    );
    const leer = (despuesDe: number | null) =>
      Effect.flatMap(AceptadasDelBuzon, (buzon) => buzon.leer(despuesDe)).pipe(
        Effect.provide(capa),
      );
    return { leer, peticiones: Ref.get(peticiones) };
  });

const VACIA = '{"aportaciones":[],"ultima":null}';

describe("lo aceptado del buzón, con la clave de publicación", () => {
  it.effect("pide la acción HTTP con la clave como Bearer y sigue desde donde se le dice", () =>
    Effect.gen(function* () {
      const buzon = yield* buzonQueContesta([[200, VACIA]]);
      assert.deepStrictEqual(yield* buzon.leer(null), { aportaciones: [], ultima: null });
      assert.deepStrictEqual(yield* buzon.leer(1791059052966), { aportaciones: [], ultima: null });
      assert.deepStrictEqual(yield* buzon.peticiones, [
        { url: `${SITIO}/aportaciones/aceptadas`, autorizacion: `Bearer ${CLAVE}` },
        {
          url: `${SITIO}/aportaciones/aceptadas?despues-de=1791059052966`,
          autorizacion: `Bearer ${CLAVE}`,
        },
      ]);
    }),
  );

  it.effect(
    "un 401 o una respuesta que no se entiende dicen que el buzón no está disponible, sin la clave",
    () =>
      Effect.gen(function* () {
        const buzon = yield* buzonQueContesta([
          [401, ""],
          [200, '{"aportaciones":[{"identidad":"x"}],"ultima":null}'],
        ]);
        const rechazada = yield* Effect.flip(buzon.leer(null));
        assert.include(rechazada.message, "no acepta CELDA_PUBLICACION_CLAVE");
        const rara = yield* Effect.flip(buzon.leer(null));
        assert.strictEqual(rara._tag, "BuzonNoDisponible");
        for (const error of [rechazada, rara]) assert.notInclude(error.message, CLAVE);
      }),
  );

  it.effect("un fallo pasajero se reintenta dos veces", () =>
    Effect.gen(function* () {
      const buzon = yield* buzonQueContesta([
        [503, ""],
        [503, ""],
        [200, VACIA],
      ]);
      const fibra = yield* Effect.forkChild(buzon.leer(null));
      yield* TestClock.adjust("2 seconds");
      assert.deepStrictEqual(yield* Fiber.join(fibra), { aportaciones: [], ultima: null });
      assert.lengthOf(yield* buzon.peticiones, 3);
    }),
  );

  it.effect(
    "la conexión sale de CELDA_CONVEX_SITE_URL y CELDA_PUBLICACION_CLAVE, y sin las dos no hay",
    () =>
      Effect.gen(function* () {
        const leer = (variables: Record<string, string>) =>
          conexionDePublicacionDesdeConfig.parse(ConfigProvider.fromUnknown(variables));
        const conexion = yield* leer({
          CELDA_CONVEX_SITE_URL: `${SITIO}/`,
          CELDA_PUBLICACION_CLAVE: CLAVE,
        });
        assert.isTrue(Option.isSome(conexion));
        if (Option.isSome(conexion)) {
          assert.strictEqual(conexion.value.sitio, SITIO);
          assert.strictEqual(Redacted.value(conexion.value.clave), CLAVE);
        }
        // Una clave de despliegue no sirve aquí: la noche no la lee.
        assert.isTrue(
          Option.isNone(
            yield* leer({ CELDA_CONVEX_SITE_URL: SITIO, CELDA_CONVEX_CLAVE: "prod:x|y" }),
          ),
        );
      }),
  );
});
