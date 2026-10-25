// Cada prueba monta su publicación y su cliente HTTP, nuevos en cada una.
// @effect-diagnostics strictEffectProvide:off
import { versionDeCapa } from "@celda/dominio/capa";
import { LICENCIAS } from "@celda/dominio/licencias";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { atender } from "./emplazamientos.ts";
import { Publicacion, publicacionDelOrigen } from "./publicacion.ts";
import { type ProvinciaDePrueba, publicacionDePrueba } from "./pruebas.ts";
import { CercanosEnJson, ErrorEnJson } from "./respuesta.ts";

const WEB = "https://celda.prueba";
const NOCHE = Date.UTC(2026, 9, 3, 22, 30);
const V1 = versionDeCapa(NOCHE);
const V2 = versionDeCapa(NOCHE + 30 * 86_400_000);

/** El punto de las consultas: en el límite entre Madrid, al norte, y Toledo, al sur. */
const PUNTO = "lat=40.1&lon=-3.7";

const MADRID: ProvinciaDePrueba = {
  codigo: "28",
  nombre: "Madrid",
  municipio: { codigo: "28161", nombre: "Valdemoro" },
  emplazamientos: [
    { clave: "m1", longitud: -3.7, latitud: 40.101, companias: ["vodafone"] },
    { clave: "m2", longitud: -3.7, latitud: 40.104, companias: ["movistar"] },
    { clave: "m3", longitud: -3.7, latitud: 40.12, companias: ["movistar"] },
  ],
};
const TOLEDO: ProvinciaDePrueba = {
  codigo: "45",
  nombre: "Toledo",
  municipio: { codigo: "45161", nombre: "Seseña" },
  emplazamientos: [
    { clave: "t1", longitud: -3.7, latitud: 40.0995, companias: ["digi"] },
    { clave: "t2", longitud: -3.7, latitud: 40.097, companias: ["movistar", "orange"] },
    { clave: "t3", longitud: -3.7, latitud: 40.09, companias: ["orange"] },
  ],
};
const BARCELONA: ProvinciaDePrueba = {
  codigo: "08",
  nombre: "Barcelona",
  municipio: { codigo: "08019", nombre: "Barcelona" },
  emplazamientos: [{ clave: "b1", longitud: 2.17, latitud: 41.38, companias: ["movistar"] }],
};

const HOY = publicacionDePrueba(V1, NOCHE, [MADRID, TOLEDO, BARCELONA]);

/**
 * La API sobre un origen de prueba que contesta lo que haya en `ficheros` en cada momento y apunta
 * las rutas que se le piden. Devuelve una función que hace una consulta y lo que pidió.
 */
const conOrigen = (inicial: ReadonlyMap<string, string>) =>
  Effect.gen(function* () {
    const ficheros = yield* Ref.make(inicial);
    const peticiones = yield* Ref.make<ReadonlyArray<string>>([]);
    const cliente = HttpClient.make((request, url) =>
      Effect.gen(function* () {
        const ruta = url.href.slice(`${WEB}/capas/`.length);
        yield* Ref.update(peticiones, (p) => [...p, ruta]);
        const cuerpo = (yield* Ref.get(ficheros)).get(ruta);
        return HttpClientResponse.fromWeb(
          request,
          new Response(cuerpo ?? "no está", { status: cuerpo === undefined ? 404 : 200 }),
        );
      }),
    );
    const publicacion = yield* Effect.provide(
      Effect.service(Publicacion),
      publicacionDelOrigen.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, cliente))),
    );
    const consultar = (busqueda: string) =>
      Effect.gen(function* () {
        yield* Ref.set(peticiones, []);
        const respuesta = yield* Effect.provideService(
          atender(new Request(`${WEB}/api/emplazamientos?${busqueda}`)),
          Publicacion,
          publicacion,
        );
        const texto = yield* Effect.promise(() => respuesta.text());
        return { respuesta, texto, peticiones: (yield* Ref.get(peticiones)).toSorted() };
      });
    return { consultar, ficheros };
  });

const comoRespuesta = Schema.decodeUnknownSync(CercanosEnJson);
const comoError = Schema.decodeUnknownSync(ErrorEnJson);
const claves = (texto: string) => comoRespuesta(texto).emplazamientos.map((e) => e.clave);

describe("GET /api/emplazamientos", () => {
  it.effect(
    "ordena por distancia los de las dos provincias del borde y solo pide las que toca",
    () =>
      Effect.gen(function* () {
        const { consultar } = yield* conOrigen(HOY);
        const { respuesta, texto, peticiones } = yield* consultar(PUNTO);
        assert.strictEqual(respuesta.status, 200);
        assert.deepStrictEqual(claves(texto), ["t1", "m1", "t2", "m2"]);
        assert.deepStrictEqual(
          comoRespuesta(texto).emplazamientos.map((e) => e.distanciaMetros),
          [56, 111, 334, 445],
        );
        assert.strictEqual(comoRespuesta(texto).total, 4);
        assert.isFalse(comoRespuesta(texto).hayMas);
        assert.deepStrictEqual(peticiones, [
          `provincias/28/${V1.replace(/\W/gu, "")}.json`,
          `provincias/45/${V1.replace(/\W/gu, "")}.json`,
          `resumen@${V1.replace(/\W/gu, "")}.json`,
          "vigente.json",
        ]);
      }),
  );

  it.effect("con un límite devuelve los más cercanos y dice que hay más", () =>
    Effect.gen(function* () {
      const { consultar } = yield* conOrigen(HOY);
      const { texto } = yield* consultar(`${PUNTO}&limite=2`);
      assert.deepStrictEqual(claves(texto), ["t1", "m1"]);
      assert.strictEqual(comoRespuesta(texto).total, 4);
      assert.isTrue(comoRespuesta(texto).hayMas);
    }),
  );

  it.effect(
    "el filtro deja los emplazamientos con alguna de sus compañías, también compartidos",
    () =>
      Effect.gen(function* () {
        const { consultar } = yield* conOrigen(HOY);
        const cerca = yield* consultar(`${PUNTO}&compania=orange`);
        assert.deepStrictEqual(claves(cerca.texto), ["t2"]);
        assert.deepStrictEqual(comoRespuesta(cerca.texto).emplazamientos[0]?.companias, [
          "movistar",
          "orange",
        ]);
        const lejos = yield* consultar(`${PUNTO}&radio=2000&compania=Orange,digi`);
        assert.deepStrictEqual(claves(lejos.texto), ["t1", "t2", "t3"]);
        assert.deepStrictEqual(comoRespuesta(lejos.texto).consulta.companias, ["orange", "digi"]);
      }),
  );

  it.effect("da de cada emplazamiento su lugar, su lote de fichas y su enlace al mapa", () =>
    Effect.gen(function* () {
      const { consultar } = yield* conOrigen(HOY);
      const { respuesta, texto } = yield* consultar(`${PUNTO}&limite=1`);
      const [t1] = comoRespuesta(texto).emplazamientos;
      assert.deepStrictEqual(t1?.municipio, { codigo: "45161", nombre: "Seseña" });
      assert.deepStrictEqual(t1?.provincia, { codigo: "45", nombre: "Toledo" });
      assert.strictEqual(t1?.ficha, `${WEB}/capas/fichas/45/${V1.replace(/\W/gu, "")}.json`);
      assert.strictEqual(t1?.enlace, `${WEB}/?emplazamiento=t1&provincia=45`);
      assert.strictEqual(comoRespuesta(texto).version, V1);
      assert.strictEqual(comoRespuesta(texto).fecha, "2026-10-03T22:30:00.000Z");
      // Una publicación sin licencias en `vigente.json` lleva las del código.
      assert.deepStrictEqual(comoRespuesta(texto).licencias, LICENCIAS);
      assert.strictEqual(respuesta.headers.get("Access-Control-Allow-Origin"), "*");
      assert.strictEqual(
        respuesta.headers.get("Cache-Control"),
        "public, max-age=300, s-maxage=86400",
      );
    }),
  );

  it.effect(
    "lo leído se queda en la instancia; vigente.json se vuelve a pedir a los 5 minutos",
    () =>
      Effect.gen(function* () {
        const { consultar } = yield* conOrigen(HOY);
        yield* consultar(PUNTO);
        assert.deepStrictEqual((yield* consultar(PUNTO)).peticiones, []);
        assert.deepStrictEqual((yield* consultar("lat=40.12&lon=-3.7")).peticiones, []);
        yield* TestClock.adjust("5 minutes");
        assert.deepStrictEqual((yield* consultar(PUNTO)).peticiones, ["vigente.json"]);
      }),
  );

  it.effect("con una versión nueva, la consulta sale entera de ella", () =>
    Effect.gen(function* () {
      const { consultar, ficheros } = yield* conOrigen(HOY);
      yield* consultar(PUNTO);
      // m1 se retira en la versión nueva. Los ficheros de la anterior siguen en el origen.
      const manana = publicacionDePrueba(V2, NOCHE + 30 * 86_400_000, [
        { ...MADRID, emplazamientos: MADRID.emplazamientos.filter((e) => e.clave !== "m1") },
        TOLEDO,
        BARCELONA,
      ]);
      yield* Ref.set(ficheros, new Map([...HOY, ...manana]));
      const antes = yield* consultar(PUNTO);
      assert.strictEqual(comoRespuesta(antes.texto).version, V1);
      yield* TestClock.adjust("5 minutes");
      const despues = yield* consultar(PUNTO);
      assert.strictEqual(comoRespuesta(despues.texto).version, V2);
      assert.deepStrictEqual(claves(despues.texto), ["t1", "t2", "m2"]);
      assert.isTrue(
        despues.peticiones.every((p) => p === "vigente.json" || p.includes("20261102")),
      );
    }),
  );

  it.effect("un resumen de otra versión que la vigente da 503 y no se guarda", () =>
    Effect.gen(function* () {
      const resumenV1 = [...HOY].find(([ruta]) => ruta.startsWith("resumen@"));
      const manana = publicacionDePrueba(V2, NOCHE, [MADRID, TOLEDO]);
      const resumenV2 = [...manana.keys()].find((ruta) => ruta.startsWith("resumen@")) ?? "";
      const roto = new Map([...manana, [resumenV2, resumenV1?.[1] ?? ""]]);
      const { consultar, ficheros } = yield* conOrigen(roto);
      const { respuesta, texto } = yield* consultar(PUNTO);
      assert.strictEqual(respuesta.status, 503);
      assert.deepStrictEqual(comoError(texto), {
        error: "datos-no-disponibles",
        mensaje: "No se han podido leer los datos publicados. Vuelve a intentarlo en unos minutos.",
      });
      assert.strictEqual(respuesta.headers.get("Cache-Control"), "no-store");
      yield* Ref.set(ficheros, manana);
      assert.strictEqual((yield* consultar(PUNTO)).respuesta.status, 200);
    }),
  );

  it.effect("una capa de provincia que falta da 503; cuando llega, contesta", () =>
    Effect.gen(function* () {
      const capaDeToledo = `provincias/45/${V1.replace(/\W/gu, "")}.json`;
      const sinToledo = new Map([...HOY].filter(([ruta]) => ruta !== capaDeToledo));
      const { consultar, ficheros } = yield* conOrigen(sinToledo);
      assert.strictEqual((yield* consultar(PUNTO)).respuesta.status, 503);
      yield* Ref.set(ficheros, HOY);
      const { respuesta, peticiones } = yield* consultar(PUNTO);
      assert.strictEqual(respuesta.status, 200);
      // El fallo de Toledo cortó la lectura de Madrid, que se pide otra vez. Ni vigente.json ni el
      // resumen, que ya se habían leído.
      assert.deepStrictEqual(peticiones, [capaDeToledo.replace("/45/", "/28/"), capaDeToledo]);
    }),
  );

  it.effect("una consulta que no vale contesta 400 sin pedir nada al origen", () =>
    Effect.gen(function* () {
      const { consultar } = yield* conOrigen(HOY);
      const { respuesta, texto, peticiones } = yield* consultar("lat=40.1&lon=-3.7&radio=20000");
      assert.strictEqual(respuesta.status, 400);
      assert.deepStrictEqual(comoError(texto), {
        error: "consulta-no-valida",
        mensaje: "radio tiene que ser un número entero de metros, de 1 a 10000.",
      });
      assert.deepStrictEqual(peticiones, []);
      assert.strictEqual(respuesta.headers.get("Access-Control-Allow-Origin"), "*");
      assert.strictEqual(respuesta.headers.get("Cache-Control"), "no-store");
    }),
  );
});
