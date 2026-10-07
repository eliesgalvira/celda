// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
// Un servidor que no contesta nunca o que corta la conexión a media petición, y que dice cuándo
// cierra el cliente cada una. El servidor de Effect no deja hacer ni ver eso.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeHttp from "node:http";

import { codificarConsulta, codificarRuta, firmarV4, sha256DeBytes } from "./firma.ts";
import { almacenEnR2, archivoEnR2, copiasEnR2, leerListado } from "./r2.ts";
import { AlmacenDeCopias, AlmacenDeFicheros, AlmacenDelArchivo } from "../almacen.ts";

const PUNTO = "http://r2.prueba";
const FICHERO = "sitios@2026-09-26T02:15:03Z.json";
const CUBO = "celda-capas";

interface Peticion {
  readonly metodo: string;
  readonly url: string;
  readonly cabeceras: Readonly<Record<string, string>>;
  readonly bytes: number;
}

const OPCIONES = {
  cuenta: "cuenta",
  cubo: CUBO,
  idClave: "AKIDEXAMPLE",
  secreto: Redacted.make("secreto"),
  puntoDeEntrada: PUNTO,
};

/** La dirección de un servidor que escucha en TCP, de la que basta el puerto. */
const decodificarDireccion = Schema.decodeUnknownEffect(Schema.Struct({ port: Schema.Int }));

const texto = (bytes: Uint8Array | undefined): string | undefined =>
  bytes === undefined ? undefined : new TextDecoder().decode(bytes);

/**
 * Un cubo de S3 de prueba en memoria: guarda lo que se sube, respeta `If-None-Match: *` con un
 * 412, lista por prefijo y apunta cada petición con sus cabeceras y el tamaño de su cuerpo.
 */
const cuboDePrueba = Effect.gen(function* () {
  const objetos = yield* Ref.make<ReadonlyMap<string, Uint8Array>>(new Map());
  const peticiones = yield* Ref.make<ReadonlyArray<Peticion>>([]);
  const cliente = HttpClient.make((request, url) =>
    Effect.gen(function* () {
      const cuerpo = request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array(0);
      yield* Ref.update(peticiones, (p) => [
        ...p,
        { metodo: request.method, url: url.href, cabeceras: request.headers, bytes: cuerpo.length },
      ]);
      const guardados = yield* Ref.get(objetos);
      const clave = url.pathname;
      const responder = (estado: number, cuerpo: BodyInit = "") =>
        HttpClientResponse.fromWeb(
          request,
          new Response(estado === 204 ? null : cuerpo, { status: estado }),
        );
      if (request.method === "GET" && clave === `/${CUBO}`) {
        // ListObjectsV2 de dos en dos, para que haga falta pedir varias páginas.
        const prefijo = url.searchParams.get("prefix") ?? "";
        const todas = [...guardados.keys()]
          .map((k) => decodeURIComponent(k.slice(`/${CUBO}/`.length)))
          .filter((k) => k.startsWith(prefijo));
        const desde = Number(url.searchParams.get("continuation-token") ?? "0");
        const pagina = todas.slice(desde, desde + 2);
        const mas = desde + 2 < todas.length;
        return responder(
          200,
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${CUBO}</Name>` +
            `<IsTruncated>${mas}</IsTruncated>` +
            pagina
              .map((k) => `<Contents><Key>${k.replace("&", "&amp;")}</Key></Contents>`)
              .join("") +
            (mas ? `<NextContinuationToken>${desde + 2}</NextContinuationToken>` : "") +
            `</ListBucketResult>`,
        );
      }
      if (request.method === "DELETE") {
        yield* Ref.update(objetos, (o) => new Map([...o].filter(([k]) => k !== clave)));
        return responder(204);
      }
      if (request.method === "GET") {
        const guardado = guardados.get(clave);
        return guardado === undefined
          ? responder(404, "NoSuchKey")
          : responder(200, new Uint8Array(guardado));
      }
      if (request.headers["if-none-match"] === "*" && guardados.has(clave)) {
        return responder(412, "PreconditionFailed");
      }
      yield* Ref.update(objetos, (o) => new Map([...o, [clave, cuerpo]]));
      return responder(200);
    }),
  );
  const http = Layer.succeed(HttpClient.HttpClient, cliente);
  const almacen = almacenEnR2({ ...OPCIONES, origen: "https://celda.prueba/capas" }).pipe(
    Layer.provide(http),
  );
  const copias = copiasEnR2(OPCIONES).pipe(Layer.provide(http));
  const archivo = archivoEnR2(OPCIONES).pipe(Layer.provide(http));
  return { almacen, copias, archivo, objetos, peticiones };
});

/**
 * Adelanta el reloj de prueba de segundo en segundo hasta que la fibra termina, y deja correr entre
 * paso y paso lo asíncrono de verdad, como las firmas de Web Crypto, para que cada espera se
 * programe antes del paso siguiente.
 */
const esperarConReloj = <A, E>(fibra: Fiber.Fiber<A, E>) =>
  Effect.gen(function* () {
    for (let paso = 0; paso < 3600 && fibra.pollUnsafe() === undefined; paso++) {
      yield* TestClock.withLive(Effect.sleep("1 millis"));
      yield* TestClock.adjust("1 second");
    }
    return yield* Fiber.join(fibra);
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

  it.effect("firma la consulta ordenada (caso get-vanilla-query-order-key-case de AWS)", () =>
    Effect.gen(function* () {
      const consulta = codificarConsulta([
        ["Param2", "value2"],
        ["Param1", "value1"],
      ]);
      assert.strictEqual(consulta, "Param1=value1&Param2=value2");
      const autorizacion = yield* firmarV4(
        {
          metodo: "GET",
          ruta: "/",
          consulta,
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
      assert.match(
        autorizacion,
        /Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500$/u,
      );
    }),
  );

  it("codifica los valores de la consulta como AWS, también las barras", () => {
    assert.strictEqual(
      codificarConsulta([
        ["list-type", "2"],
        ["continuation-token", "1a/b+c="],
      ]),
      "continuation-token=1a%2Fb%2Bc%3D&list-type=2",
    );
  });

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
        texto(
          (yield* Ref.get(cubo.objetos)).get("/celda-capas/sitios%402026-09-26T02%3A15%3A03Z.json"),
        ),
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
      assert.strictEqual(almacen.url(FICHERO), `https://celda.prueba/capas/${FICHERO}`);
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

  it.effect("lista el cubo página a página, con la consulta firmada, y borra", () =>
    Effect.gen(function* () {
      const cubo = yield* cuboDePrueba;
      const almacen = yield* Effect.service(AlmacenDeFicheros).pipe(Effect.provide(cubo.almacen));
      const lote = "fichas@2026-09-26T02:15:03Z/0.json";
      yield* almacen.guardar(FICHERO, "{}");
      yield* almacen.guardar(lote, "{}");
      yield* almacen.guardar("fichas@2026-09-26T02:15:03Z/1.json", "{}");
      yield* almacen.cambiarVigente("{}");
      assert.sameMembers(
        [...(yield* almacen.listar)],
        [FICHERO, lote, "fichas@2026-09-26T02:15:03Z/1.json", "vigente.json"],
      );
      const listados = (yield* Ref.get(cubo.peticiones)).filter((p) => p.url.includes("?"));
      assert.deepStrictEqual(
        listados.map((p) => p.url),
        [`${PUNTO}/${CUBO}?list-type=2`, `${PUNTO}/${CUBO}?continuation-token=2&list-type=2`],
      );
      assert.match(listados[1]?.cabeceras.authorization ?? "", /Signature=[0-9a-f]{64}$/u);

      yield* almacen.borrar(lote);
      yield* almacen.borrar(lote);
      assert.sameMembers(
        [...(yield* almacen.listar)],
        [FICHERO, "fichas@2026-09-26T02:15:03Z/1.json", "vigente.json"],
      );
      const borrado = (yield* Ref.get(cubo.peticiones)).find((p) => p.metodo === "DELETE");
      assert.strictEqual(borrado?.url, `${PUNTO}/${CUBO}/fichas%402026-09-26T02%3A15%3A03Z/0.json`);
    }),
  );

  it.effect(
    "las copias de la base van firmadas con su contenido bajo copias/, y se listan y se borran sin tocar lo publicado",
    () =>
      Effect.gen(function* () {
        const cubo = yield* cuboDePrueba;
        const almacen = yield* Effect.service(AlmacenDeFicheros).pipe(Effect.provide(cubo.almacen));
        const copias = yield* Effect.service(AlmacenDeCopias).pipe(Effect.provide(cubo.copias));
        yield* almacen.guardar(FICHERO, "{}");
        const contenido = new Uint8Array([0x1f, 0x8b, 0, 255, 128, 7]);
        yield* copias.guardar("ingesta-2026-09-26T02-15-03.000Z.sqlite.gz", contenido);
        yield* copias.guardar("ingesta-2026-09-27T02-15-03.000Z.sqlite.gz", contenido);
        yield* copias.guardar("ingesta-2026-09-28T02-15-03.000Z.sqlite.gz", contenido);

        const subida = (yield* Ref.get(cubo.peticiones)).find(
          (p) => p.metodo === "PUT" && p.url.includes("/copias/"),
        );
        assert.strictEqual(
          subida?.url,
          `${PUNTO}/${CUBO}/copias/ingesta-2026-09-26T02-15-03.000Z.sqlite.gz`,
        );
        assert.strictEqual(subida?.bytes, contenido.length);
        assert.strictEqual(subida?.cabeceras["content-type"], "application/gzip");
        assert.strictEqual(
          subida?.cabeceras["x-amz-content-sha256"],
          yield* sha256DeBytes(contenido),
        );
        // Una copia no es inmutable: con el mismo nombre se sube otra vez.
        assert.isUndefined(subida?.cabeceras["if-none-match"]);
        assert.deepStrictEqual(
          [
            ...((yield* Ref.get(cubo.objetos)).get(
              `/${CUBO}/copias/ingesta-2026-09-26T02-15-03.000Z.sqlite.gz`,
            ) ?? []),
          ],
          [...contenido],
        );

        assert.deepStrictEqual(
          [...(yield* copias.listar)],
          [
            "ingesta-2026-09-26T02-15-03.000Z.sqlite.gz",
            "ingesta-2026-09-27T02-15-03.000Z.sqlite.gz",
            "ingesta-2026-09-28T02-15-03.000Z.sqlite.gz",
          ],
        );
        const listados = (yield* Ref.get(cubo.peticiones)).filter((p) => p.url.includes("?"));
        assert.deepStrictEqual(
          listados.map((p) => p.url),
          [
            `${PUNTO}/${CUBO}?list-type=2&prefix=copias%2F`,
            `${PUNTO}/${CUBO}?continuation-token=2&list-type=2&prefix=copias%2F`,
          ],
        );
        yield* copias.borrar("ingesta-2026-09-26T02-15-03.000Z.sqlite.gz");
        assert.lengthOf(yield* copias.listar, 2);
        assert.isTrue(Option.isSome(yield* almacen.leer(FICHERO)));
      }),
  );

  it.effect(
    "los paquetes del archivo van firmados bajo archivo/ y se listan sin ver las copias ni lo publicado",
    () =>
      Effect.gen(function* () {
        const cubo = yield* cuboDePrueba;
        const almacen = yield* Effect.service(AlmacenDeFicheros).pipe(Effect.provide(cubo.almacen));
        const copias = yield* Effect.service(AlmacenDeCopias).pipe(Effect.provide(cubo.copias));
        const archivo = yield* Effect.service(AlmacenDelArchivo).pipe(Effect.provide(cubo.archivo));
        yield* almacen.guardar(FICHERO, "{}");
        const contenido = new Uint8Array([0x53, 0x51, 0x4c, 0, 255]);
        yield* copias.guardar("ingesta-2026-09-26T02-15-03.000Z.sqlite.gz", contenido);
        yield* archivo.guardar("archivo-2026-09-26T02-15-03.000Z.sqlite", contenido);
        yield* archivo.guardar("archivo-2026-09-27T02-15-03.000Z.sqlite", contenido);
        yield* archivo.guardar("archivo-2026-09-28T02-15-03.000Z.sqlite", contenido);

        const subida = (yield* Ref.get(cubo.peticiones)).find(
          (p) => p.metodo === "PUT" && p.url.includes("/archivo/"),
        );
        assert.strictEqual(
          subida?.url,
          `${PUNTO}/${CUBO}/archivo/archivo-2026-09-26T02-15-03.000Z.sqlite`,
        );
        assert.strictEqual(subida?.bytes, contenido.length);
        assert.strictEqual(
          subida?.cabeceras["x-amz-content-sha256"],
          yield* sha256DeBytes(contenido),
        );
        assert.deepStrictEqual(
          [...(yield* archivo.listar)],
          [
            "archivo-2026-09-26T02-15-03.000Z.sqlite",
            "archivo-2026-09-27T02-15-03.000Z.sqlite",
            "archivo-2026-09-28T02-15-03.000Z.sqlite",
          ],
        );
        assert.deepStrictEqual(
          [...(yield* copias.listar)],
          ["ingesta-2026-09-26T02-15-03.000Z.sqlite.gz"],
        );
      }),
  );

  it.effect(
    "repite una petición que R2 rechaza por un momento o que no acaba a su plazo, y se rinde tras dos reintentos",
    () =>
      Effect.gen(function* () {
        // Cada intento contesta lo siguiente de la lista, o nunca si es `parada`.
        const respuestas = yield* Ref.make<ReadonlyArray<number | "parada">>([]);
        const intentos = yield* Ref.make<ReadonlyArray<{ hora: number; fecha: string }>>([]);
        const cliente = HttpClient.make((request) =>
          Effect.gen(function* () {
            const hora = yield* Clock.currentTimeMillis;
            yield* Ref.update(intentos, (i) => [
              ...i,
              { hora, fecha: request.headers["x-amz-date"] ?? "" },
            ]);
            const [respuesta = "parada", ...resto] = yield* Ref.get(respuestas);
            yield* Ref.set(respuestas, resto);
            if (respuesta === "parada") return yield* Effect.never;
            return HttpClientResponse.fromWeb(request, new Response("", { status: respuesta }));
          }),
        );
        const copias = yield* Effect.service(AlmacenDeCopias).pipe(
          Effect.provide(
            copiasEnR2(OPCIONES).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, cliente))),
          ),
        );
        const contenido = new Uint8Array([1, 2, 3]);
        const horas = Effect.map(Ref.get(intentos), (i) =>
          i.map(({ hora }) => hora - Date.UTC(2026, 9, 7, 2, 15)),
        );

        // El reloj de prueba avanza de segundo en segundo, así que cada intento puede llegar un
        // paso más tarde de lo justo.
        const casi = (horas: ReadonlyArray<number>, esperadas: ReadonlyArray<number>) => {
          assert.lengthOf(horas, esperadas.length);
          for (const [i, hora] of horas.entries()) {
            const esperada = esperadas[i] ?? 0;
            assert.isTrue(hora >= esperada && hora <= esperada + 3000, `${horas.join(", ")} ms`);
          }
        };

        // Con un 503, una petición parada y un 200, sube al tercer intento. El segundo va 2 s después
        // del 503, y el tercero, 4 s después de que el segundo se pase de sus cinco minutos.
        yield* TestClock.setTime(Date.UTC(2026, 9, 7, 2, 15));
        yield* Ref.set(respuestas, [503, "parada", 200]);
        yield* esperarConReloj(
          yield* Effect.forkChild(copias.guardar("ingesta.sqlite.gz", contenido)),
        );
        casi(yield* horas, [0, 2000, 2000 + 300_000 + 4000]);
        // Cada intento va firmado con su hora.
        const fechas = (yield* Ref.get(intentos)).map(({ fecha }) => fecha);
        assert.strictEqual(new Set(fechas).size, 3);
        assert.match(fechas[2] ?? "", /^20261007T0220\d\dZ$/u);

        // Si se para del todo, son tres intentos de cinco minutos y un fallo que lo dice.
        yield* Ref.set(intentos, []);
        yield* TestClock.setTime(Date.UTC(2026, 9, 7, 2, 15));
        yield* Ref.set(respuestas, []);
        const fallo = yield* esperarConReloj(
          yield* Effect.forkChild(Effect.flip(copias.guardar("ingesta.sqlite.gz", contenido))),
        );
        assert.strictEqual(
          fallo.motivo,
          "PUT copias/ingesta.sqlite.gz: sin acabar en 5m (3 intentos)",
        );
        casi(yield* horas, [0, 302_000, 606_000]);

        // Un 500 que no se arregla se devuelve tras los reintentos como cualquier otra respuesta.
        yield* Ref.set(intentos, []);
        yield* Ref.set(respuestas, [500, 500, 500]);
        const rechazada = yield* esperarConReloj(
          yield* Effect.forkChild(Effect.flip(copias.guardar("ingesta.sqlite.gz", contenido))),
        );
        assert.match(rechazada.motivo, /^PUT copias\/ingesta\.sqlite\.gz: 500/u);
        assert.lengthOf(yield* Ref.get(intentos), 3);
      }),
    30_000,
  );

  it.live(
    "contra un servidor que no contesta, cada intento acaba a su plazo y cierra su conexión; si la corta, dice por qué",
    () =>
      Effect.gen(function* () {
        // Lo que ve el servidor, que vive fuera de Effect.
        const visto = { recibidas: 0, cerradas: 0, corta: false };
        const servidor = yield* Effect.acquireRelease(
          Effect.callback<NodeHttp.Server>((resume) => {
            const abierto = NodeHttp.createServer((peticion) => {
              visto.recibidas++;
              peticion.on("close", () => {
                visto.cerradas++;
              });
              // Lee el cuerpo y no contesta nunca, o corta la conexión.
              peticion.resume();
              if (visto.corta) peticion.socket.destroy();
            });
            abierto.listen(0, "127.0.0.1", () => resume(Effect.succeed(abierto)));
          }),
          (abierto) =>
            Effect.callback<void>((resume) => {
              abierto.closeAllConnections();
              abierto.close(() => resume(Effect.void));
            }),
        );
        const { port: puerto } = yield* decodificarDireccion(servidor.address());
        const copias = yield* Effect.service(AlmacenDeCopias).pipe(
          Effect.provide(
            copiasEnR2({
              ...OPCIONES,
              puntoDeEntrada: `http://127.0.0.1:${puerto}`,
              plazos: { porPeticion: "300 millis", reintentos: 1, pausa: "10 millis" },
            }).pipe(Layer.provide(FetchHttpClient.layer)),
          ),
        );
        const contenido = new Uint8Array(256 * 1024);

        const fallo = yield* Effect.flip(copias.guardar("ingesta.sqlite.gz", contenido));
        assert.strictEqual(
          fallo.motivo,
          "PUT copias/ingesta.sqlite.gz: sin acabar en 300ms (2 intentos)",
        );
        assert.strictEqual(visto.recibidas, 2);
        // El cliente ha cerrado las dos conexiones al pasarse del plazo.
        yield* Effect.sleep("100 millis");
        assert.strictEqual(visto.cerradas, 2);

        visto.corta = true;
        const cortada = yield* Effect.flip(copias.guardar("ingesta.sqlite.gz", contenido));
        // El servidor ha cortado, y el motivo lleva la causa de undici, que Effect no da.
        assert.match(
          cortada.motivo,
          /^Transport error \(PUT http:.+\): (?:ECONNRESET|UND_ERR_SOCKET): .+ \(2 intentos\)$/u,
        );
        assert.strictEqual(visto.recibidas, 4);
      }).pipe(Effect.scoped),
  );

  it("lee las claves y el testigo de ListObjectsV2", () => {
    assert.deepStrictEqual(
      leerListado(
        "<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>a&amp;b.json</Key>" +
          "</Contents><Contents><Key>c.json</Key></Contents>" +
          "<NextContinuationToken>1/x+y=</NextContinuationToken></ListBucketResult>",
      ),
      { claves: ["a&b.json", "c.json"], siguiente: "1/x+y=" },
    );
    assert.deepStrictEqual(
      leerListado("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"),
      { claves: [], siguiente: undefined },
    );
  });
});
