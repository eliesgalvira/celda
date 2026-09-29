// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import { versionDeCapa } from "@celda/dominio/capa";
import type { Ficha } from "@celda/dominio/ficha";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { enOtraTarea } from "../lib/pruebas.ts";
import { indexadorEnHilo } from "./indexador.ts";
import { conOrigenDeReserva, memoriaEnElNavegador } from "./origenes.ts";
import { publicacionDePrueba } from "./pruebas.ts";
import { capaDelOrigen, CapaEmplazamientos } from "./servicio.ts";

/**
 * Los escenarios de la exploración 05 (ADR 0010) contra el cliente de verdad: R2 como principal y
 * la copia de Vercel como reserva, cada uno con un modo que imita lo que se ve en un bloqueo.
 */

const PRINCIPAL = "https://r2.prueba";
const RESERVA = "https://celda.prueba/capas";
const NOCHE = Date.UTC(2026, 8, 26, 2, 15);

const ficha = (clave: string, longitud: number): Ficha => ({
  clave,
  posicion: { longitud, latitud: 41.39 },
  direccion: "CL JORDI GIRONA, 1. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: [],
  datosDel: NOCHE,
  version: NOCHE,
});

const PUBLICADA = publicacionDePrueba(versionDeCapa(NOCHE), NOCHE, [
  ficha("movistar-a", 2.1134),
  ficha("orange-b", 2.19),
]);
const RESUMEN = [...PUBLICADA.ficheros.keys()].find((f) => f.startsWith("resumen@")) ?? "";

/**
 * - `bien`: contesta con lo publicado, o 404.
 * - `cortado`: cierra la conexión, como un bloqueo que la reinicia.
 * - `colgado`: acepta y no contesta nunca, como un bloqueo que tira los paquetes.
 * - `lento`: contesta a los 400 ms.
 * - `caido`: 503. `cuota`: 429, como el error 1027 de Cloudflare.
 */
type Modo = "bien" | "cortado" | "colgado" | "lento" | "caido" | "cuota";
type Origen = "principal" | "reserva";

/** Un `localStorage` en memoria, para que cada prueba empiece sin nada recordado. */
class AlmacenLocal implements Storage {
  readonly #datos = new Map<string, string>();
  get length() {
    return this.#datos.size;
  }
  clear() {
    this.#datos.clear();
  }
  getItem(clave: string) {
    return this.#datos.get(clave) ?? null;
  }
  key(indice: number) {
    return [...this.#datos.keys()][indice] ?? null;
  }
  removeItem(clave: string) {
    this.#datos.delete(clave);
  }
  setItem(clave: string, valor: string) {
    this.#datos.set(clave, valor);
  }
}

/** Los dos orígenes de mentira, con su modo, y las peticiones que reciben en orden. */
const origenesDePrueba = Effect.gen(function* () {
  const modos = yield* Ref.make<Readonly<Record<Origen, Modo>>>({
    principal: "bien",
    reserva: "bien",
  });
  const peticiones = yield* Ref.make<ReadonlyArray<string>>([]);
  const cliente = HttpClient.make((request, url) =>
    Effect.gen(function* () {
      const origen: Origen = url.href.startsWith(PRINCIPAL) ? "principal" : "reserva";
      const fichero = url.href.slice((origen === "principal" ? PRINCIPAL : RESERVA).length + 1);
      yield* Ref.update(peticiones, (p) => [...p, `${origen} ${fichero}`]);
      yield* enOtraTarea;
      const modo = (yield* Ref.get(modos))[origen];
      if (modo === "cortado") {
        return yield* new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            request,
            description: "ERR_CONNECTION_RESET",
          }),
        });
      }
      if (modo === "colgado") return yield* Effect.never;
      if (modo === "lento") yield* Effect.sleep("400 millis");
      const cuerpo = PUBLICADA.ficheros.get(fichero);
      const estado =
        modo === "caido" ? 503 : modo === "cuota" ? 429 : cuerpo === undefined ? 404 : 200;
      return HttpClientResponse.fromWeb(
        request,
        new Response(estado === 200 ? cuerpo : "no", { status: estado }),
      );
    }),
  );
  return {
    capa: Layer.succeed(HttpClient.HttpClient, cliente),
    poner: (origen: Origen, modo: Modo) => Ref.update(modos, (m) => ({ ...m, [origen]: modo })),
    /** Las peticiones desde la última vez que se miraron. */
    nuevas: Ref.getAndSet(peticiones, []),
  };
});

type Origenes = Effect.Success<typeof origenesDePrueba>;

/** La configuración del build de Vercel: R2 como principal y `/capas` como reserva. */
const configuracion = (reserva: string | null) =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown(
      reserva === null
        ? { VITE_CAPAS_ORIGEN: PRINCIPAL }
        : { VITE_CAPAS_ORIGEN: PRINCIPAL, VITE_CAPAS_RESERVA: reserva },
    ),
  );

/** El cliente con reserva sobre los orígenes de prueba y una memoria dada. */
const clienteCon = (origenes: Origenes, memoria: Storage, reserva: string | null = RESERVA) =>
  conOrigenDeReserva.pipe(
    Layer.provide(origenes.capa),
    Layer.provide(memoriaEnElNavegador({ localStorage: memoria })),
    Layer.provide(configuracion(reserva)),
  );

/** Pide un fichero con el cliente del contexto y devuelve su estado. */
const pedir = (fichero: string) =>
  Effect.flatMap(HttpClient.HttpClient, (http) =>
    Effect.map(http.get(`${PRINCIPAL}/${fichero}`), (r) => r.status),
  );

/** Deja correr las tareas pendientes con el reloj de verdad y luego adelanta el de prueba. */
const pasar = (duracion: Duration.Input) =>
  Effect.gen(function* () {
    yield* TestClock.withLive(Effect.sleep("20 millis"));
    yield* TestClock.adjust(duracion);
    yield* TestClock.withLive(Effect.sleep("20 millis"));
  });

/** Pide un fichero en otra fibra, adelanta el reloj y espera la respuesta. */
const pedirTras = (fichero: string, duracion: Duration.Input) =>
  Effect.gen(function* () {
    const fibra = yield* Effect.forkChild(pedir(fichero));
    yield* pasar(duracion);
    return yield* Fiber.join(fibra);
  });

describe("origen de reserva de las capas (exploración 05)", () => {
  it.effect("01: con R2 bien, todo sale de R2 y nada de la reserva", () =>
    Effect.gen(function* () {
      const origenes = yield* origenesDePrueba;
      const resumen = yield* Effect.flatMap(CapaEmplazamientos, (c) => c.resumen).pipe(
        Effect.provide(
          capaDelOrigen.pipe(
            Layer.provide(clienteCon(origenes, new AlmacenLocal())),
            Layer.provide(indexadorEnHilo),
            Layer.provide(configuracion(RESERVA)),
          ),
        ),
      );
      assert.strictEqual(resumen.version, PUBLICADA.version);
      assert.deepStrictEqual(yield* origenes.nuevas, [
        "principal vigente.json",
        `principal ${RESUMEN}`,
      ]);
    }),
  );

  it.effect("02: con R2 cortado desde el principio carga de la reserva, y luego va directa", () =>
    Effect.gen(function* () {
      const origenes = yield* origenesDePrueba;
      yield* origenes.poner("principal", "cortado");
      const resumen = yield* Effect.flatMap(CapaEmplazamientos, (c) => c.resumen).pipe(
        Effect.provide(
          capaDelOrigen.pipe(
            Layer.provide(clienteCon(origenes, new AlmacenLocal())),
            Layer.provide(indexadorEnHilo),
            Layer.provide(configuracion(RESERVA)),
          ),
        ),
      );
      assert.strictEqual(resumen.version, PUBLICADA.version);
      assert.deepStrictEqual(yield* origenes.nuevas, [
        "principal vigente.json",
        "reserva vigente.json",
        `reserva ${RESUMEN}`,
      ]);
    }),
  );

  it.effect(
    "03: si R2 deja de contestar a mitad de la visita, lo siguiente sale de la reserva",
    () =>
      Effect.gen(function* () {
        const origenes = yield* origenesDePrueba;
        yield* Effect.gen(function* () {
          assert.strictEqual(yield* pedir("vigente.json"), 200);
          yield* origenes.poner("principal", "cortado");
          assert.strictEqual(yield* pedir(RESUMEN), 200);
          assert.strictEqual(yield* pedir(RESUMEN), 200);
        }).pipe(Effect.provide(clienteCon(origenes, new AlmacenLocal())));
        assert.deepStrictEqual(yield* origenes.nuevas, [
          "principal vigente.json",
          `principal ${RESUMEN}`,
          `reserva ${RESUMEN}`,
          `reserva ${RESUMEN}`,
        ]);
      }),
  );

  it.effect("04: un R2 que no contesta en 3 s pasa a la reserva", () =>
    Effect.gen(function* () {
      const origenes = yield* origenesDePrueba;
      yield* origenes.poner("principal", "colgado");
      const estado = yield* pedirTras("vigente.json", "3 seconds").pipe(
        Effect.provide(clienteCon(origenes, new AlmacenLocal())),
      );
      assert.strictEqual(estado, 200);
      assert.deepStrictEqual(yield* origenes.nuevas, [
        "principal vigente.json",
        "reserva vigente.json",
      ]);
    }),
  );

  it.effect("04b: un R2 algo lento, 400 ms, se queda en R2", () =>
    Effect.gen(function* () {
      const origenes = yield* origenesDePrueba;
      yield* origenes.poner("principal", "lento");
      const estado = yield* pedirTras("vigente.json", "400 millis").pipe(
        Effect.provide(clienteCon(origenes, new AlmacenLocal())),
      );
      assert.strictEqual(estado, 200);
      assert.deepStrictEqual(yield* origenes.nuevas, ["principal vigente.json"]);
    }),
  );

  it.effect("un 503 o un 429 de R2 cuentan como caída; un 404 es una respuesta", () =>
    Effect.gen(function* () {
      for (const modo of ["caido", "cuota"] as const) {
        const origenes = yield* origenesDePrueba;
        yield* origenes.poner("principal", modo);
        const estado = yield* pedir("vigente.json").pipe(
          Effect.provide(clienteCon(origenes, new AlmacenLocal())),
        );
        assert.strictEqual(estado, 200);
        assert.deepStrictEqual(yield* origenes.nuevas, [
          "principal vigente.json",
          "reserva vigente.json",
        ]);
      }
      const origenes = yield* origenesDePrueba;
      const estado = yield* pedir("no-esta.json").pipe(
        Effect.provide(clienteCon(origenes, new AlmacenLocal())),
      );
      assert.strictEqual(estado, 404);
      assert.deepStrictEqual(yield* origenes.nuevas, ["principal no-esta.json"]);
    }),
  );

  it.effect("05: sin ningún origen, el mapa dice que el servidor no contesta", () =>
    Effect.gen(function* () {
      const origenes = yield* origenesDePrueba;
      yield* origenes.poner("principal", "cortado");
      yield* origenes.poner("reserva", "caido");
      const fallo = yield* Effect.flatMap(CapaEmplazamientos, (c) => c.resumen).pipe(
        Effect.flip,
        Effect.provide(
          capaDelOrigen.pipe(
            Layer.provide(clienteCon(origenes, new AlmacenLocal())),
            Layer.provide(indexadorEnHilo),
            Layer.provide(configuracion(RESERVA)),
          ),
        ),
      );
      assert.strictEqual(fallo._tag, "OrigenNoResponde");
      assert.deepStrictEqual(yield* origenes.nuevas, [
        "principal vigente.json",
        "reserva vigente.json",
      ]);
    }),
  );

  it.effect("06: cuando R2 vuelve, el sondeo lo nota y se vuelve a R2", () =>
    Effect.gen(function* () {
      const origenes = yield* origenesDePrueba;
      yield* origenes.poner("principal", "cortado");
      yield* Effect.gen(function* () {
        assert.strictEqual(yield* pedir("vigente.json"), 200);
        yield* origenes.nuevas;
        // Sin sondeo hasta que pasan cinco minutos.
        yield* pasar("4 minutes");
        assert.deepStrictEqual(yield* origenes.nuevas, []);
        yield* origenes.poner("principal", "bien");
        yield* pasar("1 minute");
        assert.deepStrictEqual(yield* origenes.nuevas, ["principal vigente.json"]);
        assert.strictEqual(yield* pedir(RESUMEN), 200);
        assert.deepStrictEqual(yield* origenes.nuevas, [`principal ${RESUMEN}`]);
        // Con R2 de vuelta ya no se sondea.
        yield* pasar("10 minutes");
        assert.deepStrictEqual(yield* origenes.nuevas, []);
      }).pipe(Effect.provide(clienteCon(origenes, new AlmacenLocal())));
    }),
  );

  it.effect("07: tras caer los dos, en cuanto vuelve la reserva se carga de ella", () =>
    Effect.gen(function* () {
      const origenes = yield* origenesDePrueba;
      yield* origenes.poner("principal", "cortado");
      yield* origenes.poner("reserva", "cortado");
      yield* Effect.gen(function* () {
        const fallo = yield* Effect.flip(pedir("vigente.json"));
        assert.strictEqual(fallo._tag, "HttpClientError");
        yield* origenes.poner("reserva", "bien");
        assert.strictEqual(yield* pedir("vigente.json"), 200);
      }).pipe(Effect.provide(clienteCon(origenes, new AlmacenLocal())));
      assert.deepStrictEqual(yield* origenes.nuevas, [
        "principal vigente.json",
        "reserva vigente.json",
        "reserva vigente.json",
      ]);
    }),
  );

  it.effect("recuerda durante una hora, también en la visita siguiente, que R2 falló", () =>
    Effect.gen(function* () {
      const origenes = yield* origenesDePrueba;
      const memoria = new AlmacenLocal();
      yield* origenes.poner("principal", "colgado");
      yield* pedirTras("vigente.json", "3 seconds").pipe(
        Effect.provide(clienteCon(origenes, memoria)),
      );
      yield* origenes.nuevas;

      // Otra visita: no espera los 3 s de R2.
      assert.strictEqual(
        yield* pedir("vigente.json").pipe(Effect.provide(clienteCon(origenes, memoria))),
        200,
      );
      assert.deepStrictEqual(yield* origenes.nuevas, ["reserva vigente.json"]);

      // Pasada la hora, vuelve a probar R2 primero.
      yield* origenes.poner("principal", "bien");
      yield* TestClock.adjust("1 hour");
      assert.strictEqual(
        yield* pedir("vigente.json").pipe(Effect.provide(clienteCon(origenes, memoria))),
        200,
      );
      assert.deepStrictEqual(yield* origenes.nuevas, ["principal vigente.json"]);
    }),
  );

  it.effect("sin VITE_CAPAS_RESERVA todo va a R2, aunque no conteste", () =>
    Effect.gen(function* () {
      const origenes = yield* origenesDePrueba;
      yield* origenes.poner("principal", "caido");
      const estado = yield* pedir("vigente.json").pipe(
        Effect.provide(clienteCon(origenes, new AlmacenLocal(), null)),
      );
      assert.strictEqual(estado, 503);
      assert.deepStrictEqual(yield* origenes.nuevas, ["principal vigente.json"]);
    }),
  );
});
