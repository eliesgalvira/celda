// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { codificarRuta, firmarV4 } from "../src/almacenes/firma";
import { almacenEnR2 } from "../src/almacenes/r2";
import { AlmacenDeFicheros } from "../src/publicacion";

const PUNTO = "http://r2.prueba";
const FICHERO = "sitios@2026-09-26T02:15:03Z.json";

interface Peticion {
  readonly metodo: string;
  readonly url: string;
  readonly cabeceras: Readonly<Record<string, string>>;
}

/**
 * Un cubo de S3 de prueba en memoria: guarda lo que se sube, respeta `If-None-Match: *` con un
 * 412 y apunta cada petición con sus cabeceras.
 */
const cuboDePrueba = Effect.gen(function* () {
  const objetos = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
  const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
  const cliente = HttpClient.make((request, url) =>
    Effect.gen(function* () {
      yield* Ref.update(peticiones, (p) => [
        ...p,
        { metodo: request.method, url: url.href, cabeceras: request.headers },
      ]);
      const guardados = yield* Ref.get(objetos);
      const clave = url.pathname;
      const responder = (estado: number, cuerpo = "") =>
        HttpClientResponse.fromWeb(request, new Response(cuerpo, { status: estado }));
      if (request.method === "GET") {
        const guardado = guardados.get(clave);
        return guardado === undefined ? responder(404, "NoSuchKey") : responder(200, guardado);
      }
      if (request.headers["if-none-match"] === "*" && guardados.has(clave)) {
        return responder(412, "PreconditionFailed");
      }
      const cuerpo =
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      yield* Ref.update(objetos, (o) => new Map([...o, [clave, cuerpo]]));
      return responder(200);
    }),
  );
  const almacen = almacenEnR2({
    cuenta: "cuenta",
    cubo: "celda-capas",
    idClave: "AKIDEXAMPLE",
    secreto: Redacted.make("secreto"),
    origen: "https://capas.celda.prueba",
    puntoDeEntrada: PUNTO,
  }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, cliente)));
  return { almacen, objetos, peticiones };
});

describe("almacén de ficheros en R2", () => {
  it.effect("firma como AWS Signature V4 (caso get-vanilla de la batería de AWS)", () =>
    Effect.gen(function* () {
      const autorizacion = yield* firmarV4(
        {
          metodo: "GET",
          ruta: "/",
          cabeceras: { Host: "example.amazonaws.com", "X-Amz-Date": "20150830T123600Z" },
          hashCuerpo: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
        {
          idClave: "AKIDEXAMPLE",
          secreto: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
          region: "us-east-1",
          servicio: "service",
        },
      );
      assert.strictEqual(
        autorizacion,
        "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
          "SignedHeaders=host;x-amz-date, " +
          "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
      );
    }),
  );

  it("codifica las claves como la petición canónica de S3", () => {
    assert.strictEqual(
      codificarRuta(`/celda-capas/fichas@2026-09-26T02:15:03Z/7.json`),
      "/celda-capas/fichas%402026-09-26T02%3A15%3A03Z/7.json",
    );
  });

  it.effect("sube un fichero nuevo firmado y sin pisar, y si llega igual no hace nada", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.UTC(2026, 8, 26, 2, 15, 3));
      const cubo = yield* cuboDePrueba;
      const almacen = yield* Effect.service(AlmacenDeFicheros).pipe(Effect.provide(cubo.almacen));
      assert.isTrue(yield* almacen.guardar(FICHERO, '{"version":"a"}'));
      assert.isFalse(yield* almacen.guardar(FICHERO, '{"version":"a"}'));
      const fallo = yield* Effect.flip(almacen.guardar(FICHERO, '{"version":"b"}'));
      assert.strictEqual(fallo._tag, "FicheroInmutable");
      assert.deepStrictEqual(
        (yield* Ref.get(cubo.objetos)).get("/celda-capas/sitios%402026-09-26T02%3A15%3A03Z.json"),
        '{"version":"a"}',
      );

      const [subida] = yield* Ref.get(cubo.peticiones);
      assert.strictEqual(subida?.metodo, "PUT");
      assert.strictEqual(
        subida?.url,
        `${PUNTO}/celda-capas/sitios%402026-09-26T02%3A15%3A03Z.json`,
      );
      assert.strictEqual(subida?.cabeceras["if-none-match"], "*");
      assert.strictEqual(subida?.cabeceras["x-amz-date"], "20260926T021503Z");
      assert.strictEqual(subida?.cabeceras["cache-control"], "public, max-age=31536000, immutable");
      assert.match(
        subida?.cabeceras.authorization ?? "",
        /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260926\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/u,
      );
      assert.strictEqual(almacen.url(FICHERO), `https://capas.celda.prueba/${FICHERO}`);
    }),
  );

  it.effect("vigente.json se sustituye sin condición y con caché corta", () =>
    Effect.gen(function* () {
      const cubo = yield* cuboDePrueba;
      const almacen = yield* Effect.service(AlmacenDeFicheros).pipe(Effect.provide(cubo.almacen));
      assert.isTrue(Option.isNone(yield* almacen.leer("vigente.json")));
      yield* almacen.cambiarVigente('{"version":"a"}');
      yield* almacen.cambiarVigente('{"version":"b"}');
      assert.deepStrictEqual(yield* almacen.leer("vigente.json"), Option.some('{"version":"b"}'));
      const subidas = (yield* Ref.get(cubo.peticiones)).filter((p) => p.metodo === "PUT");
      assert.isTrue(subidas.every((p) => p.cabeceras["if-none-match"] === undefined));
      assert.isTrue(
        subidas.every((p) => p.cabeceras["cache-control"] === "public, max-age=0, must-revalidate"),
      );
    }),
  );
});
