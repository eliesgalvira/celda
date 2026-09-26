import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";

import {
  type ErrorDeExtractor,
  FuenteNoDisponible,
  LimiteDePeticiones,
  ProhibidoPorRobots,
} from "./extractor.ts";
import { leerRobots, permitido, type Robots, SIN_RESTRICCIONES } from "./robots.ts";

/** Cómo trata un extractor a su fuente. Cada fuente tiene las suyas. */
export interface OpcionesCliente {
  /** Se envía en cada petición. El primer producto («Celda») es el que se busca en `robots.txt`. */
  readonly userAgent: string;
  /** Espera mínima entre el final de una respuesta y la petición siguiente. */
  readonly pausa: Duration.Duration;
  /** Tope de peticiones por ejecución, reintentos y `robots.txt` incluidos. */
  readonly maxPeticiones: number;
  /** Tiempo máximo de una respuesta antes de darla por fallida. */
  readonly espera: Duration.Duration;
  /** Reintentos de un fallo pasajero, con espera exponencial desde `pausa`. */
  readonly reintentos: number;
}

/** Una respuesta de la fuente, con cualquier estado que no sea un fallo pasajero. */
export interface Respuesta {
  readonly estado: number;
  readonly cuerpo: Uint8Array;
}

/** Un fallo que puede desaparecer al repetir: red, tiempo agotado, 408, 429 o 5xx. */
class FalloPasajero extends Schema.TaggedError<FalloPasajero>()("FalloPasajero", {
  url: Schema.String,
  motivo: Schema.String,
}) {}

const ESTADOS_PASAJEROS = new Set([408, 429, 500, 502, 503, 504]);

const rutaDe = (url: string): string => {
  const { pathname, search } = new URL(url);
  return `${pathname}${search}`;
};

/** Pide URLs de una sola fuente con las reglas de `OpcionesCliente`. */
export interface ClienteDeFuente {
  /**
   * Pide `url` si `robots.txt` lo permite, en su turno y tras la pausa. Reintenta los fallos
   * pasajeros y devuelve la respuesta con su estado, sea cual sea.
   */
  readonly pedir: (url: string) => Effect.Effect<Respuesta, ErrorDeExtractor>;
}

/**
 * Cliente de una fuente para lo que dura una ejecución: una petición cada vez, `pausa` entre el
 * final de una respuesta y la siguiente, no más de `maxPeticiones` y reintentos con espera
 * exponencial. Lee `robots.txt` de `origen` antes de la primera petición.
 */
export const clienteDeFuente = Effect.fn("ClienteDeFuente.crear")(function* (
  origen: string,
  opciones: OpcionesCliente,
) {
  const cliente = yield* HttpClient.HttpClient;
  const turno = yield* Semaphore.make(1);
  const cuenta = yield* Ref.make<{
    readonly hechas: number;
    readonly ultima: Option.Option<number>;
  }>({
    hechas: 0,
    ultima: Option.none(),
  });

  /** Espera su turno y hace una sola petición. */
  const unaPeticion = Effect.fn("ClienteDeFuente.peticion")(function* (url: string) {
    const { hechas, ultima } = yield* Ref.get(cuenta);
    if (hechas >= opciones.maxPeticiones) {
      return yield* new LimiteDePeticiones({ maximo: opciones.maxPeticiones });
    }
    const ahora = yield* Clock.currentTimeMillis;
    const libre = Option.getOrElse(ultima, () => ahora) + Duration.toMillis(opciones.pausa);
    if (Option.isSome(ultima) && libre > ahora) {
      yield* Effect.sleep(Duration.millis(libre - ahora));
    }
    yield* Ref.update(cuenta, (c) => ({ ...c, hechas: c.hechas + 1 }));
    return yield* cliente.get(url, { headers: { "user-agent": opciones.userAgent } }).pipe(
      Effect.flatMap((respuesta) =>
        Effect.map(respuesta.arrayBuffer, (cuerpo): Respuesta => ({
          estado: respuesta.status,
          cuerpo: new Uint8Array(cuerpo),
        })),
      ),
      Effect.timeoutOrElse({
        duration: opciones.espera,
        orElse: () => Effect.fail(new FalloPasajero({ url, motivo: "sin respuesta a tiempo" })),
      }),
      Effect.mapError((error) =>
        error._tag === "FalloPasajero"
          ? error
          : new FalloPasajero({ url, motivo: error.reason._tag }),
      ),
      Effect.filterOrFail(
        (respuesta) => !ESTADOS_PASAJEROS.has(respuesta.estado),
        (respuesta) => new FalloPasajero({ url, motivo: `HTTP ${respuesta.estado}` }),
      ),
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.ensuring(
        Effect.flatMap(Clock.currentTimeMillis, (fin) =>
          Ref.update(cuenta, (c) => ({ ...c, ultima: Option.some(fin) })),
        ),
      ),
    );
  }, turno.withPermits(1));

  const conReintentos = (url: string) =>
    unaPeticion(url).pipe(
      Effect.retry({
        schedule: Schedule.exponential(opciones.pausa),
        times: opciones.reintentos,
        while: (error) => error._tag === "FalloPasajero",
      }),
      Effect.catchTag("FalloPasajero", (error) =>
        Effect.fail(new FuenteNoDisponible({ url: error.url, motivo: error.motivo })),
      ),
    );

  /** RFC 9309: sin fichero (4xx) todo está permitido; un 5xx persistente para la ejecución. */
  const robots = yield* Effect.cached(
    Effect.map(conReintentos(`${origen}/robots.txt`), ({ estado, cuerpo }): Robots =>
      estado >= 200 && estado < 300
        ? leerRobots(new TextDecoder().decode(cuerpo), opciones.userAgent.split(/[\s/]/u)[0] ?? "")
        : SIN_RESTRICCIONES,
    ),
  );

  const pedir = Effect.fn("ClienteDeFuente.pedir")(function* (url: string) {
    if (!permitido(yield* robots, rutaDe(url))) {
      return yield* new ProhibidoPorRobots({ url });
    }
    return yield* conReintentos(url);
  });

  const resultado: ClienteDeFuente = { pedir };
  return resultado;
});
