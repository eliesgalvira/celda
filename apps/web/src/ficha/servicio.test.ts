// Cada prueba es su propio punto de entrada y monta sus capas, nuevas en cada una.
// @effect-diagnostics strictEffectProvide:off
import type { Ficha } from "@celda/dominio/ficha";
import { make, type Transport } from "@confect/js/internal/WebSocketClient";
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { type Cliente, FichaNoLeida, fichasDesdeCliente, FichasEnVivo } from "./servicio.ts";

const FICHA: Ficha = {
  clave: "movistar-0802532",
  posicion: { longitud: 2.113628, latitud: 41.388344 },
  direccion: "CL JORDI GIRONA, 1. BARCELONA, BARCELONA",
  municipio: "BARCELONA",
  estado: "verificado",
  confianza: "media",
  conflictos: [],
  estaciones: [],
  datosDel: 1_790_388_900_000,
  version: 1_790_388_900_000,
};

/** Lo que el backend de prueba contesta a cada clave: un valor ya codificado o un error. */
type Respuesta = { readonly valor: unknown } | { readonly error: string };

interface Registro {
  /** Claves suscritas ahora. */
  abiertas: ReadonlyArray<string>;
  conexiones: number;
}

/**
 * Un cliente de Confect sobre un transporte de prueba que contesta a cada suscripción con la
 * respuesta de su clave y apunta cuántas conexiones y suscripciones hay abiertas. La primera
 * conexión falla si `fallarLaPrimera`.
 */
const clienteDePrueba = (
  respuestas: ReadonlyMap<string, Respuesta>,
  registro: Registro,
  fallarLaPrimera: boolean,
): Effect.Effect<Cliente, FichaNoLeida> =>
  Effect.suspend(() => {
    registro.conexiones += 1;
    if (fallarLaPrimera && registro.conexiones === 1) {
      return Effect.fail(new FichaNoLeida({ motivo: "sin red" }));
    }
    const cambiar = (f: (abiertas: ReadonlyArray<string>) => ReadonlyArray<string>) => {
      registro.abiertas = f(registro.abiertas);
    };
    const transporte: Transport = {
      setAuth: () => undefined,
      close: () => Promise.resolve(),
      query: () => Promise.reject(new Error("sin consultas sueltas")),
      mutation: () => Promise.reject(new Error("sin mutaciones")),
      action: () => Promise.reject(new Error("sin acciones")),
      onUpdate: (_referencia, argumentos, alActualizar, alFallar) => {
        // SAFETY: la única lectura en vivo de la web es `datos:ficha`, con argumentos `{ clave }`.
        const { clave } = argumentos as { readonly clave: string };
        cambiar((abiertas) => [...abiertas, clave]);
        const respuesta = respuestas.get(clave) ?? { valor: null };
        queueMicrotask(() => {
          if ("valor" in respuesta) alActualizar(respuesta.valor);
          else alFallar(new Error(respuesta.error));
        });
        return () => cambiar((abiertas) => abiertas.filter((a) => a !== clave));
      },
    };
    return Effect.succeed(make("http://convex.prueba", transporte));
  });

/** Ejecuta `prueba` con el servicio real sobre el cliente de prueba. */
const conFichas = <A, E>(
  respuestas: ReadonlyMap<string, Respuesta>,
  prueba: (servicio: FichasEnVivo["Service"], registro: Registro) => Effect.Effect<A, E>,
  fallarLaPrimera = false,
) => {
  const registro: Registro = { abiertas: [], conexiones: 0 };
  return Effect.flatMap(FichasEnVivo, (servicio) => prueba(servicio, registro)).pipe(
    Effect.provide(fichasDesdeCliente(clienteDePrueba(respuestas, registro, fallarLaPrimera))),
  );
};

const esFallo = Schema.is(FichaNoLeida);

describe("fichas en vivo sobre el cliente de Confect", () => {
  it.effect("no se conecta hasta la primera ficha, y después reutiliza la conexión", () =>
    conFichas(new Map(), (servicio, registro) =>
      Effect.gen(function* () {
        assert.strictEqual(registro.conexiones, 0);
        yield* Stream.runHead(servicio.seguir("a"));
        yield* Stream.runHead(servicio.seguir("b"));
        assert.strictEqual(registro.conexiones, 1);
      }),
    ),
  );

  it.effect("decodifica la ficha, y un emplazamiento que no existe es None", () =>
    conFichas(new Map([[FICHA.clave, { valor: FICHA }]]), (servicio) =>
      Effect.gen(function* () {
        const leida = yield* Stream.runHead(servicio.seguir(FICHA.clave));
        assert.deepStrictEqual(leida, Option.some(Option.some(FICHA)));
        const ninguna = yield* Stream.runHead(servicio.seguir("no-existe"));
        assert.deepStrictEqual(ninguna, Option.some(Option.none()));
      }),
    ),
  );

  it.effect("al dejar de leer, la suscripción se da de baja", () =>
    conFichas(new Map(), (servicio, registro) =>
      Effect.gen(function* () {
        yield* Stream.runHead(servicio.seguir("a"));
        assert.deepStrictEqual(registro.abiertas, []);
      }),
    ),
  );

  it.effect("un error del backend o una respuesta mal formada llegan como FichaNoLeida", () =>
    conFichas(
      new Map<string, Respuesta>([
        ["caida", { error: "Server Error" }],
        ["rara", { valor: { clave: 3 } }],
      ]),
      (servicio) =>
        Effect.gen(function* () {
          for (const clave of ["caida", "rara"]) {
            const salida = yield* Effect.exit(Stream.runHead(servicio.seguir(clave)));
            assert.isTrue(Exit.isFailure(salida), clave);
            if (Exit.isFailure(salida)) {
              assert.isTrue(
                Cause.findErrorOption(salida.cause).pipe(Option.exists(esFallo)),
                clave,
              );
            }
          }
        }),
    ),
  );

  it.effect("si la conexión falla, la ficha lo dice y la siguiente lo vuelve a intentar", () =>
    conFichas(
      new Map(),
      (servicio, registro) =>
        Effect.gen(function* () {
          const primera = yield* Effect.exit(Stream.runHead(servicio.seguir("a")));
          assert.isTrue(Exit.isFailure(primera));
          const segunda = yield* Stream.runHead(servicio.seguir("a"));
          assert.deepStrictEqual(segunda, Option.some(Option.none()));
          assert.strictEqual(registro.conexiones, 2);
        }),
      true,
    ),
  );
});
