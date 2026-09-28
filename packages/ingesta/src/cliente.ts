import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type * as Headers from "effect/unstable/http/Headers";

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
  /** Las cabeceras, en minúsculas, como `last-modified`. */
  readonly cabeceras: Headers.Headers;
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
  /** Peticiones hechas hasta ahora por este cliente, con `robots.txt` y los reintentos. */
  readonly peticiones: Effect.Effect<number>;
  /**
   * Otro cliente de la misma fuente con otras opciones, como otra pausa u otro tope. Comparte el
   * turno, `robots.txt` y la hora de la última respuesta, así que su primera petición también
   * espera su pausa desde la última de este. Cuenta sus peticiones aparte.
   */
  readonly conOpciones: (opciones: OpcionesCliente) => Effect.Effect<ClienteDeFuente>;
}

/** Lo que comparten los clientes de una fuente: una petición cada vez y la última respuesta. */
interface Conexion {
  readonly cliente: HttpClient.HttpClient;
  readonly turno: Semaphore.Semaphore;
  /** Cuándo acabó la última respuesta de la fuente. */
  readonly ultima: Ref.Ref<Option.Option<number>>;
}

/** Espera su turno y hace una sola petición, sin pasar de `maxPeticiones` en `hechas`. */
const unaPeticion = (conexion: Conexion, opciones: OpcionesCliente, hechas: Ref.Ref<number>) =>
  Effect.fn("ClienteDeFuente.peticion")(function* (url: string) {
    if ((yield* Ref.get(hechas)) >= opciones.maxPeticiones) {
      return yield* new LimiteDePeticiones({ maximo: opciones.maxPeticiones });
    }
    const ultima = yield* Ref.get(conexion.ultima);
    const ahora = yield* Clock.currentTimeMillis;
    const libre = Option.getOrElse(ultima, () => ahora) + Duration.toMillis(opciones.pausa);
    if (Option.isSome(ultima) && libre > ahora) {
      yield* Effect.sleep(Duration.millis(libre - ahora));
    }
    yield* Ref.update(hechas, (n) => n + 1);
    return yield* conexion.cliente.get(url, { headers: { "user-agent": opciones.userAgent } }).pipe(
      Effect.flatMap((respuesta) =>
        Effect.map(respuesta.arrayBuffer, (cuerpo): Respuesta => ({
          estado: respuesta.status,
          cuerpo: new Uint8Array(cuerpo),
          cabeceras: respuesta.headers,
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
          Ref.set(conexion.ultima, Option.some(fin)),
        ),
      ),
    );
  }, conexion.turno.withPermits(1));

/** Reintenta los fallos pasajeros con espera exponencial desde la pausa. */
const conReintentos =
  (peticion: (url: string) => Effect.Effect<Respuesta, ErrorDeExtractor | FalloPasajero>) =>
  (opciones: OpcionesCliente) =>
  (url: string) =>
    peticion(url).pipe(
      Effect.retry({
        schedule: Schedule.exponential(opciones.pausa),
        times: opciones.reintentos,
        while: (error) => error._tag === "FalloPasajero",
      }),
      Effect.catchTag("FalloPasajero", (error) =>
        Effect.fail(new FuenteNoDisponible({ url: error.url, motivo: error.motivo })),
      ),
    );

/**
 * Un cliente sobre la conexión, con sus opciones y su cuenta de peticiones, que mira
 * `robots.txt` antes de cada una.
 */
const clienteSobre = (
  conexion: Conexion,
  robots: Effect.Effect<Robots, ErrorDeExtractor>,
  opciones: OpcionesCliente,
  hechas: Ref.Ref<number>,
): ClienteDeFuente => {
  const pedirConReintentos = conReintentos(unaPeticion(conexion, opciones, hechas))(opciones);
  return {
    pedir: Effect.fn("ClienteDeFuente.pedir")(function* (url: string) {
      if (!permitido(yield* robots, rutaDe(url))) {
        return yield* new ProhibidoPorRobots({ url });
      }
      return yield* pedirConReintentos(url);
    }),
    peticiones: Ref.get(hechas),
    conOpciones: (otras) =>
      Effect.map(Ref.make(0), (suyas) => clienteSobre(conexion, robots, otras, suyas)),
  };
};

/**
 * Cliente de una fuente para lo que dura una ejecución: una petición cada vez, `pausa` entre el
 * final de una respuesta y la siguiente, no más de `maxPeticiones` y reintentos con espera
 * exponencial. Lee `robots.txt` de `origen` antes de la primera petición, y esa lectura cuenta
 * como una petición de este cliente.
 */
export const clienteDeFuente = Effect.fn("ClienteDeFuente.crear")(function* (
  origen: string,
  opciones: OpcionesCliente,
) {
  const conexion: Conexion = {
    cliente: yield* HttpClient.HttpClient,
    turno: yield* Semaphore.make(1),
    ultima: yield* Ref.make(Option.none<number>()),
  };
  const hechas = yield* Ref.make(0);

  /** RFC 9309: sin fichero (4xx) todo está permitido; un 5xx persistente para la ejecución. */
  const robots = yield* Effect.cached(
    Effect.map(
      conReintentos(unaPeticion(conexion, opciones, hechas))(opciones)(`${origen}/robots.txt`),
      ({ estado, cuerpo }): Robots =>
        estado >= 200 && estado < 300
          ? leerRobots(
              new TextDecoder().decode(cuerpo),
              opciones.userAgent.split(/[\s/]/u)[0] ?? "",
            )
          : SIN_RESTRICCIONES,
    ),
  );

  return clienteSobre(conexion, robots, opciones, hechas);
});
