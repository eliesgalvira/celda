import { FICHERO_VIGENTE } from "@celda/dominio/capa";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { origenDeCapas } from "./servicio.ts";

/**
 * Dos orígenes para las capas y las fichas (ADR 0010): el principal, R2 detrás de Cloudflare, y la
 * copia de reserva de Vercel, en `/capas` del mismo origen que la web. Durante un bloqueo de
 * LaLiga, Cloudflare no contesta desde España; la copia de Vercel, normalmente sí.
 */

/** Lo que se espera a un origen, respuesta entera incluida, antes de pasar al otro. */
export const LIMITE = Duration.seconds(3);
/** Lo que se recuerda, también en visitas siguientes, que el principal ha fallado. */
export const RECUERDO = Duration.hours(1);
/** Cada cuánto se vuelve a probar el principal mientras se lee de la reserva. */
export const SONDEO = Duration.minutes(5);

/** Hasta cuándo se lee primero de la reserva, guardado entre visitas. */
export class MemoriaDeOrigenes extends Context.Service<
  MemoriaDeOrigenes,
  {
    /** Hasta cuándo, en milisegundos; `undefined` si el principal no ha fallado. */
    readonly leer: Effect.Effect<number | undefined>;
    readonly guardar: (hasta: number | undefined) => Effect.Effect<void>;
  }
>()("@celda/web/capa/origenes/MemoriaDeOrigenes") {}

const CLAVE = "celda:capas:principal-caido-hasta";

/**
 * La memoria en `localStorage`. Si el navegador no deja usarlo, como en algunos modos privados, en
 * los que hasta leer `localStorage` lanza un error, se recuerda solo durante la visita.
 */
export const memoriaEnElNavegador = (ventana: Pick<Window, "localStorage">) =>
  Layer.effect(
    MemoriaDeOrigenes,
    Effect.gen(function* () {
      const deLaVisita = yield* Ref.make<number | undefined>(undefined);
      const leer = Effect.gen(function* () {
        const guardado = yield* Effect.try(() => ventana.localStorage.getItem(CLAVE)).pipe(
          Effect.orElseSucceed(() => null),
        );
        const hasta = Number(guardado);
        return guardado !== null && Number.isFinite(hasta) ? hasta : yield* Ref.get(deLaVisita);
      });
      const guardar = (hasta: number | undefined) =>
        Effect.gen(function* () {
          yield* Ref.set(deLaVisita, hasta);
          yield* Effect.try(() => {
            if (hasta === undefined) ventana.localStorage.removeItem(CLAVE);
            else ventana.localStorage.setItem(CLAVE, String(hasta));
          }).pipe(Effect.orElseSucceed(() => undefined));
        });
      return MemoriaDeOrigenes.of({ leer, guardar });
    }),
  );

/**
 * La copia de reserva de las capas: `VITE_CAPAS_RESERVA`, que el build de Vercel pone en `/capas`.
 * Sin ella, todo se lee del principal.
 */
export const reservaDeCapas: Config.Config<Option.Option<string>> = Config.option(
  Config.String("VITE_CAPAS_RESERVA"),
).pipe(
  Config.map(
    Option.map((origen) => new URL(origen, globalThis.location.href).href.replace(/\/$/u, "")),
  ),
);

/** Un origen no ha contestado a tiempo, o ha contestado con un fallo suyo. */
const caida = (request: HttpClientRequest.HttpClientRequest, description: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, description }),
  });

/** Un 5xx o un 429, como el error 1027 de Cloudflare al acabarse la cuota: el origen no puede. */
const esCaida = (estado: number): boolean => estado >= 500 || estado === 429;

/**
 * El cliente HTTP de las capas y las fichas, con la copia de reserva. Las peticiones a otro sitio
 * pasan tal cual.
 *
 * - Cada fichero se pide al origen activo y se lee entero en `LIMITE`. Un fallo de red, un plazo
 *   agotado, un 5xx o un 429 lo piden al otro. Un 404 es una respuesta: el fichero no está.
 * - Si el principal falla, se lee primero de la reserva durante `RECUERDO`, también en las visitas
 *   siguientes, y cada `SONDEO` se prueba el principal con `vigente.json` para volver en cuanto
 *   conteste.
 * - Si no contesta ninguno, falla como la red, y la interfaz dice que no llegan los datos.
 *
 * El cliente no compara ETag entre orígenes: los ficheros llevan la versión o su huella en el
 * nombre, y el mismo nombre es el mismo contenido en los dos.
 */
export const conOrigenDeReserva = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const principal = yield* Effect.orDie(origenDeCapas);
    const reserva = yield* Effect.orDie(reservaDeCapas);
    if (Option.isNone(reserva) || reserva.value === principal) return http;
    const memoria = yield* MemoriaDeOrigenes;
    const hasta = yield* Ref.make(yield* memoria.leer);

    const enReserva = Effect.gen(function* () {
      const fin = yield* Ref.get(hasta);
      return fin !== undefined && fin > (yield* Clock.currentTimeMillis);
    });
    const recordar = (fin: number | undefined) =>
      Effect.andThen(Ref.set(hasta, fin), memoria.guardar(fin));
    const principalCaido = Effect.flatMap(Clock.currentTimeMillis, (ahora) =>
      recordar(ahora + Duration.toMillis(RECUERDO)),
    );

    /** Una petición a un origen, leída entera a tiempo. */
    const intentar = (request: HttpClientRequest.HttpClientRequest, url: string) =>
      Effect.gen(function* () {
        const respuesta = yield* http.execute(HttpClientRequest.setUrl(request, url));
        if (esCaida(respuesta.status)) {
          return yield* caida(request, `${url}: ${respuesta.status}`);
        }
        const cuerpo = yield* respuesta.arrayBuffer;
        return HttpClientResponse.fromWeb(
          request,
          new Response(respuesta.status === 204 ? null : cuerpo, {
            status: respuesta.status,
            headers: respuesta.headers,
          }),
        );
      }).pipe(
        Effect.timeoutOrElse({
          duration: LIMITE,
          orElse: () => Effect.fail(caida(request, `${url}: sin respuesta en 3 s`)),
        }),
      );

    const conReserva = HttpClient.make((request, url) =>
      Effect.gen(function* () {
        if (!url.href.startsWith(`${principal}/`)) return yield* http.execute(request);
        const ruta = url.href.slice(principal.length);
        const primeroLaReserva = yield* enReserva;
        const orden = primeroLaReserva ? [reserva.value, principal] : [principal, reserva.value];
        let ultimo = caida(request, "ningún origen contesta");
        for (const origen of orden) {
          const intento = yield* Effect.result(intentar(request, `${origen}${ruta}`));
          if (intento._tag === "Success") {
            if (origen === principal && primeroLaReserva) yield* recordar(undefined);
            return intento.success;
          }
          ultimo = intento.failure;
          if (origen === principal) yield* principalCaido;
        }
        return yield* ultimo;
      }),
    );

    // Mientras se lee de la reserva, se prueba el principal de vez en cuando para volver.
    const sondear = Effect.gen(function* () {
      if (!(yield* enReserva)) return;
      const vuelto = yield* intentar(
        HttpClientRequest.get(`${principal}/${FICHERO_VIGENTE}`),
        `${principal}/${FICHERO_VIGENTE}`,
      ).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (vuelto) yield* recordar(undefined);
    });
    yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep(SONDEO), sondear)));

    return conReserva;
  }),
);
