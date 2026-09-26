// Cada prueba monta su buscador con un cliente HTTP de prueba nuevo.
// @effect-diagnostics strictEffectProvide:off
import { assert, describe, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { BuscadorDeDirecciones, buscadorNominatim } from "./buscador.ts";
import CON_NUMERO from "./referencia/nominatim-numero.json";
import SAGRADA_FAMILIA from "./referencia/nominatim-sagrada-familia.json";

const NOMINATIM = "http://nominatim.prueba";

interface Peticion {
  readonly url: URL;
  readonly cabeceras: ReadonlyArray<string>;
  /** Cuándo llegó, en milisegundos del reloj de la prueba. */
  readonly cuando: number;
}

/** Lo que contesta el servidor de prueba: un cuerpo JSON, un estado de error o nada nunca. */
type Contesta = { readonly estado: number; readonly cuerpo: string } | "nunca";

const JSON_DE = (datos: ReadonlyArray<unknown>): Contesta => ({
  estado: 200,
  cuerpo: JSON.stringify(datos),
});

/**
 * El buscador real sobre un servidor de prueba que contesta a cada consulta `q` con lo que diga
 * `respuestas` (la siguiente de la lista en cada petición) y apunta lo que recibe.
 */
const montar = (respuestas: ReadonlyMap<string, ReadonlyArray<Contesta>>, url = NOMINATIM) => {
  const peticiones: Array<Peticion> = [];
  const cliente = HttpClient.make((request, direccion) =>
    Effect.gen(function* () {
      const cuando = yield* Clock.currentTimeMillis;
      peticiones.push({ url: direccion, cabeceras: Object.keys(request.headers), cuando });
      const q = direccion.searchParams.get("q") ?? "";
      const vez = peticiones.filter((p) => p.url.searchParams.get("q") === q).length - 1;
      const lista = respuestas.get(q) ?? [JSON_DE([])];
      const contesta = lista[Math.min(vez, lista.length - 1)] ?? JSON_DE([]);
      if (contesta === "nunca") return yield* Effect.never;
      return HttpClientResponse.fromWeb(
        request,
        new Response(contesta.cuerpo, { status: contesta.estado }),
      );
    }),
  );
  const capa = buscadorNominatim.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, cliente)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ VITE_BUSCADOR_URL: url }))),
  );
  return { capa, peticiones };
};

const buscar = (consulta: string) =>
  Effect.flatMap(BuscadorDeDirecciones, (buscador) => buscador.buscar(consulta));

describe("búsqueda de direcciones con Nominatim", () => {
  it.effect("pide a Nominatim solo en la zona de Barcelona y da nombres cortos sin repetir", () => {
    const { capa, peticiones } = montar(new Map([["sagrada familia", [JSON_DE(SAGRADA_FAMILIA)]]]));
    return Effect.gen(function* () {
      const direcciones = yield* buscar("  Sagrada   Familia ");
      assert.deepStrictEqual(direcciones, [
        {
          nombre: "Basílica de la Sagrada Familia",
          detalle: "Carrer de Provença, la Sagrada Família, l'Eixample, Barcelona",
          posicion: { longitud: 2.1744283, latitud: 41.4035046 },
        },
        {
          nombre: "Sagrada Família",
          detalle: "Carrer de la Marina, la Sagrada Família, l'Eixample, Barcelona",
          posicion: direcciones[1]?.posicion ?? { longitud: 0, latitud: 0 },
        },
        {
          nombre: "Sagrada Família",
          detalle: "Carrer de Provença, la Sagrada Família, l'Eixample, Barcelona",
          posicion: direcciones[2]?.posicion ?? { longitud: 0, latitud: 0 },
        },
      ]);

      const [peticion] = peticiones;
      assert.strictEqual(peticion?.url.pathname, "/search");
      assert.deepStrictEqual(Object.fromEntries(peticion?.url.searchParams ?? []), {
        q: "sagrada familia",
        format: "jsonv2",
        addressdetails: "1",
        limit: "5",
        countrycodes: "es",
        "accept-language": "es",
        viewbox: "1.85,41.6,2.45,41.2",
        bounded: "1",
      });
      // Sin cabeceras propias: el navegador no manda una petición previa de CORS por cada búsqueda.
      assert.deepStrictEqual(peticion?.cabeceras, []);
    }).pipe(Effect.provide(capa));
  });

  it.effect("sin nombre, la dirección es la calle con su número", () => {
    const { capa } = montar(new Map([["carrer de jordi girona 31", [JSON_DE(CON_NUMERO)]]]));
    return Effect.gen(function* () {
      const [direccion] = yield* buscar("Carrer de Jordi Girona 31");
      assert.strictEqual(direccion?.nombre, "Carrer de Bet Figueras, 31");
      assert.strictEqual(direccion?.detalle, "Pedralbes, les Corts, Barcelona");
    }).pipe(Effect.provide(capa));
  });

  it.effect("deja al menos un segundo entre dos peticiones, aunque se busque seguido", () => {
    const { capa, peticiones } = montar(new Map());
    return Effect.gen(function* () {
      const fibra = yield* Effect.forkChild(
        Effect.all([buscar("gràcia"), buscar("sants"), buscar("poblenou")], {
          concurrency: "unbounded",
        }),
      );
      // Cada espera se programa al acabar la petición anterior: el reloj avanza de medio en medio
      // segundo hasta que terminan las tres.
      while (fibra.pollUnsafe() === undefined) yield* TestClock.adjust("500 millis");
      const momentos = peticiones.map((p) => p.cuando);
      assert.lengthOf(momentos, 3);
      for (let i = 1; i < momentos.length; i++) {
        assert.isAtLeast((momentos[i] ?? 0) - (momentos[i - 1] ?? 0), 1000);
      }
    }).pipe(Effect.provide(capa));
  });

  it.effect("guarda las respuestas: repetir la búsqueda no vuelve a preguntar", () => {
    const { capa, peticiones } = montar(new Map([["sagrada familia", [JSON_DE(SAGRADA_FAMILIA)]]]));
    return Effect.gen(function* () {
      const primera = yield* buscar("Sagrada Familia");
      const segunda = yield* buscar("sagrada familia");
      assert.deepStrictEqual(segunda, primera);
      assert.lengthOf(peticiones, 1);
    }).pipe(Effect.provide(capa));
  });

  it.effect("un fallo no se guarda: la siguiente búsqueda vuelve a preguntar", () => {
    const { capa, peticiones } = montar(
      new Map([["sants", [{ estado: 503, cuerpo: "" }, JSON_DE(CON_NUMERO)]]]),
    );
    return Effect.gen(function* () {
      const error = yield* Effect.flip(buscar("sants"));
      assert.strictEqual(error.motivo, "sin-respuesta");
      const fibra = yield* Effect.forkChild(buscar("sants"));
      yield* TestClock.adjust("1 second");
      assert.lengthOf(yield* Fiber.join(fibra), 1);
      assert.lengthOf(peticiones, 2);
    }).pipe(Effect.provide(capa));
  });

  it.effect("si Nominatim pide esperar (429), lo dice como límite", () => {
    const { capa } = montar(new Map([["sants", [{ estado: 429, cuerpo: "" }]]]));
    return Effect.gen(function* () {
      const error = yield* Effect.flip(buscar("sants"));
      assert.strictEqual(error.motivo, "limite");
    }).pipe(Effect.provide(capa));
  });

  it.effect("si no contesta en 10 s, lo dice", () => {
    const { capa } = montar(new Map([["sants", ["nunca"]]]));
    return Effect.gen(function* () {
      const fibra = yield* Effect.forkChild(Effect.flip(buscar("sants")));
      yield* TestClock.adjust("10 seconds");
      const error = yield* Fiber.join(fibra);
      assert.strictEqual(error.motivo, "sin-respuesta");
    }).pipe(Effect.provide(capa));
  });

  it.effect("una consulta de menos de tres letras no se envía", () => {
    const { capa, peticiones } = montar(new Map());
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* buscar(" bc "), []);
      assert.lengthOf(peticiones, 0);
    }).pipe(Effect.provide(capa));
  });

  it.effect("con el buscador apagado en la configuración, lo dice sin preguntar a nadie", () => {
    const { capa, peticiones } = montar(new Map(), "apagado");
    return Effect.gen(function* () {
      const error = yield* Effect.flip(buscar("sagrada familia"));
      assert.strictEqual(error.motivo, "apagada");
      assert.lengthOf(peticiones, 0);
    }).pipe(Effect.provide(capa));
  });
});
