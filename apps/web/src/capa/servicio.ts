import {
  CapaIlegible,
  type CapaLeida,
  decodificarVigente,
  FICHERO_VIGENTE,
  ficheroDeCapa,
  leerCapa,
  VersionDistinta,
  type Vigente,
} from "@celda/dominio/capa";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

/** El origen no tiene todavía ninguna capa publicada: no hay `vigente.json`. */
export class SinCapaPublicada extends Schema.TaggedError<SinCapaPublicada>()(
  "SinCapaPublicada",
  {},
) {}

/** El origen no ha dicho qué capa cargar: no responde o responde algo que no es `vigente.json`. */
export class OrigenNoResponde extends Schema.TaggedError<OrigenNoResponde>()("OrigenNoResponde", {
  motivo: Schema.String,
}) {}

/** El fichero de la capa no ha llegado. */
export class CapaNoDescargada extends Schema.TaggedError<CapaNoDescargada>()("CapaNoDescargada", {
  url: Schema.String,
  motivo: Schema.String,
}) {}

export type FalloCapa =
  | SinCapaPublicada
  | OrigenNoResponde
  | CapaNoDescargada
  | CapaIlegible
  | VersionDistinta;

/**
 * La capa de emplazamientos que dibuja el mapa. Primero lee en el origen qué versión es la
 * vigente y luego descarga ese fichero y comprueba su versión antes de dar nada por bueno. La
 * primera capa que llega se queda para toda la visita: el mapa y las fichas leen de la misma.
 */
export class CapaEmplazamientos extends Context.Service<
  CapaEmplazamientos,
  { readonly cargar: Effect.Effect<CapaLeida, FalloCapa> }
>()("@celda/web/capa/servicio/CapaEmplazamientos") {}

/**
 * De dónde se leen las capas y las fichas publicadas: `VITE_CAPAS_ORIGEN`, o `/capas` en el mismo
 * origen que la web. Siempre como URL absoluta y sin barra final.
 */
export const origenDeCapas: Config.Config<string> = Config.String("VITE_CAPAS_ORIGEN").pipe(
  Config.withDefault("/capas"),
  Config.map((origen) => new URL(origen, globalThis.location.href).href.replace(/\/$/u, "")),
);

/**
 * Lee `vigente.json` del origen: qué versión hay que cargar. Es el único fichero que cambia, y el
 * origen lo sirve sin caché larga.
 */
export const leerVigente = (http: HttpClient.HttpClient, origen: string) =>
  Effect.gen(function* () {
    const respuesta = yield* http
      .get(`${origen}/${FICHERO_VIGENTE}`)
      .pipe(Effect.mapError((error) => new OrigenNoResponde({ motivo: error.message })));
    if (respuesta.status === 404) {
      return yield* new SinCapaPublicada();
    }
    const texto = yield* HttpClientResponse.filterStatusOk(respuesta).pipe(
      Effect.flatMap((ok) => ok.text),
      Effect.mapError((error) => new OrigenNoResponde({ motivo: error.message })),
    );
    return yield* Effect.fromResult(decodificarVigente(texto)).pipe(
      Effect.mapError((error) => new OrigenNoResponde({ motivo: error.message })),
    );
  });

/** Descarga la capa de la versión vigente y comprueba que es esa. */
export const descargarCapa = (http: HttpClient.HttpClient, origen: string, vigente: Vigente) =>
  Effect.gen(function* () {
    const url = `${origen}/${ficheroDeCapa(vigente.version)}`;
    const contenido = yield* http.get(url).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((respuesta) => respuesta.text),
      Effect.mapError((error) => new CapaNoDescargada({ url, motivo: error.message })),
    );
    return yield* Effect.fromResult(leerCapa(contenido, vigente.version));
  });

/**
 * La capa del origen estático: `vigente.json` y el fichero de su versión, sin pasar por ningún
 * backend (ADR 0008). Una carga fallida no se guarda: la siguiente lo vuelve a intentar.
 */
export const capaDelOrigen = Layer.effect(
  CapaEmplazamientos,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const origen = yield* Effect.orDie(origenDeCapas);
    const turno = yield* Semaphore.make(1);
    let cargada = Option.none<CapaLeida>();

    const descargar = Effect.gen(function* () {
      const vigente = yield* leerVigente(http, origen);
      return yield* descargarCapa(http, origen, vigente);
    });

    const cargar = turno
      .withPermits(1)(
        Effect.suspend(() =>
          Option.match(cargada, {
            onSome: Effect.succeed,
            onNone: () =>
              Effect.tap(descargar, (capa) =>
                Effect.sync(() => {
                  cargada = Option.some(capa);
                }),
              ),
          }),
        ),
      )
      .pipe(Effect.withSpan("CapaEmplazamientos.cargar"));

    return CapaEmplazamientos.of({ cargar });
  }),
);
