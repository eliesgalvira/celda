import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";

import {
  type ErrorDeExtractor,
  Extractor,
  FuenteNoDisponible,
  LimiteDePeticiones,
  ProhibidoPorRobots,
  type Registro,
  RespuestaInesperada,
} from "../extractor.ts";
import { leerRobots, permitido, type Robots, SIN_RESTRICCIONES } from "../robots.ts";
import { decodificarLatin1 } from "../texto.ts";
import {
  bandasDeFicha,
  type Caja,
  listadoDeElementos,
  ORIGEN,
  RespuestaListado,
  TOPE_LISTADO,
  urlDeListado,
} from "./normalizar.ts";

/** Cómo se comporta el extractor con el geoportal. Ver `docs/investigacion/registro-oficial.md`. */
export interface Opciones {
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
  /** Caja que se recorre, en grados ETRS89. */
  readonly zona: Caja;
}

/** La caja de Barcelona de la investigación: cinco peticiones de listado. */
export const ZONA_BARCELONA: Caja = [2.052, 41.317, 2.229, 41.468];

export const OPCIONES: Opciones = {
  userAgent: "Celda (ingesta; contacto en celda.elies.site)",
  pausa: Duration.seconds(3),
  maxPeticiones: 300,
  espera: Duration.seconds(10),
  reintentos: 3,
  zona: ZONA_BARCELONA,
};

/** Las opciones se pueden cambiar con variables de entorno del despliegue. */
export const opcionesDesdeConfig: Config.Config<Opciones> = Config.all({
  maxPeticiones: Config.Int("CELDA_REGISTRO_MAX_PETICIONES").pipe(
    Config.withDefault(OPCIONES.maxPeticiones),
  ),
  pausaSegundos: Config.Int("CELDA_REGISTRO_PAUSA_SEGUNDOS").pipe(Config.withDefault(3)),
}).pipe(
  Config.map(({ maxPeticiones, pausaSegundos }) => ({
    ...OPCIONES,
    maxPeticiones,
    pausa: Duration.seconds(Math.max(pausaSegundos, 3)),
  })),
);

/** Un fallo que puede desaparecer al repetir: red, tiempo agotado, 408, 429 o 5xx. */
class FalloPasajero extends Schema.TaggedError<FalloPasajero>()("FalloPasajero", {
  url: Schema.String,
  motivo: Schema.String,
}) {}

interface Respuesta {
  readonly estado: number;
  readonly texto: string;
}

const ESTADOS_PASAJEROS = new Set([408, 429, 500, 502, 503, 504]);

/** Profundidad máxima al dividir cajas. A 6 niveles la caja de Barcelona mide unos 300 m. */
const PROFUNDIDAD_MAXIMA = 6;

const dividir = ([oeste, sur, este, norte]: Caja): ReadonlyArray<Caja> => {
  const [x, y] = [(oeste + este) / 2, (sur + norte) / 2];
  return [
    [oeste, sur, x, y],
    [x, sur, este, y],
    [oeste, y, x, norte],
    [x, y, este, norte],
  ];
};

const rutaDe = (url: string): string => {
  const { pathname, search } = new URL(url);
  return `${pathname}${search}`;
};

/**
 * Extractor del registro oficial (Infoantenas). Recorre el listado por cajas que divide en
 * cuatro al llegar al tope de 1000 elementos, respeta `robots.txt`, deja `pausa` entre
 * peticiones, no pasa de `maxPeticiones` y reintenta los fallos pasajeros con espera
 * exponencial.
 */
export const capa = (opciones: Opciones): Layer.Layer<Extractor, never, HttpClient.HttpClient> =>
  Layer.effect(
    Extractor,
    Effect.gen(function* () {
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
      const pedir = Effect.fn("RegistroOficial.pedir")(function* (url: string) {
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
              texto: decodificarLatin1(new Uint8Array(cuerpo)),
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
          Effect.flatMap((respuesta) =>
            ESTADOS_PASAJEROS.has(respuesta.estado)
              ? Effect.fail(new FalloPasajero({ url, motivo: `HTTP ${respuesta.estado}` }))
              : Effect.succeed(respuesta),
          ),
          Effect.provideService(HttpClient.TracerPropagationEnabled, false),
          Effect.ensuring(
            Effect.flatMap(Clock.currentTimeMillis, (fin) =>
              Ref.update(cuenta, (c) => ({ ...c, ultima: Option.some(fin) })),
            ),
          ),
        );
      }, turno.withPermits(1));

      const pedirConReintentos = (url: string) =>
        pedir(url).pipe(
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
        Effect.map(pedirConReintentos(`${ORIGEN}/robots.txt`), ({ estado, texto }): Robots =>
          estado >= 200 && estado < 300
            ? leerRobots(texto, opciones.userAgent.split(/[\s/]/u)[0] ?? "")
            : SIN_RESTRICCIONES,
        ),
      );

      const obtener = Effect.fn("RegistroOficial.obtener")(function* (url: string) {
        if (!permitido(yield* robots, rutaDe(url))) {
          return yield* new ProhibidoPorRobots({ url });
        }
        const respuesta = yield* pedirConReintentos(url);
        if (respuesta.estado !== 200) {
          return yield* new RespuestaInesperada({ url, motivo: `HTTP ${respuesta.estado}` });
        }
        return respuesta.texto;
      });

      const decodificarListado = Schema.decodeUnknownEffect(RespuestaListado);

      const elementosDeCaja = (
        caja: Caja,
        profundidad: number,
      ): Effect.Effect<ReadonlyArray<unknown>, ErrorDeExtractor> =>
        Effect.gen(function* () {
          const url = urlDeListado(caja);
          const respuesta = yield* decodificarListado(yield* obtener(url)).pipe(
            Effect.mapError((error) => new RespuestaInesperada({ url, motivo: error.message })),
          );
          const elementos = "features" in respuesta ? respuesta.features : [];
          if (elementos.length < TOPE_LISTADO) {
            return elementos;
          }
          if (profundidad >= PROFUNDIDAD_MAXIMA) {
            return yield* new RespuestaInesperada({
              url,
              motivo: "caja con 1000 elementos al máximo de divisiones",
            });
          }
          const partes = yield* Effect.forEach(dividir(caja), (parte) =>
            elementosDeCaja(parte, profundidad + 1),
          );
          return partes.flat();
        });

      /**
       * Una zona entera sin elementos no es un dato sino un fallo de la fuente: guardarlo
       * contaría todas las estaciones como ausentes y dos noches así las retirarían.
       */
      const listado = Effect.fn("RegistroOficial.listado")(function* () {
        const resultado = listadoDeElementos(yield* elementosDeCaja(opciones.zona, 0));
        if (resultado.registros.length === 0) {
          return yield* new RespuestaInesperada({
            url: urlDeListado(opciones.zona),
            motivo: "el listado de toda la zona está vacío",
          });
        }
        return resultado;
      });

      const ficha = Effect.fn("RegistroOficial.ficha")(function* (registro: Registro) {
        const bandas = bandasDeFicha(yield* obtener(registro.url));
        if (Result.isFailure(bandas)) {
          return yield* new RespuestaInesperada({ url: registro.url, motivo: bandas.failure });
        }
        return bandas.success;
      });

      return Extractor.of({ fuente: "registro-oficial", listado, ficha });
    }),
  );
