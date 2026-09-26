import {
  CapaIlegible,
  type CapaLeida,
  CapaPublicada,
  leerCapa,
  VersionDistinta,
} from "@celda/dominio/capa";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

/** El backend no tiene todavía ninguna capa publicada. */
export class SinCapaPublicada extends Schema.TaggedError<SinCapaPublicada>()(
  "SinCapaPublicada",
  {},
) {}

/** El backend no ha dicho qué capa cargar: no responde o responde con un error. */
export class BackendNoResponde extends Schema.TaggedError<BackendNoResponde>()(
  "BackendNoResponde",
  { motivo: Schema.String },
) {}

/** El fichero de la capa no ha llegado. */
export class CapaNoDescargada extends Schema.TaggedError<CapaNoDescargada>()("CapaNoDescargada", {
  url: Schema.String,
  motivo: Schema.String,
}) {}

export type FalloCapa =
  | SinCapaPublicada
  | BackendNoResponde
  | CapaNoDescargada
  | CapaIlegible
  | VersionDistinta;

/**
 * La capa de emplazamientos que dibuja el mapa. Primero pregunta al backend cuál es la vigente y
 * luego descarga ese fichero y comprueba su versión antes de dar nada por bueno.
 */
export class CapaEmplazamientos extends Context.Service<
  CapaEmplazamientos,
  { readonly cargar: Effect.Effect<CapaLeida, FalloCapa> }
>()("@celda/web/capa/servicio/CapaEmplazamientos") {}

/** Respuesta de `capas:vigente` por la API HTTP de Convex, con `format: "json"`. */
const RespuestaVigente = Schema.Union([
  Schema.Struct({ status: Schema.Literal("success"), value: Schema.NullOr(CapaPublicada) }),
  Schema.Struct({ status: Schema.Literal("error"), errorMessage: Schema.String }),
]);
const decodificarVigente = HttpClientResponse.schemaBodyJson(RespuestaVigente);

/**
 * La capa en vivo: la versión vigente con una consulta a la API HTTP de Convex (una lectura
 * suelta, sin suscripción) y el fichero desde el origen estático que diga Convex.
 */
export const capaEnVivo = Layer.effect(
  CapaEmplazamientos,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    // Sin la variable queda vacía y cada carga lo dice; una cadena no puede estar mal formada.
    const convex = yield* Config.String("VITE_CONVEX_URL").pipe(
      Config.withDefault(""),
      Effect.orDie,
    );

    const vigente = Effect.gen(function* () {
      if (convex === "") {
        return yield* new BackendNoResponde({ motivo: "Celda no sabe dónde está su backend" });
      }
      const respuesta = yield* http
        .execute(
          HttpClientRequest.post(`${convex}/api/query`).pipe(
            HttpClientRequest.bodyJsonUnsafe({ path: "capas:vigente", args: {}, format: "json" }),
          ),
        )
        .pipe(
          Effect.flatMap(decodificarVigente),
          Effect.mapError((error) => new BackendNoResponde({ motivo: error.message })),
        );
      if (respuesta.status === "error") {
        return yield* new BackendNoResponde({ motivo: respuesta.errorMessage });
      }
      if (respuesta.value === null) {
        return yield* new SinCapaPublicada();
      }
      return respuesta.value;
    });

    const descargar = (url: string) =>
      http.get(url).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((respuesta) => respuesta.text),
        Effect.mapError((error) => new CapaNoDescargada({ url, motivo: error.message })),
      );

    const cargar = Effect.gen(function* () {
      const publicada = yield* vigente;
      const contenido = yield* descargar(publicada.url);
      return yield* Effect.fromResult(leerCapa(contenido, publicada.version));
    }).pipe(Effect.withSpan("CapaEmplazamientos.cargar"));

    return CapaEmplazamientos.of({ cargar });
  }),
);
