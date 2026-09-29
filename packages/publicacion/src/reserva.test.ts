// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { CopiaDeReserva, copiaEnVercel, leerPorHttp } from "./reserva.ts";

const HOOK = "https://api.vercel.prueba/v1/integrations/deploy/prj_1/secreto-del-hook";
const COPIA = "https://celda.prueba/capas";

interface Peticion {
  readonly metodo: string;
  readonly url: string;
  readonly cabeceras: Readonly<Record<string, string>>;
}

/** Un servidor de prueba que contesta a cada URL con un estado y apunta las peticiones. */
const servidor = (respuestas: ReadonlyMap<string, ReadonlyArray<readonly [number, string]>>) =>
  Effect.gen(function* () {
    const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
    const cliente = HttpClient.make((request, url) =>
      Effect.gen(function* () {
        const anteriores = yield* Ref.getAndUpdate(peticiones, (p) => [
          ...p,
          { metodo: request.method, url: url.href, cabeceras: request.headers },
        ]);
        const suyas = respuestas.get(url.href) ?? [[404, "no está"]];
        const vez = anteriores.filter((p) => p.url === url.href).length;
        const [estado, cuerpo] = suyas[Math.min(vez, suyas.length - 1)] ?? [404, ""];
        return HttpClientResponse.fromWeb(request, new Response(cuerpo, { status: estado }));
      }),
    );
    return { capa: Layer.succeed(HttpClient.HttpClient, cliente), peticiones: Ref.get(peticiones) };
  });

describe("copia de reserva en Vercel", () => {
  it.effect("lee el vigente.json que sirve la copia sin caché, y un 404 es que no tiene", () =>
    Effect.gen(function* () {
      const conCopia = yield* servidor(
        new Map([[`${COPIA}/vigente.json`, [[200, '{"version":"a"}']]]]),
      );
      const vigente = yield* Effect.flatMap(CopiaDeReserva, (c) => c.vigente).pipe(
        Effect.provide(
          copiaEnVercel({ hook: Redacted.make(HOOK), origen: Option.some(`${COPIA}/`) }).pipe(
            Layer.provide(conCopia.capa),
          ),
        ),
      );
      assert.deepStrictEqual(vigente, Option.some('{"version":"a"}'));
      const [peticion] = yield* conCopia.peticiones;
      assert.strictEqual(peticion?.cabeceras["cache-control"], "no-cache");

      const vacia = yield* servidor(new Map());
      const nada = yield* Effect.flatMap(CopiaDeReserva, (c) => c.vigente).pipe(
        Effect.provide(
          copiaEnVercel({ hook: Redacted.make(HOOK), origen: Option.some(COPIA) }).pipe(
            Layer.provide(vacia.capa),
          ),
        ),
      );
      assert.isTrue(Option.isNone(nada));
    }),
  );

  it.effect("sin la URL de la copia no pregunta nada y se despliega siempre", () =>
    Effect.gen(function* () {
      const vacio = yield* servidor(new Map());
      const vigente = yield* Effect.flatMap(CopiaDeReserva, (c) => c.vigente).pipe(
        Effect.provide(
          copiaEnVercel({ hook: Redacted.make(HOOK), origen: Option.none() }).pipe(
            Layer.provide(vacio.capa),
          ),
        ),
      );
      assert.isTrue(Option.isNone(vigente));
      assert.lengthOf(yield* vacio.peticiones, 0);
    }),
  );

  it.effect("despliega con un POST al hook, y un fallo no enseña la URL del hook", () =>
    Effect.gen(function* () {
      const vercel = yield* servidor(
        new Map([
          [
            HOOK,
            [
              [201, '{"job":{}}'],
              [500, "no"],
            ],
          ],
        ]),
      );
      const reserva = copiaEnVercel({ hook: Redacted.make(HOOK), origen: Option.none() }).pipe(
        Layer.provide(vercel.capa),
      );
      const desplegar = Effect.flatMap(CopiaDeReserva, (c) => c.desplegar).pipe(
        Effect.provide(reserva),
      );
      yield* desplegar;
      const fallo = yield* Effect.flip(desplegar);
      assert.strictEqual(fallo.motivo, "el deploy hook contesta 500");
      assert.deepStrictEqual(
        (yield* vercel.peticiones).map((p) => [p.metodo, p.url]),
        [
          ["POST", HOOK],
          ["POST", HOOK],
        ],
      );
    }),
  );
});

describe("lectura de lo publicado por HTTP", () => {
  it.effect("un 404 es un fichero que no existe; un 5xx se reintenta antes de fallar", () =>
    Effect.gen(function* () {
      const origen = "https://capas.prueba";
      const r2 = yield* servidor(
        new Map([
          [
            `${origen}/vigente.json`,
            [
              [503, ""],
              [200, "{}"],
            ],
          ],
          [`${origen}/caido.json`, [[503, ""]]],
        ]),
      );
      const leer = yield* leerPorHttp(`${origen}/`).pipe(Effect.provide(r2.capa));
      assert.isTrue(Option.isNone(yield* leer("no-esta.json")));
      const reintentado = yield* Effect.forkChild(leer("vigente.json"));
      yield* TestClock.adjust("1 second");
      assert.deepStrictEqual(yield* Fiber.join(reintentado), Option.some("{}"));

      const caido = yield* Effect.forkChild(Effect.flip(leer("caido.json")));
      yield* TestClock.adjust("1 minute");
      const fallo = yield* Fiber.join(caido);
      assert.strictEqual(fallo.motivo, "GET caido.json: 503");
      // La primera y tres reintentos.
      assert.lengthOf(
        (yield* r2.peticiones).filter((p) => p.url.endsWith("/caido.json")),
        4,
      );
    }),
  );
});
