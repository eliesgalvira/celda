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

import { BuzonAdministrado, buzonAdministrado, conexionDesdeConfig } from "./buzon.ts";

const URL_DE_PRUEBA = "https://ejemplo-123.convex.cloud";
const CLAVE = "prod:ejemplo-123|secreto";

interface Peticion {
  readonly url: string;
  readonly autorizacion: string | undefined;
  readonly cuerpo: string;
}

/** Un Convex de prueba que contesta en otra tarea, por orden, lo que se le dé, y apunta lo que recibe. */
const convexQueContesta = (respuestas: ReadonlyArray<readonly [number, string]>) =>
  Effect.gen(function* () {
    const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
    const cliente = HttpClient.make((request, url) =>
      Effect.gen(function* () {
        yield* Effect.yieldNow;
        const cuerpo =
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
        const anteriores = yield* Ref.getAndUpdate(peticiones, (p) => [
          ...p,
          { url: url.href, autorizacion: request.headers.authorization, cuerpo },
        ]);
        const [estado, texto] = respuestas[Math.min(anteriores.length, respuestas.length - 1)] ?? [
          500,
          "",
        ];
        return HttpClientResponse.fromWeb(request, new Response(texto, { status: estado }));
      }),
    );
    const buzon = buzonAdministrado({ url: URL_DE_PRUEBA, clave: Redacted.make(CLAVE) }).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, cliente)),
    );
    return { buzon, peticiones: Ref.get(peticiones) };
  });

const PAGINA_VACIA = '{"status":"success","value":{"aportaciones":[],"ultima":null}}';

describe("el buzón con la clave de administración", () => {
  it.effect(
    "llama a la función interna por la API HTTP de Convex, con la clave en la cabecera",
    () =>
      Effect.gen(function* () {
        const convex = yield* convexQueContesta([[200, PAGINA_VACIA]]);
        const pagina = yield* Effect.flatMap(BuzonAdministrado, (b) => b.pendientes(null, 50)).pipe(
          Effect.provide(convex.buzon),
        );
        assert.deepStrictEqual(pagina, { aportaciones: [], ultima: null });
        assert.deepStrictEqual(yield* convex.peticiones, [
          {
            url: `${URL_DE_PRUEBA}/api/query`,
            autorizacion: `Convex ${CLAVE}`,
            cuerpo:
              '{"path":"moderacion:pendientes","format":"convex_encoded_json","args":[{"despuesDe":null,"limite":50}]}',
          },
        ]);
      }),
  );

  it.effect(
    "un error declarado de la función llega con su tipo, y la clave nunca sale en un mensaje",
    () =>
      Effect.gen(function* () {
        const convex = yield* convexQueContesta([
          [
            560,
            '{"status":"error","errorMessage":"Uncaught ConvexError","errorData":{"_tag":"AportacionYaModerada","id":"a","estado":"aceptada"}}',
          ],
          [401, '{"code":"BadAdminKey"}'],
          [560, '{"status":"error","errorMessage":"Server Error"}'],
        ]);
        const buzon = yield* Effect.service(BuzonAdministrado).pipe(Effect.provide(convex.buzon));
        const yaModerada = yield* Effect.flip(buzon.rechazar("a", "Me lo pienso"));
        assert.deepInclude(yaModerada, {
          _tag: "AportacionYaModerada",
          id: "a",
          estado: "aceptada",
        });
        const clave = yield* Effect.flip(buzon.aceptar("a", "Bien"));
        assert.deepInclude(clave, { _tag: "ClaveNoValida", estado: 401 });
        const caido = yield* Effect.flip(buzon.vetar("ip", "huella", "spam"));
        assert.strictEqual(caido._tag, "BuzonNoDisponible");
        for (const error of [yaModerada, clave, caido]) {
          assert.notInclude(error.message, "secreto");
        }
      }),
  );

  it.effect("un fallo pasajero se reintenta dos veces, y luego el buzón no está disponible", () =>
    Effect.gen(function* () {
      const convex = yield* convexQueContesta([
        [503, "no"],
        [503, "no"],
        [200, PAGINA_VACIA],
      ]);
      const buzon = yield* Effect.service(BuzonAdministrado).pipe(Effect.provide(convex.buzon));
      const fibra = yield* Effect.forkChild(buzon.aceptadas(null, 200));
      yield* TestClock.adjust("2 seconds");
      assert.deepStrictEqual(yield* Fiber.join(fibra), { aportaciones: [], ultima: null });
      assert.lengthOf(yield* convex.peticiones, 3);

      const siempreCaido = yield* convexQueContesta([[503, "no"]]);
      const otro = yield* Effect.service(BuzonAdministrado).pipe(
        Effect.provide(siempreCaido.buzon),
      );
      const falla = yield* Effect.forkChild(Effect.flip(otro.aceptadas(null, 200)));
      yield* TestClock.adjust("2 seconds");
      const error = yield* Fiber.join(falla);
      assert.strictEqual(error._tag, "BuzonNoDisponible");
      assert.lengthOf(yield* siempreCaido.peticiones, 3);
    }),
  );

  it.effect("la conexión sale de CELDA_CONVEX_URL y CELDA_CONVEX_CLAVE, y sin las dos no hay", () =>
    Effect.gen(function* () {
      const leer = (variables: Record<string, string>) =>
        conexionDesdeConfig.parse(ConfigProvider.fromUnknown(variables));
      const conexion = yield* leer({
        CELDA_CONVEX_URL: `${URL_DE_PRUEBA}/`,
        CELDA_CONVEX_CLAVE: CLAVE,
      });
      assert.isTrue(Option.isSome(conexion));
      if (Option.isSome(conexion)) {
        assert.strictEqual(conexion.value.url, URL_DE_PRUEBA);
        assert.strictEqual(Redacted.value(conexion.value.clave), CLAVE);
      }
      assert.isTrue(Option.isNone(yield* leer({ CELDA_CONVEX_URL: URL_DE_PRUEBA })));
    }),
  );
});
