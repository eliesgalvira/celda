import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type * as Headers from "effect/unstable/http/Headers";

import {
  type ErrorDeExtractor,
  FuenteNoDisponible,
  FuentePideEsperar,
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

/**
 * Un fallo que puede desaparecer al repetir: red, tiempo agotado, 408 o 5xx. Un 429, o un 503
 * con `Retry-After`, es la fuente pidiendo que se espere (`PideEsperar`).
 */
class FalloPasajero extends Schema.TaggedError<FalloPasajero>()("FalloPasajero", {
  url: Schema.String,
  motivo: Schema.String,
}) {}

const ESTADOS_PASAJEROS = new Set([408, 500, 502, 503, 504]);

/**
 * Un 429, o un 503 con `Retry-After`: la fuente pide que se espere. `espera` es lo que pide en
 * milisegundos, si lo dice.
 */
class PideEsperar extends Schema.TaggedError<PideEsperar>()("PideEsperar", {
  url: Schema.String,
  estado: Schema.Int,
  espera: Schema.UndefinedOr(Schema.Number),
}) {}

/**
 * Lo más que se espera cuando la fuente lo pide con `Retry-After`, antes de repetir la petición.
 * Si pide más, o un 429 no dice cuánto, se deja de pedir sin insistir.
 */
export const ESPERA_PEDIDA_MAXIMA = Duration.minutes(1);

/**
 * Lo que pide esperar `Retry-After`, en segundos o con una fecha HTTP, en milisegundos desde
 * `ahora`.
 */
export const esperaPedida = (valor: string | undefined, ahora: number): number | undefined => {
  const texto = valor?.trim() ?? "";
  if (/^\d+$/u.test(texto)) return Number(texto) * 1000;
  const fecha = texto === "" ? Number.NaN : Date.parse(texto);
  return Number.isNaN(fecha) ? undefined : Math.max(fecha - ahora, 0);
};

/** Si la fuente pide esperar y cuánto aguanta el cliente: hasta `ESPERA_PEDIDA_MAXIMA`. */
const esperaCorta = (error: PideEsperar): boolean =>
  error.espera !== undefined && error.espera <= Duration.toMillis(ESPERA_PEDIDA_MAXIMA);

const motivoDeEspera = (error: PideEsperar): string =>
  error.espera === undefined
    ? `HTTP ${error.estado}`
    : `HTTP ${error.estado}, pide esperar ${Math.ceil(error.espera / 1000)} s`;

/** Por qué no se pudo verificar un certificado, según el código de OpenSSL que da Node. */
const CERTIFICADO_NO_VERIFICADO = new Map([
  ["UNABLE_TO_GET_ISSUER_CERT", "falta el certificado de su emisor"],
  ["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "falta el certificado de su emisor"],
  ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "falta el certificado de su emisor"],
  ["SELF_SIGNED_CERT_IN_CHAIN", "la cadena acaba en una raíz que no es de confianza"],
  ["DEPTH_ZERO_SELF_SIGNED_CERT", "está firmado por sí mismo"],
  ["CERT_HAS_EXPIRED", "ha caducado"],
  ["CERT_NOT_YET_VALID", "aún no es válido"],
  ["ERR_TLS_CERT_ALTNAME_INVALID", "es de otro nombre"],
]);

/** Lo más que se guarda del mensaje de la causa: el diario no es sitio para trazas. */
const LARGO_DE_CAUSA = 160;

/**
 * Motivo de un fallo de transporte para el diario: el tipo de fallo y, si se sabe, su causa en una
 * línea, como `TransportError: el certificado del servidor no se pudo verificar, falta el
 * certificado de su emisor (UNABLE_TO_GET_ISSUER_CERT_LOCALLY: unable to get local issuer
 * certificate)`.
 */
export const motivoDeFallo = (tipo: string, cause: unknown): string => {
  // La causa más honda: `fetch` envuelve en un «fetch failed» el fallo de la conexión.
  let causa = cause;
  for (let paso = 0; paso < 5 && Predicate.hasProperty(causa, "cause"); paso++) {
    if (causa.cause === undefined) break;
    causa = causa.cause;
  }
  const codigo =
    Predicate.hasProperty(causa, "code") && Predicate.isString(causa.code) ? causa.code : undefined;
  const mensaje =
    causa instanceof Error
      ? // Node añade a los fallos de certificado un consejo («try running Node.js with
        // --use-system-ca») que despista: el arreglo no suele ser cambiar las raíces.
        (causa.message.split("; if the root CA")[0] ?? "").replaceAll(/\s+/gu, " ").trim()
      : "";
  const detalle = [codigo, mensaje.slice(0, LARGO_DE_CAUSA)].filter(Boolean).join(": ");
  const porque = codigo === undefined ? undefined : CERTIFICADO_NO_VERIFICADO.get(codigo);
  if (porque !== undefined) {
    return `${tipo}: el certificado del servidor no se pudo verificar, ${porque} (${detalle})`;
  }
  return detalle === "" ? tipo : `${tipo}: ${detalle}`;
};

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
  /** Hasta cuándo ha pedido la fuente que se espere con `Retry-After`. */
  readonly esperarHasta: Ref.Ref<number>;
}

/**
 * Un 429, o un 503 con `Retry-After`, falla con lo que pide esperar. Si es poco, la conexión no
 * vuelve a pedir nada hasta entonces; si es más, la petición no se repite.
 */
const pideEsperar = Effect.fn("ClienteDeFuente.pideEsperar")(function* (
  conexion: Conexion,
  url: string,
  respuesta: Respuesta,
) {
  const valor = respuesta.cabeceras["retry-after"];
  if (respuesta.estado !== 429 && !(respuesta.estado === 503 && valor !== undefined)) return;
  const ahora = yield* Clock.currentTimeMillis;
  const espera = esperaPedida(valor, ahora);
  const error = new PideEsperar({ url, estado: respuesta.estado, espera });
  if (espera !== undefined && esperaCorta(error)) {
    yield* Ref.update(conexion.esperarHasta, (hasta) => Math.max(hasta, ahora + espera));
    yield* Effect.logWarning(`La fuente pide esperar: ${motivoDeEspera(error)} (${url})`);
  }
  return yield* error;
});

/** Espera su turno y hace una sola petición, sin pasar de `maxPeticiones` en `hechas`. */
const unaPeticion = (conexion: Conexion, opciones: OpcionesCliente, hechas: Ref.Ref<number>) =>
  Effect.fn("ClienteDeFuente.peticion")(function* (url: string) {
    if ((yield* Ref.get(hechas)) >= opciones.maxPeticiones) {
      return yield* new LimiteDePeticiones({ maximo: opciones.maxPeticiones });
    }
    const ultima = yield* Ref.get(conexion.ultima);
    const ahora = yield* Clock.currentTimeMillis;
    const trasLaPausa = Option.match(ultima, {
      onNone: () => ahora,
      onSome: (fin) => fin + Duration.toMillis(opciones.pausa),
    });
    const libre = Math.max(trasLaPausa, yield* Ref.get(conexion.esperarHasta));
    if (libre > ahora) {
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
          : new FalloPasajero({
              url,
              motivo: motivoDeFallo(error.reason._tag, error.reason.cause),
            }),
      ),
      Effect.tap((respuesta) => pideEsperar(conexion, url, respuesta)),
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

/**
 * Reintenta los fallos pasajeros con espera exponencial desde la pausa, y una petición en la que
 * la fuente pide esperar poco, tras esperar lo que pide. Si pide más, no se insiste.
 */
const conReintentos =
  (
    peticion: (
      url: string,
    ) => Effect.Effect<Respuesta, ErrorDeExtractor | FalloPasajero | PideEsperar>,
  ) =>
  (opciones: OpcionesCliente) =>
  (url: string) =>
    peticion(url).pipe(
      Effect.retry({
        schedule: Schedule.exponential(opciones.pausa),
        times: opciones.reintentos,
        while: (error) =>
          error._tag === "FalloPasajero" || (error._tag === "PideEsperar" && esperaCorta(error)),
      }),
      Effect.catchTag("FalloPasajero", (error) =>
        Effect.fail(new FuenteNoDisponible({ url: error.url, motivo: error.motivo })),
      ),
      Effect.catchTag("PideEsperar", (error) =>
        Effect.fail(new FuentePideEsperar({ url: error.url, motivo: motivoDeEspera(error) })),
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
    esperarHasta: yield* Ref.make(0),
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
