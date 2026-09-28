import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

/** Una petición que ha recibido el cliente de prueba, con la hora del `TestClock`. */
export interface Peticion {
  readonly ruta: string;
  readonly userAgent: string | undefined;
  readonly en: number;
}

export interface Respuesta {
  readonly estado: number;
  readonly cuerpo: string | Uint8Array<ArrayBuffer>;
  readonly cabeceras?: Readonly<Record<string, string>>;
}

/** Contesta una URL; `intento` es cuántas veces se ha pedido ya esa misma URL. */
export type Respondedor = (url: URL, intento: number) => Respuesta;

export const NO_HAY_ROBOTS: Respuesta = { estado: 404, cuerpo: "" };

/**
 * Cliente HTTP de prueba: apunta cada petición con la hora del `TestClock` y contesta con
 * `responder`, tras `latencia` si se le da, como un servidor que tarda en responder.
 */
export const clienteDePrueba = (
  peticiones: Ref.Ref<ReadonlyArray<Peticion>>,
  responder: Respondedor,
  latencia: Duration.Duration = Duration.zero,
) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.gen(function* () {
        const en = yield* Clock.currentTimeMillis;
        const ruta = `${url.pathname}${url.search}`;
        const previas = yield* Ref.getAndUpdate(peticiones, (p) => [
          ...p,
          { ruta, userAgent: request.headers["user-agent"], en },
        ]);
        if (Duration.isPositive(latencia)) {
          yield* Effect.sleep(latencia);
        }
        const { estado, cuerpo, cabeceras } = responder(
          url,
          previas.filter((p) => p.ruta === ruta).length,
        );
        return HttpClientResponse.fromWeb(
          request,
          new Response(cuerpo, { status: estado, headers: cabeceras ?? {} }),
        );
      }),
    ),
  );
