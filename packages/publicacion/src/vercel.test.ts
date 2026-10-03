// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { SitioEnVercel, sitioEnVercel } from "./vercel.ts";

const HOOK = "https://api.vercel.prueba/v1/integrations/deploy/prj_1/secreto-del-hook";
const CAPAS = "https://celda.prueba/capas";

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

describe("la web en Vercel, vista desde la ingesta", () => {
  it.effect("lee el vigente.json que sirve en /capas sin caché, y un 404 es que no tiene", () =>
    Effect.gen(function* () {
      const conCapas = yield* servidor(
        new Map([[`${CAPAS}/vigente.json`, [[200, '{"version":"a"}']]]]),
      );
      const vigente = yield* Effect.flatMap(SitioEnVercel, (c) => c.vigente).pipe(
        Effect.provide(
          sitioEnVercel({ hook: Redacted.make(HOOK), origen: Option.some(`${CAPAS}/`) }).pipe(
            Layer.provide(conCapas.capa),
          ),
        ),
      );
      assert.deepStrictEqual(vigente, Option.some('{"version":"a"}'));
      const [peticion] = yield* conCapas.peticiones;
      assert.strictEqual(peticion?.cabeceras["cache-control"], "no-cache");

      const vacia = yield* servidor(new Map());
      const nada = yield* Effect.flatMap(SitioEnVercel, (c) => c.vigente).pipe(
        Effect.provide(
          sitioEnVercel({ hook: Redacted.make(HOOK), origen: Option.some(CAPAS) }).pipe(
            Layer.provide(vacia.capa),
          ),
        ),
      );
      assert.isTrue(Option.isNone(nada));
    }),
  );

  it.effect("sin la URL de las capas no pregunta nada y se despliega siempre", () =>
    Effect.gen(function* () {
      const vacio = yield* servidor(new Map());
      const vigente = yield* Effect.flatMap(SitioEnVercel, (c) => c.vigente).pipe(
        Effect.provide(
          sitioEnVercel({ hook: Redacted.make(HOOK), origen: Option.none() }).pipe(
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
      const sitio = sitioEnVercel({ hook: Redacted.make(HOOK), origen: Option.none() }).pipe(
        Layer.provide(vercel.capa),
      );
      const desplegar = Effect.flatMap(SitioEnVercel, (c) => c.desplegar).pipe(
        Effect.provide(sitio),
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
